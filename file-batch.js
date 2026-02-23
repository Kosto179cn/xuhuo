const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    // 1. 获取环境变量
    const rawCookie = process.env.Dou_Yin_Cookie;
    if (!rawCookie) {
        console.error('❌ 错误: 未在 Secrets 中找到 Dou_Yin_Cookie');
        process.exit(1);
    }

    let input;
    try {
        input = fs.readFileSync('input.txt', 'utf-8');
    } catch (err) {
        console.error('❌ 未找到 input.txt');
        process.exit(1);
    }

    const lines = input.split('\n').map(line => line.trim()).filter(line => line);
    console.log(`📝 发现 ${lines.length} 个抖音号`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
        ],
    });

    // 2. 解析 JSON 格式的 Cookie
    let cookies;
    try {
        cookies = JSON.parse(rawCookie);
        // 确保 domain 正确，有些导出工具会带多余字段，清理一下
        cookies = cookies.map(c => ({
            name: c.name,
            value: c.value,
            domain: c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
            path: c.path || '/',
            secure: c.secure,
            httpOnly: c.httpOnly
        })).filter(c => c.name !== ""); // 移除名称为空的异常项
        console.log(`✅ 成功解析 JSON Cookie，共 ${cookies.length} 个字段`);
    } catch (e) {
        console.error('❌ Cookie 格式错误，请确保 Secret 中填入的是完整的 JSON 数组');
        process.exit(1);
    }

    const finalResults = [];

    for (const douyin_id of lines) {
        console.log(`\n🔍 正在检索: ${douyin_id}`);
        const page = await browser.newPage();
        
        try {
            await page.setViewport({ width: 1280, height: 800 });
            // 注入 Cookie
            await page.setCookie(...cookies);
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // 直接进入搜索页
            const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(douyin_id)}?type=user`;
            await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 40000 });

            await new Promise(r => setTimeout(r, 5000));

            const result = await page.evaluate((targetId) => {
                const bodyText = document.body.innerText;
                if (bodyText.includes('验证码') || bodyText.includes('安全验证')) return 'RECAPTCHA';

                // 寻找包含抖音号的卡片
                const cards = Array.from(document.querySelectorAll('div, a')).filter(el => 
                    el.innerText && el.innerText.includes('抖音号:') && el.innerText.includes(targetId)
                );

                if (cards.length > 0) {
                    // 找到最匹配的一项
                    const match = cards.find(c => c.innerText.includes(`抖音号: ${targetId}`) || c.innerText.includes(`抖音号:${targetId}`));
                    if (match) {
                        const container = match.closest('a') || match;
                        const name = container.innerText.split('\n')[0].trim();
                        return { id: targetId, nickname: name };
                    }
                }
                return null;
            }, douyin_id);

            if (result === 'RECAPTCHA') {
                console.log(`🛑 触发验证码`);
                finalResults.push(`${douyin_id}-触发验证码`);
            } else if (result) {
                const entry = `${result.id}-${result.nickname}`;
                finalResults.push(entry);
                console.log(`✅ 成功: ${entry}`);
            } else {
                finalResults.push(`${douyin_id}-未匹配`);
                console.log(`⚠️ 未找到: ${douyin_id}`);
            }

        } catch (error) {
            console.error(`❌ 异常: ${error.message}`);
            finalResults.push(`${douyin_id}-出错`);
        } finally {
            await page.close();
        }
        await new Promise(r => setTimeout(r, 2000));
    }

    await browser.close();
    fs.writeFileSync('user_id.txt', finalResults.join('\n'), 'utf-8');
    console.log('\n🎉 处理结束。');
})();