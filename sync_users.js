// sync_users.js
const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');

// 固定配置（无需修改，仅需配置环境变量）
const GITEE_API_URL = 'https://gitee.com/api/v5/repos/Kosto179/kosto-battle-clicker-new/contents/douyinh.txt';
const LOCAL_USERS_FILE = 'users.txt';
const CREATOR_CHAT_URL = 'https://creator.douyin.com/creator-micro/data/following/chat';
const GOTO_TIMEOUT = 60000;
const MAX_SCROLL_ATTEMPTS = 80;
const SCROLL_STEP = 800;

// 日志函数（兼容CI日志输出）
const log = (level, msg, ...args) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`, ...args);

// 主函数（全async包裹，无await语法错误）
async function runSync() {
    let browser = null;
    let page = null;
    try {
        log('info', '🚀 启动抖音用户同步任务');

        // ========== 1. 读取并校验环境变量 ==========
        const giteeToken = process.env.GITEE_TOKEN?.trim();
        const douyinCookies = process.env.DOUYIN_COOKIES?.trim();

        if (!giteeToken) {
            log('error', '❌ 未读取到GITEE_TOKEN，请检查GitHub Secrets配置');
            process.exit(1);
        }
        if (!douyinCookies) {
            log('error', '❌ 未读取到DOUYIN_COOKIES，请检查GitHub Secrets配置');
            process.exit(1);
        }
        log('success', `✅ 环境变量读取完成，Gitee Token长度: ${giteeToken.length}`);

        // ========== 2. 从Gitee拉取目标抖音号列表 ==========
        log('info', '📥 正在从Gitee拉取目标抖音号列表');
        const giteeRes = await axios.get(GITEE_API_URL, {
            params: { access_token: giteeToken },
            headers: { 'User-Agent': 'Mozilla/5.0 (Node.js Playwright Sync Script)' },
            timeout: 30000
        }).catch(err => {
            if (err.response) {
                log('error', `❌ Gitee API请求失败，状态码: ${err.response.status}`);
                err.response.status === 401 && log('error', '   原因：Gitee Token无效或无仓库权限');
                err.response.status === 404 && log('error', '   原因：仓库/文件路径不存在，请检查GITEE_API_URL');
            } else {
                log('error', `❌ Gitee API网络请求失败: ${err.message}`);
            }
            process.exit(1);
        });

        // 解析Base64内容，过滤空行、注释
        const rawFileContent = Buffer.from(giteeRes.data.content, 'base64').toString();
        const targetDyIds = rawFileContent.split('\n')
            .map(id => id.trim())
            .filter(id => id && !id.startsWith('#'));

        if (targetDyIds.length === 0) {
            log('error', '❌ 从Gitee拉取的抖音号列表为空');
            process.exit(1);
        }
        log('success', `✅ 成功拉取到${targetDyIds.length}个目标抖音号`);

        // ========== 3. 启动浏览器，注入Cookie ==========
        log('info', '🌐 正在启动无头浏览器');
        // 全量CI兼容参数，彻底解决Runner环境浏览器启动失败问题
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            ignoreHTTPSErrors: true
        });

        // 清理Cookie，修复sameSite/secure属性，避免浏览器拦截登录态
        let parsedCookies;
        try {
            parsedCookies = JSON.parse(douyinCookies);
        } catch (err) {
            log('error', '❌ DOUYIN_COOKIES格式错误，必须是标准JSON字符串');
            process.exit(1);
        }

        const cleanedCookies = parsedCookies.map(cookie => ({
            ...cookie,
            sameSite: cookie.sameSite === 'no_restriction' ? 'None' : 
                      cookie.sameSite === 'unspecified' || !cookie.sameSite ? 'Lax' : cookie.sameSite,
            secure: cookie.sameSite === 'None' ? true : cookie.secure || false
        })).filter(cookie => cookie.name && cookie.domain);

        await context.addCookies(cleanedCookies);
        page = await context.newPage();
        // 监听页面错误，输出到CI日志，方便调试
        page.on('console', msg => msg.type() === 'error' && log('error', `页面控制台错误: ${msg.text()}`));
        page.on('pageerror', err => log('error', `页面运行错误: ${err.message}`));
        log('success', '✅ 浏览器启动完成，Cookie已注入');

        // ========== 4. 进入创作者中心私信页，校验登录态 ==========
        log('info', '🌐 正在进入抖音创作者中心私信页面');
        await page.goto(CREATOR_CHAT_URL, { waitUntil: 'networkidle', timeout: GOTO_TIMEOUT });
        await page.waitForTimeout(5000); // 等待页面完全渲染

        // 校验登录态是否有效
        const currentUrl = page.url();
        if (currentUrl.includes('login') || currentUrl.includes('passport') || currentUrl.includes('account')) {
            log('error', '❌ Cookie已失效，请重新获取抖音创作者中心的Cookie');
            process.exit(1);
        }
        log('success', '✅ 成功进入私信页面，登录态有效');

        // ========== 5. 核心逻辑：滚动扫描+匹配抖音号 ==========
        let pendingDyIds = [...targetDyIds];
        let foundUsers = [];
        log('info', `🔍 开始扫描，共${pendingDyIds.length}个待匹配抖音号`);

        for (let attempt = 0; attempt < MAX_SCROLL_ATTEMPTS && pendingDyIds.length > 0; attempt++) {
            log('info', `🔄 第${attempt + 1}/${MAX_SCROLL_ATTEMPTS}轮扫描，剩余待匹配: ${pendingDyIds.length}`);

            // 页面内执行扫描（已加async，await完全合法，无语法错误）
            const scanResult = await page.evaluate(async (targetIds) => {
                const result = { found: [], remaining: [...targetIds] };
                // 创作者中心全兼容用户名选择器，适配哈希类名
                const nameElements = Array.from(document.querySelectorAll(
                    'div[class*="user"] span, div[class*="name"], span[data-testid*="nickname"], div[data-testid*="user-name"]'
                )).filter(el => {
                    const text = el.textContent.trim();
                    return text && text.length > 1 && !text.includes('抖音号') && !text.includes('私信');
                });

                if (nameElements.length === 0) {
                    return result;
                }

                // 浏览器上下文内定义sleep，避免外部函数无法访问的问题
                const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

                // 遍历当前可见的所有用户
                for (const el of nameElements) {
                    const nickname = el.textContent.trim();
                    if (!nickname || result.remaining.length === 0) continue;

                    try {
                        // 滚动到元素，强制点击，避免遮挡
                        el.scrollIntoView({ block: 'center', behavior: 'auto' });
                        el.click({ force: true });
                        await sleep(1800); // 延长等待，确保弹窗完全渲染

                        // 双方案提取抖音号，适配创作者中心所有展示形式
                        let dyId = null;
                        // 方案1：匹配带前缀的抖音号
                        const prefixMatch = document.body.innerText.match(/抖音号\s*[:：]\s*([\w\.\-_]+)/i);
                        if (prefixMatch) dyId = prefixMatch[1].trim();
                        // 方案2：匹配资料卡内的纯抖音号
                        if (!dyId) {
                            const idElements = document.querySelectorAll('[class*="card"] span, [class*="user-info"] span, [class*="profile"] span');
                            for (const idEl of idElements) {
                                const text = idEl.textContent.trim();
                                if (/^[\w\.\-_]{6,20}$/.test(text) && targetIds.includes(text)) {
                                    dyId = text;
                                    break;
                                }
                            }
                        }

                        // 匹配成功，加入结果
                        if (dyId && result.remaining.includes(dyId)) {
                            result.found.push({ dyId, nickname });
                            result.remaining = result.remaining.filter(id => id !== dyId);
                        }
                    } catch (err) {
                        continue;
                    }
                }
                return result;
            }, pendingDyIds);

            // 处理本轮扫描结果
            if (scanResult.found.length > 0) {
                foundUsers = [...foundUsers, ...scanResult.found];
                pendingDyIds = scanResult.remaining;
                scanResult.found.forEach(item => log('success', `✅ 匹配成功: ${item.dyId} -> ${item.nickname}`));
            }

            // 全部匹配完成，提前退出
            if (pendingDyIds.length === 0) {
                log('success', '🎉 所有目标抖音号已全部匹配完成');
                break;
            }

            // 滚动加载更多用户，适配创作者中心虚拟滚动
            await page.evaluate((step) => {
                // 查找私信列表滚动容器
                function findScrollContainer() {
                    const allDivs = document.querySelectorAll('div');
                    for (const div of allDivs) {
                        const style = getComputedStyle(div);
                        const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
                        const isTallEnough = div.clientHeight > window.innerHeight * 0.6;
                        const hasUserItems = div.querySelector('[class*="user"]') || div.querySelector('[class*="message-item"]');
                        if (isScrollable && isTallEnough && hasUserItems) return div;
                    }
                    return document.scrollingElement || document.documentElement;
                }
                const container = findScrollContainer();
                // 双触发滚动，确保虚拟列表加载新内容
                container.dispatchEvent(new WheelEvent('wheel', {
                    deltaY: step,
                    bubbles: true,
                    cancelable: true,
                    composed: true
                }));
                container.scrollTop += step;
            }, SCROLL_STEP);

            // 等待虚拟列表渲染
            await page.waitForTimeout(1500);

            // 检测是否滚动到底部，避免死循环
            const isBottom = await page.evaluate(() => {
                function findScrollContainer() {
                    const allDivs = document.querySelectorAll('div');
                    for (const div of allDivs) {
                        const style = getComputedStyle(div);
                        const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
                        const isTallEnough = div.clientHeight > window.innerHeight * 0.6;
                        const hasUserItems = div.querySelector('[class*="user"]') || div.querySelector('[class*="message-item"]');
                        if (isScrollable && isTallEnough && hasUserItems) return div;
                    }
                    return document.scrollingElement || document.documentElement;
                }
                const container = findScrollContainer();
                return Math.abs(container.scrollHeight - container.scrollTop - container.clientHeight) < 50;
            });

            if (isBottom) {
                log('warn', '🚫 已滚动到私信列表底部，停止扫描');
                break;
            }
        }

        // ========== 6. 生成并写入users.txt ==========
        log('info', '📝 正在生成users.txt文件');
        let finalContent = '';
        // 按原Gitee列表顺序生成，匹配到的写昵称，未匹配到的写原抖音号
        targetDyIds.forEach(dyId => {
            const matchItem = foundUsers.find(item => item.dyId === dyId);
            finalContent += `${matchItem ? matchItem.nickname : dyId}\n`;
        });

        fs.writeFileSync(LOCAL_USERS_FILE, finalContent.trim(), 'utf8');
        log('success', `✅ users.txt文件已生成，共写入${targetDyIds.length}条数据`);
        log('info', `🏁 任务完成，成功匹配${foundUsers.length}/${targetDyIds.length}个抖音号`);

        // 输出未匹配的抖音号
        if (pendingDyIds.length > 0) {
            log('warn', `⚠️ 未匹配到的抖音号: ${pendingDyIds.join(', ')}`);
        }

    } catch (err) {
        // 全链路错误捕获，输出完整堆栈，方便调试
        log('error', `🚨 任务执行失败: ${err.message}`);
        log('error', '错误详情:', err.stack);
        process.exit(1);
    } finally {
        // 无论成功失败，都关闭浏览器，避免僵尸进程
        if (browser) {
            await browser.close();
            log('info', '✅ 浏览器已关闭');
        }
    }
}

// 执行主函数
runSync();
