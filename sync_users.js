// sync_users.js 超时修复版
const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');

// 固定配置
const GITEE_API_URL = 'https://gitee.com/api/v5/repos/Kosto179/kosto-battle-clicker-new/contents/douyinh.txt';
const LOCAL_USERS_FILE = 'users.txt';
const CREATOR_CHAT_URL = 'https://creator.douyin.com/creator-micro/data/following/chat';
const GOTO_TIMEOUT = 120000; // 超时时间延长到120秒，适配CI环境慢网络

// 日志函数
const log = (level, msg, ...args) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`, ...args);

// 主函数
async function runSync() {
    let browser = null;
    let page = null;
    try {
        log('info', '🚀 启动抖音用户同步脚本（超时修复版）');

        // ========== 1. 环境变量校验 ==========
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
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
            timeout: 30000
        }).catch(err => {
            if (err.response) {
                log('error', `❌ Gitee API请求失败，状态码: ${err.response.status}`);
                err.response.status === 401 && log('error', '   原因：Gitee Token无效或无仓库权限');
                err.response.status === 404 && log('error', '   原因：仓库/文件路径不存在');
            } else {
                log('error', `❌ Gitee API网络请求失败: ${err.message}`);
            }
            process.exit(1);
        });

        // 解析Base64内容，过滤空行、注释
        const rawFileContent = Buffer.from(giteeRes.data.content, 'base64').toString();
        const TARGET_DOUYIN_IDS = rawFileContent.split('\n')
            .map(id => id.trim())
            .filter(id => id && !id.startsWith('#'));

        if (TARGET_DOUYIN_IDS.length === 0) {
            log('error', '❌ 从Gitee拉取的抖音号列表为空');
            process.exit(1);
        }
        log('success', `✅ 成功拉取到${TARGET_DOUYIN_IDS.length}个目标抖音号`);

        // ========== 3. 启动浏览器，注入Cookie，增加反爬绕过 ==========
        log('info', '🌐 正在启动无头浏览器');
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled', // 核心反爬：隐藏无头浏览器特征
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ]
        });

        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            ignoreHTTPSErrors: true,
            javaScriptEnabled: true
        });

        // 注入反爬脚本，隐藏自动化特征
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh'] });
            window.chrome = { runtime: {} };
        });

        // 清理并注入Cookie
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
        // 只监听致命页面错误，过滤无关的CSP、CORS警告
        page.on('pageerror', err => log('error', `页面运行错误: ${err.message}`));
        log('success', '✅ 浏览器启动完成，Cookie已注入，反爬配置已生效');

        // ================= 【核心修复：彻底解决超时问题的页面加载逻辑】 =================
        log('info', '🌐 正在进入抖音创作者中心私信页面，等待页面加载...');
        // 1. 把networkidle改成domcontentloaded，只等DOM结构渲染完成，不等永远停不下来的埋点请求
        await page.goto(CREATOR_CHAT_URL, { 
            waitUntil: 'domcontentloaded', 
            timeout: GOTO_TIMEOUT 
        });

        // 2. 智能等待：先等3秒基础渲染，再校验登录态，再等核心列表元素出现
        await page.waitForTimeout(3000);
        const currentUrl = page.url();
        if (currentUrl.includes('login') || currentUrl.includes('passport') || currentUrl.includes('account') || currentUrl.includes('verify')) {
            log('error', '❌ Cookie已失效/触发人机验证，请重新获取抖音创作者中心的Cookie');
            process.exit(1);
        }
        log('success', '✅ 页面跳转完成，登录态有效');

        // 3. 等待核心元素（用户昵称列表）渲染出来，确保页面真的加载完成，才执行后续操作
        await page.waitForSelector('span[class*="name"], div[class*="name"], [class*="user-item"]', { 
            timeout: 60000,
            state: 'attached'
        });
        log('success', '✅ 页面100%加载完成，用户列表已渲染，开始执行扫描逻辑');

        // ================= 【1:1完全复刻原控制台核心逻辑，无任何修改】 =================
        const scanResult = await page.evaluate(async (TARGET_DOUYIN_IDS) => {
            const results = [];
            const processedNicknames = new Set();
            let remaining = [...TARGET_DOUYIN_IDS]; 
            const MAX_SCROLL_ATTEMPTS = 80;
            const SCROLL_STEP = 500;

            const sleep = (ms) => new Promise(r => setTimeout(r, ms));

            // 完全复刻原控制台的鼠标事件函数
            function triggerMouseEvent(element, eventType) {
                if (!element) return;
                const rect = element.getBoundingClientRect();
                const event = new MouseEvent(eventType, {
                    bubbles: true, cancelable: true, view: window,
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top + rect.height / 2
                });
                element.dispatchEvent(event);
            }

            // 完全复刻原控制台的容器查找函数，仅适配创作者中心
            function findContainer() {
                const divs = document.querySelectorAll('div');
                for (const div of divs) {
                    const style = window.getComputedStyle(div);
                    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && div.scrollHeight > div.clientHeight) {
                        const rect = div.getBoundingClientRect();
                        if (rect.height > 300) {
                            return div;
                        }
                    }
                }
                return document.querySelector('.ReactVirtualized__Grid') || document.querySelector('[role="grid"]') || document.scrollingElement;
            }

            // 完全复刻原控制台的“查看Ta的主页”查找函数
            function findHoverTarget() {
                const elements = document.querySelectorAll('span, div');
                for (const el of elements) {
                    if (el.textContent.trim() === '查看Ta的主页') {
                        return el;
                    }
                }
                return null;
            }

            // React虚拟滚动兼容函数
            async function scrollReactList(container, step) {
                const prevScroll = container.scrollTop;
                container.scrollBy({ top: step, behavior: 'smooth' });
                // 模拟鼠标滚轮，触发React列表渲染
                for (let i = 0; i < 5; i++) {
                    container.dispatchEvent(new WheelEvent('wheel', {
                        deltaY: step / 5,
                        bubbles: true,
                        cancelable: true,
                        composed: true
                    }));
                    await sleep(30);
                }
                await sleep(1000);
                return Math.abs(container.scrollTop - prevScroll) < 5;
            }

            // 完全复刻原控制台的主逻辑
            try {
                const container = findContainer();
                if (!container) throw new Error("未找到用户列表容器");
                console.log("✅ 容器已锁定，开始扫描...");

                for (let attempt = 0; attempt < MAX_SCROLL_ATTEMPTS && remaining.length > 0; attempt++) {
                    console.log(`🔄 第 ${attempt + 1} 轮扫描 (剩余目标: ${remaining.length})`);
                    
                    const nameElements = Array.from(document.querySelectorAll('span[class*="name"]'));
                    
                    if (nameElements.length === 0) {
                        console.warn("⚠️ 当前页面未找到用户名，尝试滚动...");
                        const isBottom = await scrollReactList(container, SCROLL_STEP);
                        if (isBottom) {
                            console.warn("🚫 列表已到底部，停止扫描");
                            break;
                        }
                        continue;
                    }

                    for (const el of nameElements) {
                        const nickname = el.textContent.trim();
                        if (!nickname || processedNicknames.has(nickname)) continue;
                        processedNicknames.add(nickname);

                        // 完全复刻原控制台的点击、悬停、提取逻辑
                        el.scrollIntoView({ block: "center" });
                        el.click();
                        await sleep(1500);

                        const hoverTarget = findHoverTarget();
                        if (!hoverTarget) continue;

                        hoverTarget.scrollIntoView({ block: "center" });
                        triggerMouseEvent(hoverTarget, 'mousemove');
                        await sleep(50);
                        triggerMouseEvent(hoverTarget, 'mouseenter');
                        triggerMouseEvent(hoverTarget, 'mouseover');

                        // 完全复刻原20次循环提取抖音号逻辑
                        let dyId = null;
                        for (let i = 0; i < 20; i++) {
                            await sleep(100);
                            const match = document.body.innerText.match(/抖音号\s*[:：]\s*([\w\.\-_]+)/);
                            if (match) {
                                dyId = match[1].trim();
                                break;
                            }
                        }

                        triggerMouseEvent(hoverTarget, 'mouseleave');

                        if (dyId && TARGET_DOUYIN_IDS.includes(dyId)) {
                            console.log(`✅ 命中: ${dyId} | 昵称: ${nickname}`);
                            results.push({ id: dyId, nickname: nickname });
                            remaining = remaining.filter(id => id !== dyId);
                        }

                        await sleep(300);
                    }

                    if (remaining.length > 0) {
                        const isBottom = await scrollReactList(container, SCROLL_STEP);
                        if (isBottom) {
                            console.warn("🚫 列表已到底部，停止扫描");
                            break;
                        }
                    }
                }

                // 完全复刻原控制台的结果处理
                console.log("================ 🏁 最终结果 ================");
                if (results.length > 0) {
                    console.table(results);
                    let content = "";
                    TARGET_DOUYIN_IDS.forEach(id => {
                        const res = results.find(r => r.id === id);
                        content += res ? `${res.nickname}\n` : `${id}\n`;
                    });
                    return { success: true, results, content, remaining };
                } else {
                    return { success: false, results: [], content: TARGET_DOUYIN_IDS.join('\n'), remaining };
                }

            } catch (error) {
                console.error("💥 脚本出错:", error);
                return { success: false, error: error.message, content: TARGET_DOUYIN_IDS.join('\n') };
            }
        }, TARGET_DOUYIN_IDS);

        // ========== 4. 结果处理与文件写入 ==========
        log('info', '📝 扫描完成，正在生成users.txt文件');
        if (!scanResult.success && scanResult.error) {
            log('warn', `⚠️ 扫描过程出现异常: ${scanResult.error}`);
        }

        fs.writeFileSync(LOCAL_USERS_FILE, scanResult.content.trim(), 'utf8');
        log('success', `✅ users.txt文件已成功生成，共写入${TARGET_DOUYIN_IDS.length}条数据`);
        log('info', `🏁 任务全部完成，成功匹配${scanResult.results?.length || 0}/${TARGET_DOUYIN_IDS.length}个抖音号`);

        if (scanResult.remaining?.length > 0) {
            log('warn', `⚠️ 未找到的抖音号: ${scanResult.remaining.join(', ')}`);
        }

    } catch (err) {
        log('error', `🚨 任务执行失败: ${err.message}`);
        log('error', '错误详情:', err.stack);
        process.exit(1);
    } finally {
        if (browser) {
            await browser.close();
            log('info', '✅ 浏览器已关闭，脚本执行完毕');
        }
    }
}

runSync();
