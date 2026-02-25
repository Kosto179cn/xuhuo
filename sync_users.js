// sync_users.js
const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 配置信息
const GITEE_API_URL = 'https://gitee.com/api/v5/repos/Kosto179/kosto-battle-clicker-new/contents/douyinh.txt';
const LOCAL_USERS_FILE = 'users.txt';
const CREATOR_CHAT_URL = 'https://creator.douyin.com/creator-micro/data/following/chat';
const GOTO_TIMEOUT = 60000;
const MAX_SCROLL_ATTEMPTS = 80; // 创作者中心滚动轮次
const SCROLL_STEP = 800; // 每次滚动像素

// 日志函数
const log = (level, msg, ...args) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`, ...args);

async function runSync() {
    let browser, page;
    try {
        log('info', '🚀 开始同步用户列表...');

        // 1. 调用 Gitee API 获取抖音号列表
        log('info', '📥 正在调用 Gitee API 获取抖音号列表...');
        let giteeToken = process.env.GITEE_TOKEN;
        if (!giteeToken) {
            log('error', '❌ 致命错误：环境变量中没有读到 GITEE_TOKEN');
            log('error', '   请检查 .yml 文件中是否在 env 下配置了 GITEE_TOKEN: ${{ secrets.GITEE_TOKEN }}');
            process.exit(1);
        }
        giteeToken = giteeToken.trim();
        console.log(`✅ 成功读到 Token，长度为: ${giteeToken.length}`);

        const response = await axios.get(GITEE_API_URL, {
            params: { access_token: giteeToken },
            headers: { 'User-Agent': 'Mozilla/5.0 (Node.js/SyncScript)' }
        }).catch(error => {
            if (error.response) {
                log('error', `❌ Gitee API 请求失败: HTTP ${error.response.status}`);
                error.response.status === 401 && log('error', '   Token 无效或权限不足');
                error.response.status === 403 && log('error', '   访问被拒绝，请检查 Token 权限');
                error.response.status === 404 && log('error', `   文件未找到，当前路径: ${GITEE_API_URL}`);
            } else log('error', `❌ 网络请求失败: ${error.message}`);
            process.exit(1);
        });

        // 解析Base64内容，过滤空行/注释
        const fileContent = Buffer.from(response.data.content, 'base64').toString();
        const targetDyIds = fileContent.split('\n')
                                  .map(id => id.trim())
                                  .filter(id => id && !id.startsWith('#'));
        if (targetDyIds.length === 0) {
            log('error', '❌ 从Gitee获取的抖音号列表为空');
            process.exit(1);
        }
        log('success', `✅ 从 Gitee 获取到 ${targetDyIds.length} 个目标抖音号`);

        // 2. 启动浏览器并注入Cookie
        browser = await chromium.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // 适配CI环境
        });
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        });

        // 清理并注入抖音Cookie
        const rawCookies = JSON.parse(process.env.DOUYIN_COOKIES);
        const cleanedCookies = rawCookies.map(cookie => ({
            ...cookie,
            sameSite: cookie.sameSite === 'no_restriction' ? 'None' : 
                     cookie.sameSite === 'unspecified' ? 'Lax' : cookie.sameSite || 'Lax',
            secure: cookie.sameSite === 'None' ? true : cookie.secure
        })).filter(cookie => cookie.name && cookie.domain);
        await context.addCookies(cleanedCookies);

        page = await context.newPage();
        // 监听控制台错误，便于调试
        page.on('console', msg => msg.type() === 'error' && log('error', `页面错误: ${msg.text()}`));

        // 3. 进入抖音创作者中心私信页
        log('info', '🌐 正在进入抖音创作者后台私信页面...');
        await page.goto(CREATOR_CHAT_URL, { waitUntil: 'networkidle', timeout: GOTO_TIMEOUT });
        await page.waitForTimeout(5000); // 等待页面完全渲染

        // 验证Cookie有效性
        if (page.url().includes('login') || page.url().includes('passport')) {
            log('error', '❌ Cookie已失效，请重新获取抖音创作者中心Cookie');
            process.exit(1);
        }
        log('success', '✅ 成功进入创作者中心私信页面，Cookie有效');

        // 4. 核心逻辑：适配创作者中心的抖音号&昵称匹配（整合控制台脚本核心）
        let pendingDyIds = [...targetDyIds];
        let foundUsers = []; // 存储{dyId, nickname}，避免重复
        log('info', `🔍 开始查找 ${pendingDyIds.length} 个抖音号对应的昵称...`);

        // 注入创作者中心专属的查找&滚动方法到页面上下文
        await page.exposeFunction('logPage', (msg) => log('info', `页面日志: ${msg}`));

        for (let attempt = 0; attempt < MAX_SCROLL_ATTEMPTS && pendingDyIds.length > 0; attempt++) {
            log('info', `🔄 第 ${attempt + 1}/${MAX_SCROLL_ATTEMPTS} 轮扫描，剩余待查找: ${pendingDyIds.length}`);

            // 页面内执行查找：匹配可见用户，提取抖音号【修复核心：加async】
            const scanResult = await page.evaluate(async (pendingIds) => {
                const result = { found: [], remaining: [...pendingIds] };
                // 创作者中心用户名选择器（适配哈希类名）
                const nameElements = Array.from(document.querySelectorAll(
                    'div[class*="user"] span, div[class*="name"], [data-testid*="nickname"]'
                )).filter(el => {
                    const t = el.textContent.trim();
                    return t && t.length > 1 && !t.includes('抖音号');
                });

                if (nameElements.length === 0) return result;

                // 遍历可见用户
                for (const el of nameElements) {
                    const nickname = el.textContent.trim();
                    if (!nickname) continue;

                    try {
                        // 点击用户，触发资料弹窗
                        el.scrollIntoView({ block: 'center' });
                        el.click();
                        // 等待弹窗渲染
                        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
                        await sleep(1500);

                        // 提取抖音号：适配创作者中心两种展示方式
                        let dyId = null;
                        // 方式1：匹配"抖音号：xxx"明文
                        const globalMatch = document.body.innerText.match(/抖音号\s*[:：]\s*([\w\.\-_]+)/i);
                        if (globalMatch) dyId = globalMatch[1].trim();
                        // 方式2：匹配资料卡中的纯抖音号（无前缀）
                        if (!dyId) {
                            const cardElements = document.querySelectorAll('[class*="card"] [class*="id"], [class*="info"] span');
                            for (const card of cardElements) {
                                const text = card.textContent.trim();
                                if (/^[\w\.\-_]{6,}$/.test(text) && pendingIds.includes(text)) {
                                    dyId = text;
                                    break;
                                }
                            }
                        }

                        // 命中目标抖音号，加入结果
                        if (dyId && pendingIds.includes(dyId) && !result.found.some(item => item.dyId === dyId)) {
                            result.found.push({ dyId, nickname });
                            result.remaining = result.remaining.filter(id => id !== dyId);
                        }
                    } catch (e) {
                        continue;
                    }
                }
                return result;
            }, pendingDyIds);

            // 处理本轮扫描结果
            if (scanResult.found.length > 0) {
                foundUsers = [...foundUsers, ...scanResult.found];
                pendingDyIds = scanResult.remaining;
                scanResult.found.forEach(item => log('success', `🔗 找到: ${item.dyId} -> ${item.nickname}`));
            }

            // 滚动加载更多：创作者中心专属滚动逻辑（适配虚拟滚动）
            await page.evaluate((scrollStep) => {
                // 查找创作者中心私信滚动容器
                function findScrollContainer() {
                    const allDivs = document.querySelectorAll('div');
                    for (const div of allDivs) {
                        const style = getComputedStyle(div);
                        const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
                        const isTall = div.clientHeight > window.innerHeight * 0.65;
                        const hasItems = div.querySelector('[class*="user"]') || div.querySelector('[class*="message"]');
                        if (isScrollable && isTall && hasItems) return div;
                    }
                    return document.scrollingElement || document.documentElement;
                }

                const container = findScrollContainer();
                // 虚拟滚动适配：先dispatch滚轮事件，再强制修改scrollTop
                container.dispatchEvent(new WheelEvent('wheel', {
                    deltaY: scrollStep,
                    bubbles: true,
                    cancelable: true,
                    composed: true
                }));
                container.scrollTop += scrollStep;
            }, SCROLL_STEP);

            // 等待虚拟列表渲染新内容
            await page.waitForTimeout(1200);

            // 检测是否滚动到底部
            const isBottom = await page.evaluate(() => {
                function findScrollContainer() {
                    const allDivs = document.querySelectorAll('div');
                    for (const div of allDivs) {
                        const style = getComputedStyle(div);
                        const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
                        const isTall = div.clientHeight > window.innerHeight * 0.65;
                        const hasItems = div.querySelector('[class*="user"]') || div.querySelector('[class*="message"]');
                        if (isScrollable && isTall && hasItems) return div;
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

        // 5. 生成本地文件内容
        let fileContent = '';
        const foundCount = foundUsers.length;
        const totalCount = targetDyIds.length;
        // 按原Gitee抖音号顺序排列，匹配到的输出昵称，未匹配到的输出原抖音号
        targetDyIds.forEach(dyId => {
            const match = foundUsers.find(item => item.dyId === dyId);
            fileContent += `${match ? match.nickname : dyId}\n`;
        });

        // 写入本地users.txt
        fs.writeFileSync(LOCAL_USERS_FILE, fileContent.trim(), 'utf8');
        log('success', `🎉 成功更新 ${LOCAL_USERS_FILE} 文件`);
        log('info', `🏁 同步任务结束，共找到 ${foundCount}/${totalCount} 个抖音号对应昵称`);

        // 输出未找到的抖音号
        if (pendingDyIds.length > 0) {
            log('warn', `⚠️ 未找到的抖音号: ${pendingDyIds.join(', ')}`);
        }

    } catch (error) {
        log('error', `🚨 同步过程发生致命错误: ${error.message}`);
        log('error', error.stack);
        process.exit(1);
    } finally {
        // 确保浏览器关闭
        if (browser) await browser.close();
        log('info', '✅ 浏览器已关闭，脚本执行完毕');
    }
}

// 执行主函数
runSync();
