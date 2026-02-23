const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const rawCookie = process.env.Dou_Yin_Cookie;
    if (!rawCookie) { console.error('❌ 未发现 Cookie'); process.exit(1); }

    const input = fs.readFileSync('input.txt', 'utf-8');
    const lines = input.split('\n').map(l => l.trim()).filter(l => l);

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,800'
        ]
    });

    const cookies = JSON.parse(rawCookie);
    const results = [];

    for (const douyin_id of lines) {
        console.log(`\n🖐️ 模拟人工搜索并提取: ${douyin_id}`);
        const page = await browser.newPage();
        
        try {
            await page.setCookie(...cookies);
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // 1. 进入主页并模拟人工输入搜索
            await page.goto('https://www.douyin.com/', { waitUntil: 'networkidle2' });
            await page.waitForSelector('[data-e2e="searchbar-input"]');
            
            await page.click('[data-e2e="searchbar-input"]');
            await page.type('[data-e2e="searchbar-input"]', douyin_id, { delay: 120 });
            await page.click('[data-e2e="searchbar-button"]');

            // 2. 等待并手动切换到“用户”标签
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            await page.evaluate(() => {
                const spans = Array.from(document.querySelectorAll('span'));
                const userTab = spans.find(s => s.innerText === '用户' && s.offsetWidth > 0);
                if (userTab) userTab.click();
            });
            
            // 抖音搜索结果渲染较慢，多等一会
            await new Promise(r => setTimeout(r, 4000));

            // 3. 【精准逻辑】不依赖类名，通过层级提取昵称
            const userData = await page.evaluate((targetId) => {
                // a. 找到包含“抖音号: ”文本的 span
                const allSpans = Array.from(document.querySelectorAll('span'));
                const idLabelNode = allSpans.find(s => 
                    s.innerText.includes('抖音号:') && 
                    s.innerText.toLowerCase().includes(targetId.toLowerCase())
                );

                if (idLabelNode) {
                    // b. 向上寻找最近的搜索结果卡片容器
                    const card = idLabelNode.closest('.search-result-card') || idLabelNode.parentElement.parentElement.parentElement;
                    
                    if (card) {
                        // c. 提取昵称：根据你提供的结构，昵称通常在卡片上半部分的 p 标签里
                        // 我们直接找第一个 p 标签，或者类名包含 ZM... 的元素
                        const pTags = Array.from(card.querySelectorAll('p'));
                        if (pTags.length > 0) {
                            // 排除包含“抖音号”字样的那一行
                            const nickNode = pTags.find(p => !p.innerText.includes('抖音号'));
                            return { 
                                id: targetId, 
                                nickname: nickNode ? nickNode.innerText.trim() : "未找到昵称" 
                            };
                        }
                    }
                }
                return null;
            }, douyin_id);

            if (userData) {
                const entry = `${userData.id}-${userData.nickname}`;
                results.push(entry);
                console.log(`✅ 匹配成功: ${entry}`);
            } else {
                // 如果没匹配到，截图存证
                await page.screenshot({ path: `miss_${douyin_id}.png` });
                results.push(`${douyin_id}-未匹配`);
                console.log(`⚠️ 搜索列表未命中: ${douyin_id}`);
            }

        } catch (err) {
            console.error(`❌ 运行异常: ${err.message}`);
            results.push(`${douyin_id}-提取失败`);
        } finally {
            await page.close();
        }
        
        // 降低频率防止风控
        await new Promise(r => setTimeout(r, 2000));
    }

    // 4. 输出结果
    fs.writeFileSync('user_id.txt', results.join('\n'), 'utf-8');
    await browser.close();
    console.log('\n🎉 处理任务结束，请检查 user_id.txt');
})();