const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    // 1. 获取环境变量中的 Cookie
    const cookieStr = process.env.Dou_Yin_Cookie;
    if (!cookieStr) {
        console.error('❌ 错误: 未在 GitHub Secrets 中找到 Dou_Yin_Cookie');
        process.exit(1);
    }

    // 2. 读取待查询列表
    let input;
    try {
        input = fs.readFileSync('input.txt', 'utf-8');
    } catch (err) {
        console.error('❌ 未找到 input.txt 文件');
        process.exit(1);
    }

    const lines = input.split('\n').map(line => line.trim()).filter(line => line);
    console.log(`📝 发现 ${lines.length} 个抖音号需要查询`);

    // 3. 启动浏览器（针对 Actions 环境优化）
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ],
    });

    // 4. 解析 Cookie (修复 Protocol Error)
    const cookies = cookieStr.split(';')
        .map(pair => {
            const index = pair.indexOf('=');
            if (index === -1) return null;
            const name = pair.substring(0, index).trim();
            const value = pair.substring(index + 1).trim();
            if (!name) return null;
            return {
                name: name,
                value: value,
                domain: '.douyin.com',
                path: '/',
                secure: true
            };
        })
        .filter(c => c !== null);

    const finalResults = [];

    for (const douyin_id of lines) {
        console.log(`\n🔍 正在检索: ${douyin_id}`);
        const page = await browser.newPage();
        
        try {
            // 设置 Cookie 和伪装 User-Agent
            await page.setCookie(...cookies);
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // 直接跳转搜索页 (User标签下)
            const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(douyin_id)}?type=user`;
            await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // 等待页面加载
            await new Promise(r => setTimeout(r, 4000));

            // 在页面中寻找匹配的抖音号及其昵称
            const result = await page.evaluate((targetId) => {
                // 找到所有卡片容器
                const cards = Array.from(document.querySelectorAll('div, a')).filter(el => el.innerText && el.innerText.includes('抖音号:'));
                
                for (const card of cards) {
                    // 检查是否包含精确的抖音号文本
                    if (card.innerText.includes(`抖音号: ${targetId}`) || card.innerText.includes(`抖音号:${targetId}`)) {
                        // 昵称通常是卡片中第一个非空文本，或者是特定的加粗元素
                        // 这里采用从当前元素向上找最近的锚点(a标签)再提取首行文本的逻辑
                        const container = card.closest('a') || card;
                        const lines = container.innerText.split('\n').map(s => s.trim()).filter(s => s);
                        return {
                            id: targetId,
                            nickname: lines[0] || '未知昵称'
                        };
                    }
                }
                return null;
            }, douyin_id);

            if (result) {
                const entry = `${result.id}-${result.nickname}`;
                finalResults.push(entry);
                console.log(`✅ 匹配到: ${entry}`);
            } else {
                // 截图调试（在 Actions 的 Artifacts 中查看）
                await page.screenshot({ path: `miss_${douyin_id}.png` });
                finalResults.push(`${douyin_id}-未匹配`);
                console.log(`⚠️ 未找到匹配项: ${douyin_id}`);
            }

        } catch (error) {
            console.error(`❌ 查询 ${douyin_id} 发生异常:`, error.message);
            finalResults.push(`${douyin_id}-查询异常`);
        } finally {
            await page.close();
        }

        // 随机停顿 3-5 秒，防止封禁
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 3000));
    }

    await browser.close();

    // 5. 保存结果到 user_id.txt
    fs.writeFileSync('user_id.txt', finalResults.join('\n'), 'utf-8');
    console.log('\n🎉 处理完成，结果已存入 user_id.txt');
})();