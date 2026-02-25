// sync_users.js 标准Node.js脚本（完全复刻原控制台逻辑+全量加载等待）
const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');

// 固定配置
const GITEE_API_URL = 'https://gitee.com/api/v5/repos/Kosto179/kosto-battle-clicker-new/contents/douyinh.txt';
const LOCAL_USERS_FILE = 'users.txt';
const CREATOR_CHAT_URL = 'https://creator.douyin.com/creator-micro/data/following/chat';
const GOTO_TIMEOUT = 60000;

// 日志函数
const log = (level, msg, ...args) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`, ...args);

// 主函数
async function runSync() {
    let browser = null;
    let page = null;
    try {
        log('info', '🚀 启动抖音用户同步脚本（原控制台逻辑1:1复刻版）');

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
            headers: { 'User-Agent': 'Mozilla/5.0 (Node.js Playwright Sync Script)' },
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

        // 解析Base64内容，过滤空行、注释，和原控制台配置区完全对齐
        const rawFileContent = Buffer.from(giteeRes.data.content, 'base64').toString();
        const TARGET_DOUYIN_IDS = rawFileContent.split('\n')
            .map(id => id.trim())
            .filter(id => id && !id.startsWith('#'));

        if (TARGET_DOUYIN_IDS.length === 0) {
            log('error', '❌ 从Gitee拉取的抖音号列表为空');
            process.exit(1);
        }
        log('success', `✅ 成功拉取到${TARGET_DOUYIN_IDS.length}个目标抖音号`);

        // ========== 3. 启动浏览器，注入Cookie ==========
        log('info', '🌐 正在启动无头浏览器');
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            ignoreHTTPSErrors: true
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
        // 监听页面错误，方便调试
        page.on('console', msg => msg.type() === 'error' && log('error', `页面错误: ${msg.text()}`));
        page.on('pageerror', err => log('error', `页面运行错误: ${err.message}`));
        log('success', '✅ 浏览器启动完成，Cookie已注入');

        // ================= 【核心要求：先等待网页100%加载完毕，再执行所有操作】 =================
        log('info', '🌐 正在进入抖音创作者中心私信页面，等待页面完全加载...');
        // 第1层：等待页面跳转完成，网络完全空闲（所有接口请求都完成）
        await page.goto(CREATOR_CHAT_URL, { 
            waitUntil: 'networkidle', 
            timeout: GOTO_TIMEOUT 
        });
        // 第2层：固定等待8秒，给React单页应用足够的时间完成客户端渲染
        await page.waitForTimeout(8000);
        // 第3层：等待核心元素（用户昵称）渲染出来，确保列表真的加载完成，超时30秒
        await page.waitForSelector('span[class*="name"], div[class*="name"]', { 
            timeout: 30000,
            state: 'attached'
        });
        // 第4层：校验登录态，确保不是登录页
        const currentUrl = page.url();
        if (currentUrl.includes('login') || currentUrl.includes('passport') || currentUrl.includes('account')) {
            log('error', '❌ Cookie已失效，请重新获取抖音创作者中心的Cookie');
            process.exit(1);
        }
        log('success', '✅ 页面100%加载完成，核心元素已渲染，开始执行核心扫描逻辑');

        // ================= 【1:1完全复刻你给的控制台脚本核心逻辑，无任何修改】 =================
        // 把原控制台的逻辑完整注入到页面上下文执行，完全对齐原逻辑
        const scanResult = await page.evaluate(async (TARGET_DOUYIN_IDS) => {
            // 完全复刻原控制台的变量定义
            const results = [];
            const processedNicknames = new Set(); // 防重复处理
            let remaining = [...TARGET_DOUYIN_IDS]; 
            const MAX_SCROLL_ATTEMPTS = 80;
            const SCROLL_STEP = 500;

            // 完全复刻原控制台的sleep函数
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));

            // 完全复刻原控制台的模拟鼠标事件函数，无任何修改
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

            // 完全复刻原控制台的容器查找函数，仅加React虚拟列表兼容兜底
            function findContainer() {
                const divs = document.querySelectorAll('div');
                for (const div of divs) {
                    const style = window.getComputedStyle(div);
                    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && div.scrollHeight > div.clientHeight) {
                        const rect = div.getBoundingClientRect();
                        // 仅去掉原宽度限制，适配创作者中心，其余逻辑完全不变
                        if (rect.height > 300) {
                            return div;
                        }
                    }
                }
                // 兜底React虚拟列表标准容器，和原逻辑一致
                return document.querySelector('.ReactVirtualized__Grid') || document.querySelector('[role="grid"]') || document.scrollingElement;
            }

            // 完全复刻原控制台的“查看Ta的主页”查找函数，无任何修改
            function findHoverTarget() {
                const elements = document.querySelectorAll('span, div');
                for (const el of elements) {
                    if (el.textContent.trim() === '查看Ta的主页') {
                        return el;
                    }
                }
                return null;
            }

            // React虚拟滚动兼容函数，仅增强滚动触发，不修改原逻辑
            async function scrollReactList(container, step) {
                const prevScroll = container.scrollTop;
                // 方式1：完全复刻原控制台的scrollBy逻辑
                container.scrollBy({ top: step, behavior: 'smooth' });
                // 方式2：模拟鼠标滚轮，触发React虚拟列表渲染，解决滚动失效
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
                // 返回和原逻辑一致的滚动结果
                return Math.abs(container.scrollTop - prevScroll) < 5;
            }

            // 完全复刻原控制台的try-catch主逻辑
            try {
                const container = findContainer();
                if (!container) throw new Error("未找到用户列表容器，请确保在私信页面");
                console.log("✅ 容器已锁定，开始扫描...");

                // 完全复刻原控制台的循环扫描逻辑
                for (let attempt = 0; attempt < MAX_SCROLL_ATTEMPTS && remaining.length > 0; attempt++) {
                    console.log(`🔄 第 ${attempt + 1} 轮扫描 (剩余目标: ${remaining.length})`);
                    
                    // 完全复刻原控制台的昵称元素获取逻辑
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

                    // 完全复刻原控制台的用户遍历、点击、悬停、提取逻辑，无任何修改
                    for (const el of nameElements) {
                        const nickname = el.textContent.trim();
                        if (!nickname || processedNicknames.has(nickname)) continue;
                        processedNicknames.add(nickname);

                        // 1. 点击用户，完全复刻原逻辑
                        el.scrollIntoView({ block: "center" });
                        el.click();
                        await sleep(1500); // 完全复刻原等待时长

                        // 2. 查找悬停目标，完全复刻原逻辑
                        const hoverTarget = findHoverTarget();
                        if (!hoverTarget) continue;

                        // 3. 悬停触发，完全复刻原逻辑
                        hoverTarget.scrollIntoView({ block: "center" });
                        triggerMouseEvent(hoverTarget, 'mousemove');
                        await sleep(50);
                        triggerMouseEvent(hoverTarget, 'mouseenter');
                        triggerMouseEvent(hoverTarget, 'mouseover');

                        // 4. 提取抖音号，完全复刻原20次循环重试逻辑，无任何修改
                        let dyId = null;
                        for (let i = 0; i < 20; i++) {
                            await sleep(100);
                            const match = document.body.innerText.match(/抖音号\s*[:：]\s*([\w\.\-_]+)/);
                            if (match) {
                                dyId = match[1].trim();
                                break;
                            }
                        }

                        // 5. 清理鼠标离开，完全复刻原逻辑
                        triggerMouseEvent(hoverTarget, 'mouseleave');

                        // 6. 比对、结果存储、remaining过滤，完全复刻原逻辑
                        if (dyId && TARGET_DOUYIN_IDS.includes(dyId)) {
                            console.log(`✅ 命中: ${dyId} | 昵称: ${nickname}`);
                            results.push({ id: dyId, nickname: nickname });
                            remaining = remaining.filter(id => id !== dyId);
                        }

                        // 完全复刻原停顿时长
                        await sleep(300);
                    }

                    // 滚动列表，完全复刻原逻辑，仅加React兼容
                    if (remaining.length > 0) {
                        const isBottom = await scrollReactList(container, SCROLL_STEP);
                        if (isBottom) {
                            console.warn("🚫 列表似乎已到底部，停止扫描");
                            break;
                        }
                    }
                }

                // 完全复刻原控制台的结果处理逻辑
                console.log("================ 🏁 最终结果 ================");
                if (results.length > 0) {
                    console.table(results);
                    let content = "";
                    TARGET_DOUYIN_IDS.forEach(id => {
                        const res = results.find(r => r.id === id);
                        if (res) content += `${res.nickname}\n`;
                        else content += `${id}\n`; // 未匹配到的保留原抖音号，和原工作流一致
                    });
                    console.log("📄 最终生成内容:", content);
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
        if (!scanResult.success) {
            log('warn', '⚠️ 扫描过程出现异常，使用原始抖音号列表生成文件');
        }

        // 写入users.txt，和原工作流完全对齐
        fs.writeFileSync(LOCAL_USERS_FILE, scanResult.content.trim(), 'utf8');
        log('success', `✅ users.txt文件已成功生成，共写入${TARGET_DOUYIN_IDS.length}条数据`);
        log('info', `🏁 任务全部完成，成功匹配${scanResult.results?.length || 0}/${TARGET_DOUYIN_IDS.length}个抖音号`);

        if (scanResult.remaining?.length > 0) {
            log('warn', `⚠️ 未找到的抖音号: ${scanResult.remaining.join(', ')}`);
        }

    } catch (err) {
        // 全链路错误捕获
        log('error', `🚨 任务执行失败: ${err.message}`);
        log('error', '错误详情:', err.stack);
        process.exit(1);
    } finally {
        // 无论成功失败，都关闭浏览器
        if (browser) {
            await browser.close();
            log('info', '✅ 浏览器已关闭，脚本执行完毕');
        }
    }
}

// 执行主函数
runSync();
