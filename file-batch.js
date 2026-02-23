const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    // 1. 获取并验证 Cookie 环境变量
    const rawCookie = process.env.Dou_Yin_Cookie;
    if (!rawCookie) {
        console.error('❌ 错误: 请在 GitHub Secrets 中设置 Dou_Yin_Cookie');
        process.exit(1);
    }

    // 2. 读取待查询的 ID 列表
    let inputIds;
    try {
        inputIds = fs.readFileSync('input.txt', 'utf-8')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0);
        console.log(`📝 待处理任务数: ${inputIds.length}`);
    } catch (e) {
        console.error('❌ 无法读取 input.txt');
        process.exit(1);
    }

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    // 解析 JSON 格式的 Cookie
    let cookies;
    try {
        cookies = JSON.parse(rawCookie);
    } catch (e) {
        console.error('❌ Cookie 解析失败，请确保格式为 JSON 数组 [{},{}]');
        process.exit(1);
    }

    const results = [];

    for (const douyin_id of inputIds) {
        const page = await browser.newPage();
        console.log(`\n🔍 正在通过模拟操作寻找: ${douyin_id}`);
        
        try {
            await page.setCookie(...cookies);
            await page.setViewport({ width: 1440, height: 900 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // 第一阶段：进入首页
            await page.goto('https://www.douyin.com/', { waitUntil: 'networkidle2', timeout: 60000 });
            
            // 第二阶段：模拟人工搜索操作
            const inputSelector = '[data-e2e="searchbar-input"]';
            await page.waitForSelector(inputSelector);
            await page.click(inputSelector);
            await page.type(inputSelector, douyin_id, { delay: 150 }); // 模拟人手打字
            await page.click('[data-e2e="searchbar-button"]');

            // 第三阶段：等待并点击“用户”标签
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            await page.evaluate(() => {
                const tabs = Array.from(document.querySelectorAll('span'));
                const userTab = tabs.find(s => s.innerText === '用户' && s.offsetWidth > 0);
                if (userTab) userTab.click();
            });
            await new Promise(r => setTimeout(r, 4000)); // 等待列表加载

            // 第四阶段：精准匹配昵称
            const data = await page.evaluate((targetId) => {
                // 寻找所有显示抖音号的节点 (利用你提供的 HTML 结构特征)
                const idSpans = Array.from(document.querySelectorAll('span.Nyxv01sb'));
                const matchNode = idSpans.find(s => s.innerText.trim().toLowerCase() === targetId.toLowerCase());

                if (matchNode) {
                    // 向上爬到对应的卡片容器
                    const card = matchNode.closest('.search-result-card');
                    if (card) {
                        // 寻找昵称所在的 p 标签 (ZMZLqKYm 类名)
                        const nickNode = card.querySelector('p.ZMZLqKYm') || card.querySelector('p');
                        return { id: targetId, nickname: nickNode ? nickNode.innerText.trim() : "未知" };
                    }
                }
                return null;
            }, douyin_id);

            if (data) {
                console.log(`✅ 匹配成功: ${data.id} -> ${data.nickname}`);
                results.push(`${data.id}-${data.nickname}`);
            } else {
                console.log(`⚠️ 未能在页面找到该 ID: ${douyin_id}`);
                results.push(`${douyin_id}-未匹配`);
            }
        } catch (err) {
            console.error(`❌ 处理 ${douyin_id} 时发生错误: ${err.message}`);
            results.push(`${douyin_id}-脚本异常`);
        } finally {
            await page.close();
        }
        await new Promise(r => setTimeout(r, 2000)); // 呼吸间隔
    }

    // 将结果写入文件
    fs.writeFileSync('user_id.txt', results.join('\n'), 'utf-8');
    await browser.close();
    console.log('\n✨ 处理完成，结果已存入 user_id.txt');
})();