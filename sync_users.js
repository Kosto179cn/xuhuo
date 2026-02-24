// sync_users.js
const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');

// 配置信息
// Gitee API 文档: https://gitee.com/api/v5/swagger#/getV5ReposOwnerRepoContentsPath
const GITEE_API_URL = 'https://gitee.com/api/v5/repos/Kosto179/kosto-battle-clicker-new/contents/douyinh.txt';
const LOCAL_USERS_FILE = 'users.txt';

async function runSync() {
    let browser, page;
    try {
        console.log('🚀 开始同步用户列表...');

        // 1. 调用 Gitee API 获取文件内容
        console.log('📥 正在调用 Gitee API 获取抖音号列表...');
        const giteeToken = process.env.GITEE_TOKEN;
        
        const response = await axios.get(GITEE_API_URL, {
            headers: { 
                'Authorization': `token ${giteeToken}` 
            }
        });

        // Gitee API 返回的是 Base64 编码的内容
        const fileContent = Buffer.from(response.data.content, 'base64').toString();
        const dyIds = fileContent.split('\n')
                                  .map(id => id.trim())
                                  .filter(id => id && !id.startsWith('#')); // 过滤空行和注释
        
        console.log(`✅ 从 Gitee 获取到 ${dyIds.length} 个抖音号:`, dyIds);

        // 2. 启动浏览器并加载 Cookie
        browser = await chromium.launch({ headless: true });
        page = await browser.newPage();

        // 注入抖音 Cookie
        const rawCookies = JSON.parse(process.env.DOUYIN_COOKIES);
        await page.context().addCookies(rawCookies);
        
        // 3. 遍历 ID 进行搜索解析
        const nicknames = [];

        for (const dyId of dyIds) {
            console.log(`🔍 正在解析抖音号: ${dyId}`);
            
            // 构造抖音搜索 URL
            const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(dyId)}?type=user`;
            await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

            // 核心逻辑：在搜索结果中找到对应的用户昵称
            const nickname = await page.evaluate((targetId) => {
                // 抖音搜索结果的选择器可能会变，这里提供一个通用的查找逻辑
                // 目标：找到包含该 ID 文本的元素，然后找到它旁边的昵称元素
                
                // 查找所有显示“抖音号: xxx”的元素
                const idElements = document.querySelectorAll('span');
                for (const el of idElements) {
                    if (el.innerText.includes(`抖音号：${targetId}`) || el.innerText.includes(targetId)) {
                        // 尝试向上找到用户项，再找昵称
                        // 这是一个相对定位的逻辑，因为抖音的 DOM 结构较深
                        let parent = el.parentElement;
                        while (parent && !parent.classList?.contains('user-item-class')) { // 这里可能需要根据实际情况调整
                            parent = parent.parentElement;
                        }
                        
                        // 假设昵称在同一个父级下的 .user-name 类中
                        const nameEl = parent?.querySelector('.ER9c4Xg7') || parent?.closest('.o3knt0vT')?.querySelector('.ER9c4Xg7');
                        // 注意：'.ER9c4Xg7' 是抖音昵称常见的类名，但它是动态的。如果失效，请在浏览器中检查当前的类名。
                        
                        if (nameEl) return nameEl.innerText.trim();
                    }
                }
                return null;
            }, dyId);

            if (nickname) {
                nicknames.push(nickname);
                console.log(`🔗 映射成功: ${dyId} -> ${nickname}`);
            } else {
                console.warn(`⚠️ 未找到用户或解析失败 (使用备用逻辑): ${dyId}`);
                // ⭐ 备用逻辑：如果通过搜索找不到，直接使用 ID 作为昵称（仅当该用户的个人主页就是该 ID 时有效）
                // 因为有些用户的昵称就是 ID，或者搜索被风控了
                nicknames.push(dyId);
            }

            // 随机等待，防止被风控
            await page.waitForTimeout(3000 + Math.random() * 2000);
        }

        // 4. 写入本地 users.txt
        if (nicknames.length > 0) {
            fs.writeFileSync(LOCAL_USERS_FILE, nicknames.join('\n'));
            console.log(`🎉 成功更新 ${LOCAL_USERS_FILE}，共 ${nicknames.length} 个用户`);
            console.log('更新内容预览:', nicknames);
        } else {
            throw new Error('未能解析出任何昵称');
        }

    } catch (error) {
        console.error('🚨 同步过程发生错误:', error.message);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

runSync();
