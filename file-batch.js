const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');

/**
 * 从 Gitee 私有仓库获取抖音号名单
 */
async function getIdsFromGitee() {
    const token = process.env.GITEE_TOKEN;
    const owner = "Kosto179";
    const repo = "kosto-battle-clicker-new";
    const path = "douyinh.txt";
    
    const apiUrl = `https://gitee.com/api/v5/repos/${owner}/${repo}/contents/${path}?access_token=${token}`;
    
    try {
        console.log(`[INFO] 正在从 Gitee 获取私密名单...`);
        const response = await axios.get(apiUrl);
        const content = Buffer.from(response.data.content, 'base64').toString('utf8');
        const ids = content.split('\n').map(l => l.trim()).filter(l => l);
        console.log(`[SUCCESS] 成功加载 ${ids.length} 个抖音号`);
        return ids;
    } catch (error) {
        console.error(`[ERROR] Gitee 加载失败: ${error.message}`);
        return [];
    }
}

(async () => {
    const rawCookie = process.env.Dou_Yin_Cookie;
    if (!rawCookie) {
        console.error('❌ 缺失环境变量: Dou_Yin_Cookie');
        process.exit(1);
    }

    const inputIds = await getIdsFromGitee();
    if (inputIds.length === 0) {
        console.error('❌ 无效名单，任务终止');
        process.exit(1);
    }

    // 启动浏览器，强化稳定参数
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--window-size=1280,800'
        ]
    });

    const cookies = JSON.parse(rawCookie);
    const results = [];

    for (const douyin_id of inputIds) {
        console.log(`\n🔎 正在定位: ${douyin_id}`);
        const page = await browser.newPage();
        
        try {
            // 【提速核心】拦截无关资源，大幅减少加载时间
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const type = req.resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            await page.setCookie(...cookies);
            await page.setViewport({ width: 1280, height: 800 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // 【跳坑核心】直接进入搜索结果页，避开重负载的首页
            const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(douyin_id)}?type=user`;
            
            console.log(`🛰️  直达搜索页: ${douyin_id}`);
            await page.goto(searchUrl, { 
                waitUntil: 'domcontentloaded', 
                timeout: 45000 // 增加宽限期至 45 秒
            });

            // 等待用户卡片渲染（DOM 加载后 AJAX 渲染需要一点时间）
            await new Promise(r => setTimeout(r, 6000));

            // 提取昵称
            const nickname = await page.evaluate((targetId) => {
                // 1. 寻找包含“抖音号: targetId”文本的节点
                const spans = Array.from(document.querySelectorAll('span'));
                const idNode = spans.find(s => 
                    s.innerText.replace(/\s+/g, '').includes('抖音号:') && 
                    s.innerText.toLowerCase().includes(targetId.toLowerCase())
                );

                if (idNode) {
                    // 2. 向上寻找最近的卡片容器
                    const card = idNode.closest('[data-e2e="user-card"]') || 
                                 idNode.closest('.search-result-card') ||
                                 idNode.parentElement.parentElement.parentElement;
                    
                    // 3. 在卡片内寻找昵称（通常是 p 标签或特定的 span）
                    const nickEl = card.querySelector('p') || 
                                   card.querySelector('span[class*="name"]') ||
                                   card.querySelector('h2');
                    return nickEl ? nickEl.innerText.trim() : null;
                }
                return null;
            }, douyin_id);

            if (nickname) {
                console.log(`✅ 获取成功: ${douyin_id} -> ${nickname}`);
                results.push(`${douyin_id}-${nickname}`);
            } else {
                console.log(`⚠️ 未找到匹配名称: ${douyin_id}`);
                results.push(`${douyin_id}-未匹配`);
            }
        } catch (err) {
            console.error(`❌ 处理异常 [${douyin_id}]: ${err.message}`);
            results.push(`${douyin_id}-异常`);
        } finally {
            await page.close();
        }
        
        // 账号之间稍微喘息一下，防止触发风控
        await new Promise(r => setTimeout(r, 2000));
    }

    // 最终导出结果文件
    fs.writeFileSync('user_id.txt', results.join('\n'), 'utf-8');
    await browser.close();
    console.log('\n✨ 程序 A 任务圆满完成');
})();