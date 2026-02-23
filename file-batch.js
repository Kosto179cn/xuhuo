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
    if (!rawCookie) { console.error("缺少 Cookie"); process.exit(1); }

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
        await page.setViewport({ width: 1280, height: 1000 });
        
        try {
            await page.setCookie(...cookies);
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(douyin_id)}?type=user`;
            await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

            console.log(`⏳ 等待深度渲染 (15s)...`);
            await new Promise(r => setTimeout(r, 15000));

            // 【暴力扫描：不依赖任何类名】
            const nickname = await page.evaluate((targetId) => {
                // 获取所有带文本的元素
                const elements = Array.from(document.querySelectorAll('a, div, li, p, span'));
                // 找到包含 "抖音号: ID" 的那个元素
                const targetNode = elements.find(el => {
                    const txt = el.innerText || "";
                    return txt.includes('抖音号:') && txt.toLowerCase().includes(targetId.toLowerCase());
                });

                if (targetNode) {
                    // 向上找最近的一个“块级”容器（通常是卡片或列表项）
                    let container = targetNode;
                    for (let i = 0; i < 6; i++) {
                        if (container.innerText.length > targetId.length + 10) break;
                        if (container.parentElement) container = container.parentElement;
                    }
                    // 拆分行，拿第一行非空文字
                    const lines = container.innerText.split('\n').map(s => s.trim()).filter(s => s.length > 0);
                    return lines[0];
                }
                return null;
            }, douyin_id);

            if (nickname && nickname !== '抖音号:') {
                console.log(`✅ 成功: ${douyin_id} -> ${nickname}`);
                results.push(`${douyin_id}-${nickname}`);
            } else {
                console.log(`⚠️ 抓取失败，正在截图留证...`);
                await page.screenshot({ path: `fail-${douyin_id}.png`, fullPage: true });
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
    console.log('\n✨ 处理完毕');
})();