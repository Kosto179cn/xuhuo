// sync_users.js
const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 配置信息
// Gitee API 文档: https://gitee.com/api/v5/swagger#/getV5ReposOwnerRepoContentsPath
const GITEE_API_URL = 'https://gitee.com/api/v5/repos/Kosto179/kosto-battle-clicker-new/contents/douyinh.txt';
const LOCAL_USERS_FILE = 'users.txt';
const CREATOR_CHAT_URL = 'https://creator.douyin.com/creator-micro/data/following/chat';
const GOTO_TIMEOUT = 60000;

const log = (level, msg) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`);

async function runSync() {
    let browser, page;
    try {
        log('info', '🚀 开始同步用户列表...');

        // 1. 调用 Gitee API 获取抖音号列表
        log('info', '📥 正在调用 Gitee API 获取抖音号列表...');
        let giteeToken = process.env.GITEE_TOKEN;

        // 检查 Token 是否存在
        if (!giteeToken) {
            log('error', '❌ 致命错误：环境变量中没有读到 GITEE_TOKEN');
            log('error', '   请检查 .yml 文件中是否在 env 下配置了 GITEE_TOKEN: ${{ secrets.GITEE_TOKEN }}');
            process.exit(1);
        }

        // 🛠️ 关键修复 1: 去除 Token 可能存在的空格和换行符
        giteeToken = giteeToken.trim();

        // 调试日志
        console.log(`✅ 成功读到 Token，长度为: ${giteeToken.length}`);
        console.log(`   Token 前两位: ${giteeToken.substring(0, 2)}`);
        console.log(`   Token 最后一位字符编码: ${giteeToken.charCodeAt(giteeToken.length - 1)}`);
        // 如果最后一位编码是 10 或 13，说明这就是换行符导致的 401，必须用 .trim()

        // 🛠️ 关键修复 2: 使用 params 传参,并添加 User-Agent
        const response = await axios.get(GITEE_API_URL, {
            params: {
                access_token: giteeToken
            },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Node.js/SyncScript)' // 加上 User-Agent 防止被 API 识别为爬虫拦截
            }
        }).catch(error => {
            if (error.response) {
                log('error', `❌ Gitee API 请求失败: HTTP ${error.response.status}`);
                if (error.response.status === 401) {
                    log('error', '   Token 无效或权限不足');
                    log('error', '   请检查 GITEE_TOKEN 是否正确且拥有仓库读取权限');
                } else if (error.response.status === 403) {
                    log('error', '   访问被拒绝，请检查 Token 权限');
                } else if (error.response.status === 404) {
                    log('error', '   文件未找到，请检查路径是否正确');
                    log('error', `   当前路径: ${GITEE_API_URL}`);
                }
            } else {
                log('error', `❌ 网络请求失败: ${error.message}`);
            }
            process.exit(1);
        });

        // Gitee API 返回的是 Base64 编码的内容
        const fileContent = Buffer.from(response.data.content, 'base64').toString();
        const targetDyIds = fileContent.split('\n')
                                  .map(id => id.trim())
                                  .filter(id => id && !id.startsWith('#')); // 过滤空行和注释
        
        log('success', `✅ 从 Gitee 获取到 ${targetDyIds.length} 个目标抖音号`, targetDyIds);

        // 2. 启动浏览器并加载 Cookie
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        
        // 注入抖音 Cookie
        const rawCookies = JSON.parse(process.env.DOUYIN_COOKIES);
        // 清理 Cookie 数据：修正 sameSite 值
        const cleanedCookies = rawCookies.map(cookie => ({
            ...cookie,
            sameSite: cookie.sameSite === 'no_restriction' ? 'None' : 
                     cookie.sameSite === 'unspecified' ? 'Lax' :
                     cookie.sameSite === 'None' || cookie.sameSite === 'Lax' || cookie.sameSite === 'Strict' 
                     ? cookie.sameSite : 'Lax'
        })).filter(cookie => cookie.name && cookie.domain); // 过滤无效 Cookie
        await context.addCookies(cleanedCookies);
        
        page = await context.newPage();

        // 3. 进入创作者后台私信页面
        log('info', '🌐 正在进入抖音创作者后台私信页面...');
        await page.goto(CREATOR_CHAT_URL, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT });
        await page.waitForTimeout(10000);

        if (page.url().includes('login')) {
            log('error', '❌ Cookie 已失效');
            process.exit(1);
        }

        // 4. 核心逻辑：滚动查找抖音号并获取对应昵称
        // 使用待办列表模式
        let pendingDyIds = [...targetDyIds]; // 创建副本，避免修改原数组
        let foundNicknames = [];

        log('info', `🔍 开始查找 ${pendingDyIds.length} 个抖音号对应的昵称...`);

        // 只要还有待查找的抖音号，就继续循环
        while (pendingDyIds.length > 0) {
            // 记录本轮查找前的列表长度
            const beforeLength = pendingDyIds.length;
            
            // 遍历当前页面可见区域（模拟滚动查找）
            for (let i = 0; i < 30; i++) {
                // 检查是否还有抖音号需要查找
                if (pendingDyIds.length === 0) break;

                // 在当前页面视图中尝试查找待办列表中的抖音号
                const result = await page.evaluate((targetIds) => {
                    // 查找所有显示昵称的元素
                    const nameSelector = 'span[class*="name"], div[class*="name"]';
                    const nameElements = Array.from(document.querySelectorAll(nameSelector)).filter(el => el.innerText.trim());
                    
                    // 遍历页面上的所有昵称元素
                    for (const el of nameElements) {
                        const text = el.textContent.trim();
                        el.scrollIntoView();
                        el.click(); // 点击进入聊天/触发弹窗
                        
                        // 等待弹窗出现
                        return new Promise((resolve) => {
                            setTimeout(() => {
                                // 检查是否出现了 semi-portal 弹窗
                                const portals = document.querySelectorAll('.semi-portal');
                                let foundDyId = null;
                                
                                for (const portal of portals) {
                                    if (portal.innerText.includes('抖音号：')) {
                                        const match = portal.innerText.match(/抖音号：\s*([\w\.\-_]+)/);
                                        if (match) {
                                            foundDyId = match[1];
                                            // 如果这个抖音号在目标列表中
                                            if (targetIds.includes(foundDyId)) {
                                                resolve({ found: true, nickname: text, dyId: foundDyId });
                                                return;
                                            }
                                        }
                                    }
                                }
                                resolve({ found: false, nickname: null, dyId: null });
                            }, 1500); // 等待1.5秒让弹窗出现
                        });
                    }
                    return { found: false, nickname: null, dyId: null };
                }, pendingDyIds);

                if (result.found && result.nickname) {
                    // 找到了：记录昵称，从待办列表移除抖音号
                    const { nickname, dyId } = result;
                    foundNicknames.push(nickname);
                    log('success', `🔗 找到: ${dyId} -> ${nickname}`);
                    
                    // ⭐ 关键步骤：从待办列表中移除该抖音号 (标记完成)
                    pendingDyIds = pendingDyIds.filter(id => id !== dyId);
                    
                    await page.waitForTimeout(500); // 查找间隔
                } else {
                    // 如果当前这一轮滚动没有找到任何待办抖音号，使用物理滚轮方式滚动
                    await page.evaluate(async () => {
                        const scrollContainer = document.querySelector('.ReactVirtualized__Grid, [role="grid"], .semi-list-items');
                        if (!scrollContainer) {
                            window.scrollBy(0, 800);
                            return;
                        }
                        // 模拟物理滚轮：分小步滑动，每次100像素，共8次=800像素
                        for (let j = 0; j < 8; j++) {
                            scrollContainer.dispatchEvent(new WheelEvent('wheel', {
                                deltaY: 100,
                                bubbles: true,
                                cancelable: true,
                                composed: true
                            }));
                            // 物理辅助：强制移动滚动条位置以触发 React 重绘
                            scrollContainer.scrollTop += 100;
                            await new Promise(r => setTimeout(r, 50)); // 每步停50ms产生平滑效果
                        }
                    });
                    // 等待 React 把新用户渲染出来
                    await page.waitForTimeout(1200);
                }
            }

            // 5. 完成判断
            // 如果经过一轮完整的滚动查找（30次），待办列表长度没有变化
            // 说明剩下的抖音号可能不存在，或者已经查完了，避免死循环，强制退出
            const afterLength = pendingDyIds.length;
            if (afterLength === beforeLength) {
                log('warn', `⚠️ 经过一轮查找未发现新用户，剩余 ${afterLength} 个抖音号可能无法送达:`, pendingDyIds.join(', '));
                break;
            }
        }

        // 6. 写入本地 users.txt (每个昵称占一行)
        if (foundNicknames.length > 0) {
            const content = foundNicknames.join('\n'); // 用换行符连接，每个昵称占一行
            fs.writeFileSync(LOCAL_USERS_FILE, content, 'utf8');
            log('success', `🎉 成功更新 ${LOCAL_USERS_FILE}，共 ${foundNicknames.length} 个昵称`);
            log('info', '更新内容预览:', foundNicknames);
        } else {
            log('warn', '⚠️ 未找到任何昵称，使用原始抖音号列表');
            const content = targetDyIds.join('\n'); // 原始列表，每个占一行
            fs.writeFileSync(LOCAL_USERS_FILE, content, 'utf8');
        }

        log('info', `🏁 任务结束，成功找到 ${foundNicknames.length}/${targetDyIds.length} 个昵称`);

    } catch (error) {
        log('error', `🚨 同步过程发生错误: ${error.message}`);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

runSync();
