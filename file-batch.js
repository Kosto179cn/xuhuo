const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const rawCookie = process.env.Dou_Yin_Cookie;
    if (!rawCookie) {
        console.error('❌ 请配置 GitHub Secret: Dou_Yin_Cookie');
        process.exit(1);
    }

    // 读取 ID 列表
    let inputIds = [];
    try {
        inputIds = fs.readFileSync('input.txt', 'utf-8').split('\n').map(l => l.trim()).filter(l => l);
    } catch (e) {
        console.error('❌ 未找到 input.txt');
        process.exit(1);
    }

    // 启动浏览器
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
    });

    const cookies = JSON.parse(rawCookie);
    const results = [];

    for (const douyin_id of inputIds) {
        console.log(`\n🕵️ 正在查找: ${douyin_id}`);
        const page = await browser.newPage();
        
        try {
            await page.setCookie(...cookies);
            await page.setViewport({ width: 1440, height: 900 });

            // 1. 进首页
            await page.goto('https://www.douyin.com/', { waitUntil: 'networkidle2', timeout: 60000 });
            
            // 2. 模拟真实打字搜索
            const inputSelector = '[data-e2e="searchbar-input"]';
            await page.waitForSelector(inputSelector, { timeout: 10000 });
            await page.click(inputSelector);
            await page.type(inputSelector, douyin_id, { delay: 100 });
            await page.click('[data-e2e="searchbar-button"]');

            // 3. 切换标签
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            await page.evaluate(() => {
                const tabs = Array.from(document.querySelectorAll('span'));
                const userTab = tabs.find(s => s.innerText === '用户' && s.offsetWidth > 0);
                if (userTab) userTab.click();
            });
            await new Promise(r => setTimeout(r, 4500));

            // 4. 精准定位提取
            const nickname = await page.evaluate((targetId) => {
                const idNodes = Array.from(document.querySelectorAll('span'));
                // 匹配 ID 节点
                const targetNode = idNodes.find(n => 
                    n.innerText.toLowerCase().includes(targetId.toLowerCase()) && 
                    n.innerText.includes('抖音号')
                );

                if (targetNode) {
                    const card = targetNode.closest('.search-result-card') || targetNode.parentElement.parentElement.parentElement;
                    // 找到第一个类名符合或层级符合的 p 标签（通常是昵称）
                    const nickEl = card.querySelector('p.ZMZLqKYm') || card.querySelector('p');
                    return nickEl ? nickEl.innerText.trim() : null;
                }
                return null;
            }, douyin_id);

            if (nickname) {
                console.log(`✅ 匹配成功: ${douyin_id} -> ${nickname}`);
                results.push(`${douyin_id}-${nickname}`);
            } else {
                console.log(`⚠️ 未能在页面匹配: ${douyin_id}`);
                results.push(`${douyin_id}-未匹配`);
            }
        } catch (err) {
            console.error(`❌ 出错: ${err.message}`);
            results.push(`${douyin_id}-异常`);
        } finally {
            await page.close();
        }
        await new Promise(r => setTimeout(r, 2000));
    }

    // 写入文件
    fs.writeFileSync('user_id.txt', results.join('\n'), 'utf-8');
    await browser.close();
    console.log('\n🚀 任务结束，已生成 user_id.txt');
})();