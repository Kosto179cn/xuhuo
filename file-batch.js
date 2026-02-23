const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const fs = require('fs');

// 激活隐身插件
puppeteer.use(StealthPlugin());

async function getIdsFromGitee() {
    const token = process.env.GITEE_TOKEN;
    const owner = "Kosto179";
    const repo = "kosto-battle-clicker-new";
    const path = "douyinh.txt";
    const apiUrl = `https://gitee.com/api/v5/repos/${owner}/${repo}/contents/${path}?access_token=${token}`;
    try {
        console.log(`[1/4] 正在从 Gitee 获取名单...`);
        const response = await axios.get(apiUrl);
        const content = Buffer.from(response.data.content, 'base64').toString('utf8');
        const ids = content.split('\n').map(l => l.trim()).filter(l => l);
        console.log(`[SUCCESS] 成功加载 ${ids.length} 个 ID`);
        return ids;
    } catch (error) {
        console.error(`[ERROR] Gitee 加载失败: ${error.message}`);
        return [];
    }
}

(async () => {
    const rawCookie = process.env.Dou_Yin_Cookie;
    if (!rawCookie) { console.error("缺少 Dou_Yin_Cookie 环境变量"); process.exit(1); }

    const inputIds = await getIdsFromGitee();
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled', // 核心：禁用自动化受控特征
            '--window-size=1280,1000'
        ]
    });

    const cookies = JSON.parse(rawCookie);
    const results = [];

    for (const douyin_id of inputIds) {
        console.log(`\n🔎 正在定位: ${douyin_id}`);
        const page = await browser.newPage();
        
        // 抹除 window.navigator.webdriver 特征
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        try {
            await page.setCookie(...cookies);
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

            // 搜索页 URL
            const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(douyin_id)}?type=user`;
            
            // 模拟人类随机停顿 1-3 秒再进入
            await new Promise(r => setTimeout(r, Math.random() * 2000 + 1000));
            
            await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

            console.log(`⏳ 深度加载中 (20s)...`);
            await new Promise(r => setTimeout(r, 20000));

            // 执行页面内文字扫描
            const nickname = await page.evaluate((targetId) => {
                const allElements = Array.from(document.querySelectorAll('a, div, span, p'));
                // 寻找包含“抖音号: ID”的块
                const target = allElements.find(el => {
                    const t = el.innerText || "";
                    return t.includes('抖音号:') && t.toLowerCase().includes(targetId.toLowerCase());
                });

                if (target) {
                    let box = target;
                    // 向上找 6 层，确保包住昵称区域
                    for (let i = 0; i < 6; i++) {
                        if (box.innerText.length > targetId.length + 10) break;
                        if (box.parentElement) box = box.parentElement;
                    }
                    // 取该区域第一行非空文字作为昵称
                    const lines = box.innerText.split('\n').map(s => s.trim()).filter(s => s);
                    return lines[0];
                }
                return null;
            }, douyin_id);

            if (nickname && nickname !== '抖音号:') {
                console.log(`✅ 抓取成功: ${douyin_id} -> ${nickname}`);
                results.push(`${douyin_id}-${nickname}`);
            } else {
                console.log(`⚠️ 抓取失败，正在生成诊断截图...`);
                await page.screenshot({ path: `debug-${douyin_id}.png`, fullPage: true });
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
    console.log('\n✨ 任务结束，user_id.txt 已生成');
})();