const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');

/**
 * 从 Gitee 私有仓库获取抖音号名单
 */
async function getIdsFromGitee() {
    const token = process.env.GITEE_TOKEN;
    const owner = "Kosto179";
    const repo = "kosto-battle-clicker-new";
    const path = "douyinh.txt";
    
    const apiUrl = `https://gitee.com/api/v5/repos/${owner}/${repo}/contents/${path}?access_token=${token}`;
    
    try {
        console.log(`[INFO] 正在尝试从 Gitee 获取私密名单...`);
        const response = await axios.get(apiUrl);
        const content = Buffer.from(response.data.content, 'base64').toString('utf8');
        const ids = content.split('\n').map(l => l.trim()).filter(l => l);
        console.log(`[SUCCESS] 成功加载 ${ids.length} 个抖音号`);
        return ids;
    } catch (error) {
        console.error(`[ERROR] Gitee 加载失败: ${error.message}`);
        return [];
    }
}

(async () => {
    const rawCookie = process.env.Dou_Yin_Cookie;
    if (!rawCookie) {
        console.error('❌ 缺失环境变量: Dou_Yin_Cookie');
        process.exit(1);
    }

    const inputIds = await getIdsFromGitee();
    if (inputIds.length === 0) {
        console.error('❌ 无效名单，任务终止');
        process.exit(1);
    }

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--window-size=1280,800'
        ]
    });

    const cookies = JSON.parse(rawCookie);
    const results = [];

    for (const douyin_id of inputIds) {
        console.log(`\n🔎 正在定位 ID: ${douyin_id}`);
        const page = await browser.newPage();
        
        try {
            // 【提速】拦截图片和样式，专注于文本抓取
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const type = req.resourceType();
                if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            await page.setCookie(...cookies);
            await page.setViewport({ width: 1280, height: 800 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // 【直达】直达搜索用户页
            const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(douyin_id)}?type=user`;
            
            console.log(`🛰️  访问地址: ${searchUrl}`);
            await page.goto(searchUrl, { 
                waitUntil: 'domcontentloaded', 
                timeout: 45000 
            });

            // 【优化建议】增加等待时间到 10 秒，确保异步数据渲染完成
            console.log(`⏳ 等待页面渲染 (10s)...`);
            await new Promise(r => setTimeout(r, 10000));

            // 【核心修复】深度提取逻辑
            const nickname = await page.evaluate((targetId) => {
                // 1. 获取所有 span 标签
                const spans = Array.from(document.querySelectorAll('span'));
                
                // 2. 寻找包含“抖音号：搜索ID”的文字节点（不区分大小写，去除空格干扰）
                const idNode = spans.find(s => {
                    const text = s.innerText.replace(/\s+/g, ''); 
                    return text.includes('抖音号:') && text.toLowerCase().includes(targetId.toLowerCase());
                });

                if (idNode) {
                    // 3. 向上回溯到用户卡片容器
                    const card = idNode.closest('[data-e2e="user-card"]') || 
                                 idNode.closest('.search-result-card') ||
                                 idNode.parentElement.parentElement.parentElement;
                    
                    if (card) {
                        // 4. 在卡片中抓取第一个看起来像昵称的元素
                        // 逻辑：找第一个 P 标签，或者带 name/nick 字眼的元素
                        const nickEl = card.querySelector('p') || 
                                       card.querySelector('span[class*="name"]') ||
                                       card.querySelector('h2');
                        
                        return nickEl ? nickEl.innerText.trim() : null;
                    }
                }
                return null;
            }, douyin_id);

            if (nickname) {
                console.log(`✅ 匹配成功: ${douyin_id} -> ${nickname}`);
                results.push(`${douyin_id}-${nickname}`);
            } else {
                console.log(`⚠️ 找到 ID 标记但提取名称失败: ${douyin_id}`);
                results.push(`${douyin_id}-未匹配`);
            }
        } catch (err) {
            console.error(`❌ 处理异常 [${douyin_id}]: ${err.message}`);
            results.push(`${douyin_id}-异常`);
        } finally {
            await page.close();
        }
        
        await new Promise(r => setTimeout(r, 2000));
    }

    fs.writeFileSync('user_id.txt', results.join('\n'), 'utf-8');
    await browser.close();
    console.log('\n✨ 程序 A 任务圆满完成，user_id.txt 已生成');
})();