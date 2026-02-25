// sync_users.js 全量遍历标记版
const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');

// 固定配置
const GITEE_API_URL = 'https://gitee.com/api/v5/repos/Kosto179/kosto-battle-clicker-new/contents/douyinh.txt';
const LOCAL_USERS_FILE = 'users.txt';
const CREATOR_CHAT_URL = 'https://creator.douyin.com/creator-micro/data/following/chat';
const GOTO_TIMEOUT = 120000;

// 日志函数
const log = (level, msg, ...args) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`, ...args);

// 主函数
async function runSync() {
    let browser = null;
    let page = null;
    try {
        log('info', '🚀 启动抖音用户全量遍历同步脚本（已查看标记版）');

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

        // ========== 3. 启动浏览器，注入Cookie，反爬配置 ==========
        log('info', '🌐 正在启动无头浏览器');
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
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

        // 注入反爬脚本
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
        page.on('pageerror', err => log('error', `页面运行错误: ${err.message}`));
        log('success', '✅ 浏览器启动完成，Cookie已注入');

        // ========== 4. 页面加载逻辑（修复超时问题） ==========
        log('info', '🌐 正在进入抖音创作者中心私信页面，等待页面加载...');
        await page.goto(CREATOR_CHAT_URL, { 
            waitUntil: 'domcontentloaded', 
            timeout: GOTO_TIMEOUT 
        });

        // 校验登录态
        await page.waitForTimeout(3000);
        const currentUrl = page.url();
        if (currentUrl.includes('login') || currentUrl.includes('passport') || currentUrl.includes('verify')) {
            log('error', '❌ Cookie已失效/触发人机验证，请重新获取Cookie');
            process.exit(1);
        }

        // 等待核心列表元素渲染，确保页面加载完成
        await page.waitForSelector('span[class*="name"], div[class*="name"], [class*="user-item"]', { 
            timeout: 60000,
            state: 'attached'
        });
        log('success', '✅ 页面加载完成，用户列表已渲染，开始全量遍历扫描');

        // ================= 【核心逻辑：全量遍历+已查看标记+重复跳过】 =================
        const scanResult = await page.evaluate(async (TARGET_DOUYIN_IDS) => {
            // 结果存储
            const results = [];
            // ================= 核心标记机制 =================
            // 1. 内存Set：永久存储已处理的用户昵称，刷新/回滚都不会丢
            const processedNicknames = new Set();
            // 2. DOM自定义属性：给已处理的元素加标记，避免同昵称重复处理
            const PROCESSED_ATTR = 'data-user-processed';
            // ================================================
            let remainingTargets = [...TARGET_DOUYIN_IDS]; 
            const MAX_SCROLL_ATTEMPTS = 100; // 加大轮次，确保遍历完整个列表
            const SCROLL_STEP = 400; // 减小步长，避免跳过用户
            let noNewUserCount = 0; // 连续无新用户计数，判断是否到底

            const sleep = (ms) => new Promise(r => setTimeout(r, ms));

            // 原控制台鼠标事件函数，完全保留
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

            // 滚动容器查找，完全保留原逻辑
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

            // 查看Ta的主页查找，完全保留原逻辑
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
            async function scrollList(container, step) {
                const prevScroll = container.scrollTop;
                // 先模拟滚轮，触发React渲染
                for (let i = 0; i < 4; i++) {
                    container.dispatchEvent(new WheelEvent('wheel', {
                        deltaY: step / 4,
                        bubbles: true,
                        cancelable: true,
                        composed: true
                    }));
                    await sleep(50);
                }
                // 再强制滚动兜底
                container.scrollBy({ top: step, behavior: 'smooth' });
                await sleep(1000);
                // 返回是否滚动到底
                return Math.abs(container.scrollTop - prevScroll) < 10;
            }

            // 主遍历逻辑
            try {
                const container = findContainer();
                if (!container) throw new Error("未找到用户列表容器");
                console.log("✅ 列表容器已锁定，开始全量遍历");

                for (let attempt = 0; attempt < MAX_SCROLL_ATTEMPTS; attempt++) {
                    console.log(`\n🔄 第 ${attempt + 1} 轮遍历 | 已处理用户数: ${processedNicknames.size} | 剩余目标: ${remainingTargets.length}`);
                    
                    // 获取当前页所有可见的用户昵称元素
                    const allNameElements = Array.from(document.querySelectorAll('span[class*="name"], div[class*="name"]'));
                    // 过滤出【未被处理过】的用户元素
                    const unprocessedElements = allNameElements.filter(el => {
                        const nickname = el.textContent.trim();
                        // 双重校验：内存Set里没有 + DOM没有标记属性
                        return nickname && !processedNicknames.has(nickname) && !el.hasAttribute(PROCESSED_ATTR);
                    });

                    // ================= 核心逻辑：无新用户直接下滑 =================
                    if (unprocessedElements.length === 0) {
                        console.log("⚠️ 当前页无未处理用户，直接下滑加载更多");
                        noNewUserCount++;
                        // 连续3轮无新用户，判断已到底部
                        if (noNewUserCount >= 3) {
                            console.log("🚫 连续3轮无新用户，列表已到底部，停止遍历");
                            break;
                        }
                        // 直接下滑，跳过后续处理
                        const isBottom = await scrollList(container, SCROLL_STEP);
                        if (isBottom) {
                            console.log("🚫 已滚动到列表最底部，停止遍历");
                            break;
                        }
                        continue;
                    }

                    // 重置无新用户计数
                    noNewUserCount = 0;
                    console.log(`📝 当前页找到 ${unprocessedElements.length} 个未处理用户，开始挨个查看`);

                    // ================= 挨个处理未查看的用户 =================
                    for (const el of unprocessedElements) {
                        const nickname = el.textContent.trim();
                        // 二次校验，避免重复处理
                        if (processedNicknames.has(nickname) || el.hasAttribute(PROCESSED_ATTR)) {
                            continue;
                        }

                        console.log(`👤 正在查看用户: ${nickname}`);
                        // 1. 点击用户，进入聊天页（完全保留原逻辑）
                        el.scrollIntoView({ block: "center", behavior: "auto" });
                        await sleep(100);
                        el.click({ force: true });
                        await sleep(1500);

                        // 2. 查找悬停目标（完全保留原逻辑）
                        const hoverTarget = findHoverTarget();
                        let dyId = null;

                        if (hoverTarget) {
                            // 3. 悬停触发弹窗（完全保留原逻辑）
                            hoverTarget.scrollIntoView({ block: "center", behavior: "auto" });
                            triggerMouseEvent(hoverTarget, 'mousemove');
                            await sleep(50);
                            triggerMouseEvent(hoverTarget, 'mouseenter');
                            triggerMouseEvent(hoverTarget, 'mouseover');

                            // 4. 提取抖音号（完全保留原20次循环重试逻辑）
                            for (let i = 0; i < 20; i++) {
                                await sleep(100);
                                const match = document.body.innerText.match(/抖音号\s*[:：]\s*([\w\.\-_]+)/);
                                if (match) {
                                    dyId = match[1].trim();
                                    break;
                                }
                            }

                            // 5. 清理鼠标离开
                            triggerMouseEvent(hoverTarget, 'mouseleave');
                        }

                        // ================= 核心：标记为已查看（无论是否匹配目标，都标记） =================
                        processedNicknames.add(nickname);
                        el.setAttribute(PROCESSED_ATTR, 'true');
                        console.log(`✅ 已标记用户: ${nickname} | 提取抖音号: ${dyId || '未提取到'}`);

                        // 6. 目标匹配逻辑（完全保留原逻辑）
                        if (dyId && TARGET_DOUYIN_IDS.includes(dyId) && remainingTargets.includes(dyId)) {
                            console.log(`%c🎯 命中目标用户: ${dyId} | 昵称: ${nickname}`, "color: #4CAF50; font-weight: bold;");
                            results.push({ id: dyId, nickname: nickname });
                            remainingTargets = remainingTargets.filter(id => id !== dyId);
                        }

                        // 所有目标都已找到，提前终止
                        if (remainingTargets.length === 0) {
                            console.log("🎉 所有目标抖音号已全部找到，提前结束遍历");
                            break;
                        }

                        // 操作间隔，避免被反爬
                        await sleep(300);
                    }

                    // 所有目标都已找到，跳出循环
                    if (remainingTargets.length === 0) break;

                    // 处理完当前页所有用户，自动下滑加载下一页
                    console.log("📥 当前页所有用户处理完毕，下滑加载更多");
                    const isBottom = await scrollList(container, SCROLL_STEP);
                    if (isBottom) {
                        console.log("🚫 已滚动到列表最底部，停止遍历");
                        break;
                    }
                }

                // 结果处理（完全保留原逻辑）
                console.log("\n================ 🏁 遍历最终结果 ================");
                if (results.length > 0) {
                    console.table(results);
                    let content = "";
                    TARGET_DOUYIN_IDS.forEach(id => {
                        const res = results.find(r => r.id === id);
                        content += res ? `${res.nickname}\n` : `${id}\n`;
                    });
                    return { 
                        success: true, 
                        results, 
                        content, 
                        remainingTargets, 
                        processedCount: processedNicknames.size,
                        totalScanned: processedNicknames.size
                    };
                } else {
                    return { 
                        success: false, 
                        results: [], 
                        content: TARGET_DOUYIN_IDS.join('\n'), 
                        remainingTargets,
                        processedCount: processedNicknames.size,
                        totalScanned: processedNicknames.size
                    };
                }

            } catch (error) {
                console.error("💥 遍历过程出错:", error);
                return { 
                    success: false, 
                    error: error.message, 
                    content: TARGET_DOUYIN_IDS.join('\n'),
                    processedCount: processedNicknames.size
                };
            }
        }, TARGET_DOUYIN_IDS);

        // ========== 5. 结果处理与文件写入 ==========
        log('info', `📝 遍历完成，共扫描了${scanResult.processedCount || 0}个用户`);
        if (!scanResult.success && scanResult.error) {
            log('warn', `⚠️ 遍历过程出现异常: ${scanResult.error}`);
        }

        // 写入users.txt
        fs.writeFileSync(LOCAL_USERS_FILE, scanResult.content.trim(), 'utf8');
        log('success', `✅ users.txt文件已成功生成，共写入${TARGET_DOUYIN_IDS.length}条数据`);
        log('info', `🏁 任务全部完成，成功匹配${scanResult.results?.length || 0}/${TARGET_DOUYIN_IDS.length}个目标抖音号`);

        if (scanResult.remainingTargets?.length > 0) {
            log('warn', `⚠️ 未找到的目标抖音号: ${scanResult.remainingTargets.join(', ')}`);
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
