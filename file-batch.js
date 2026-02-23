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
        const response = await axios.get(apiUrl);
        const content = Buffer.from(response.data.content, 'base64').toString('utf8');
        return content.split('\n').map(l => l.trim()).filter(l => l);
    } catch (error) {
        console.error(`Gitee 加载失败: ${error.message}`);
        return [];
    }
}

(async () => {
    const rawCookie = process.env.Dou_Yin_Cookie;
    if (!rawCookie) process.exit(1);

    const inputIds = await getIdsFromGitee();
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const cookies = JSON.parse(rawCookie);
    const results = [];

    for (const douyin_id of inputIds) {
        console.log(`\n🔎 正在定位: ${douyin_id}`);
        const page = await browser.newPage();
        try {
            // 拦截样式和图片，防止干扰文字加载
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                if (['image', 'font'].includes(req.resourceType())) req.abort();
                else req.continue();
            });

            await page.setCookie(...cookies);
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(douyin_id)}?type=user`;
            await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

            console.log(`⏳ 深度等待渲染 (15s)...`);
            await new Promise(r => setTimeout(r, 15000));

            // 【终极方案：基于文字特征提取】
            const nickname = await page.evaluate((targetId) => {
                // 1. 获取页面上所有的 <a> 标签（结果通常是可点击的链接）
                const links = Array.from(document.querySelectorAll('a'));
                
                for (const link of links) {
                    const text = link.innerText;
                    // 2. 如果这个链接块里包含了“抖音号: Sunx0617”
                    if (text.includes('抖音号:') && text.toLowerCase().includes(targetId.toLowerCase())) {
                        // 3. 把这个块的所有文字按行拆分
                        const lines = text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                        // 4. 第一行通常就是昵称 (Kosto)
                        if (lines.length > 0) return lines[0];
                    }
                }
                
                // 备用方案：如果没找到 a 标签，找包含 ID 的 span 的父级
                const spans = Array.from(document.querySelectorAll('span'));
                const idSpan = spans.find(s => s.innerText.toLowerCase() === targetId.toLowerCase());
                if (idSpan) {
                    // 向上找 5 层，取该区域的第一行字
                    let p = idSpan;
                    for(let i=0; i<5; i++) { if(p.parentElement) p = p.parentElement; }
                    const lines = p.innerText.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                    return lines[0];
                }
                
                return null;
            }, douyin_id);

            if (nickname) {
                console.log(`✅ 抓取成功: ${douyin_id} -> ${nickname}`);
                results.push(`${douyin_id}-${nickname}`);
            } else {
                console.log(`⚠️ 页面文字中未发现 ID 匹配项: ${douyin_id}`);
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
    console.log('\n✨ 任务彻底结束');
})();