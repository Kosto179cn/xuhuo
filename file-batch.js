const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const cookieStr = process.env.Dou_Yin_Cookie;
    if (!cookieStr) { console.error('❌ 未发现 Cookie'); process.exit(1); }

    let input = fs.readFileSync('input.txt', 'utf-8');
    const lines = input.split('\n').map(l => l.trim()).filter(l => l);
    
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,800'
        ]
    });

    const cookies = cookieStr.split(';').map(pair => {
        const [name, ...value] = pair.trim().split('=');
        return { name, value: value.join('='), domain: '.douyin.com' };
    });

    const results = [];

    for (const douyin_id of lines) {
        console.log(`\n🔎 搜索中: ${douyin_id}`);
        const page = await browser.newPage();
        await page.setCookie(...cookies);
        // 伪装浏览器指纹
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        try {
            // 1. 跳转到搜索结果页 (直接跳转比模拟点击更稳)
            const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(douyin_id)}?type=user`;
            await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // 2. 增加随机延迟，模拟真人
            await new Promise(r => setTimeout(r, Math.random() * 2000 + 1000));

            // 3. 核心：通过 DOM 内容匹配（不依赖具体 Class）
            const userData = await page.evaluate((targetId) => {
                // 获取所有搜索结果卡片，通常它们都有 data-e2e="user-card" 或类似结构
                // 如果没有，我们直接找包含“抖音号:”文本的容器
                const allElements = Array.from(document.querySelectorAll('div, a, p'));
                
                // 找到那个显示“抖音号: xxx”的 span 或 div
                const idContainer = allElements.find(el => 
                    el.textContent.includes('抖音号:') && 
                    el.textContent.includes(targetId)
                );

                if (idContainer) {
                    // 向上找最近的卡片容器
                    const card = idContainer.closest('a') || idContainer.parentElement;
                    // 昵称通常在卡片里唯一的 H1, H2 或特定的加粗文本中
                    // 我们找卡片内第一个不包含“抖音号”且字号较大的文本
                    const nickname = card.innerText.split('\n')[0].trim(); 
                    
                    return { id: targetId, nickname: nickname };
                }
                return null;
            }, douyin_id);

            if (userData) {
                results.push(`${userData.id}-${userData.nickname}`);
                console.log(`✅ 成功获取: ${userData.id}-${userData.nickname}`);
            } else {
                // 如果没找到，截图看看是不是跳验证码了
                await page.screenshot({ path: `debug_${douyin_id}.png` });
                results.push(`${douyin_id}-未找到或触发验证`);
                console.log(`⚠️ 未匹配: ${douyin_id} (已截图)`);
            }

        } catch (err) {
            console.error(`❌ 出错: ${err.message}`);
        } finally {
            await page.close();
        }
        await new Promise(r => setTimeout(r, 3000)); 
    }

    fs.writeFileSync('user_id.txt', results.join('\n'), 'utf-8');
    await browser.close();
    console.log('\n🎉 user_id.txt 已更新');
})();