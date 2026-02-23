const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');

async function getIdsFromGitee() {
    const token = process.env.GITEE_TOKEN;
    const owner = "Kosto179";
    const repo = "kosto-battle-clicker-new";
    const path = "douyinh.txt";
    const apiUrl = `https://gitee.com/api/v5/repos/${owner}/${repo}/contents/${path}?access_token=${token}`;
    
    try {
        console.log(`[INFO] 正在尝试从 Gitee 获取私密名单...`);
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
    if (!rawCookie) { process.exit(1); }

    const inputIds = await getIdsFromGitee();
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const cookies = JSON.parse(rawCookie);
    const results = [];

    for (const douyin_id of inputIds) {
        console.log(`\n🔎 正在定位 ID: ${douyin_id}`);
        const page = await browser.newPage();
        
        try {
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
                else req.continue();
            });

            await page.setCookie(...cookies);
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(douyin_id)}?type=user`;
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

            console.log(`⏳ 等待渲染 (10s)...`);
            await new Promise(r => setTimeout(r, 10000));

            // 【核心修复：基于你提供的 HTML 结构】
            const nickname = await page.evaluate((targetId) => {
                // 1. 寻找所有的用户卡片
                const cards = Array.from(document.querySelectorAll('.search-result-card'));
                
                for (const card of cards) {
                    const cardText = card.innerText.replace(/\s+/g, '');
                    // 2. 检查这个卡片是否包含我们的目标抖音号
                    if (cardText.toLowerCase().includes('抖音号:' + targetId.toLowerCase())) {
                        // 3. 抓取昵称：根据 HTML，昵称在 p 标签下的多个 span 嵌套中
                        // 我们直接找 card 里的第一个 p 标签，它通常存放昵称
                        const nameContainer = card.querySelector('p');
                        if (nameContainer) {
                            return nameContainer.innerText.trim();
                        }
                    }
                }
                return null;
            }, douyin_id);

            if (nickname) {
                console.log(`✅ 获取成功: ${douyin_id} -> ${nickname}`);
                results.push(`${douyin_id}-${nickname}`);
            } else {
                console.log(`⚠️ 无法解析卡片内容: ${douyin_id}`);
                results.push(`${douyin_id}-未匹配`);
            }
        } catch (err) {
            console.error(`❌ 异常: ${err.message}`);
            results.push(`${douyin_id}-异常`);
        } finally {
            await page.close();
        }
    }

    fs.writeFileSync('user_id.txt', results.join('\n'), 'utf-8');
    await browser.close();
    console.log('\n✨ 任务结束');
})();