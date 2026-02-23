const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');

async function getIdsFromGitee() {
    const token = process.env.GITEE_TOKEN;
    const owner = "Kosto179";
    const repo = "kosto-battle-clicker-new";
    const path = "douyinh.txt";
    
    // 智能转换后的 Gitee API 地址
    const apiUrl = `https://gitee.com/api/v5/repos/${owner}/${repo}/contents/${path}?access_token=${token}`;
    
    try {
        console.log(`[INFO] 正在从 Gitee 私有仓库读取名单...`);
        const response = await axios.get(apiUrl);
        // Gitee API 返回内容是 Base64 编码的，需要解码
        const content = Buffer.from(response.data.content, 'base64').toString('utf8');
        const ids = content.split('\n').map(l => l.trim()).filter(l => l);
        console.log(`[SUCCESS] 成功加载 ${ids.length} 个抖音号`);
        return ids;
    } catch (error) {
        console.error(`[ERROR] Gitee 读取失败: ${error.response?.status || error.message}`);
        // 如果 API 失败，尝试读取本地文件兜底（可选）
        return [];
    }
}

(async () => {
    const rawCookie = process.env.Dou_Yin_Cookie;
    if (!rawCookie) {
        console.error('❌ 请配置 GitHub Secret: Dou_Yin_Cookie');
        process.exit(1);
    }

    // 1. 获取私密名单
    const inputIds = await getIdsFromGitee();
    if (inputIds.length === 0) {
        console.error('❌ 未获取到待查询名单，请检查 Gitee Token 和文件路径');
        process.exit(1);
    }

    // 2. 启动浏览器
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
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
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // 进首页
            await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // 搜索
            const inputSelector = '[data-e2e="searchbar-input"]';
            await page.waitForSelector(inputSelector, { timeout: 10000 });
            await page.type(inputSelector, douyin_id, { delay: 100 });
            await page.click('[data-e2e="searchbar-button"]');

            // 切换到“用户”标签
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            await page.evaluate(() => {
                const tabs = Array.from(document.querySelectorAll('span'));
                const userTab = tabs.find(s => s.innerText === '用户' && s.offsetWidth > 0);
                if (userTab) userTab.click();
            });
            await new Promise(r => setTimeout(r, 4500));

            // 提取结果
            const nickname = await page.evaluate((targetId) => {
                const nodes = Array.from(document.querySelectorAll('span'));
                const targetNode = nodes.find(n => 
                    n.innerText.toLowerCase().includes(targetId.toLowerCase()) && 
                    n.innerText.includes('抖音号')
                );

                if (targetNode) {
                    const card = targetNode.closest('.search-result-card') || targetNode.parentElement.parentElement.parentElement;
                    const nickEl = card.querySelector('p.ZMZLqKYm') || card.querySelector('p');
                    return nickEl ? nickEl.innerText.trim() : null;
                }
                return null;
            }, douyin_id);

            if (nickname) {
                console.log(`✅ 匹配成功: ${douyin_id} -> ${nickname}`);
                results.push(`${douyin_id}-${nickname}`);
            } else {
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

    // 写入临时文件供程序 B 下载
    fs.writeFileSync('user_id.txt', results.join('\n'), 'utf-8');
    await browser.close();
    console.log('\n🚀 程序 A 运行结束，已生成产物');
})();