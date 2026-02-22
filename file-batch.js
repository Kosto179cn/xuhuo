// file-batch.js
const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  // 1. 读取输入文件
  let input;
  try {
    input = fs.readFileSync('input.txt', 'utf-8');
  } catch (err) {
    console.error(' 未找到 input.txt 文件，请确保文件存在');
    process.exit(1);
  }

  const lines = input.split('\n').map(line => line.trim()).filter(line => line);
  console.log(`📝 发现 ${lines.length} 个抖音号需要查询`);

  const results = {};

  // 启动浏览器
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  for (const douyin_id of lines) {
    console.log(`\n🔍 正在查询: ${douyin_id}`);
    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      await page.goto(`https://www.douyin.com/user/${douyin_id}`, { 
        waitUntil: 'networkidle2', 
        timeout: 30000 
      });

      // 等待页面加载标志
      await page.waitForSelector('text=作品', { timeout: 10000 }).catch(() => {});

      // 获取昵称 (解析标题)
      const title = await page.title();
      let nickname = title.replace(' - 抖音', '').trim();
      
      // 如果标题不对，尝试找 h1
      if (nickname === '抖音' || !nickname) {
        nickname = await page.$eval('h1', el => el.innerText).catch(() => '获取失败');
      }

      results[douyin_id] = nickname;
      console.log(`✅ ${douyin_id} -> ${nickname}`);

      await page.close();
      // 防反爬：每查一个停2秒
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.log(`❌ ${douyin_id} 查询失败:`, error.message);
      results[douyin_id] = '查询失败';
    }
  }

  await browser.close();

  // 2. 写入输出文件
  fs.writeFileSync('output.json', JSON.stringify(results, null, 2), 'utf-8');
  console.log('\n🎉 所有查询完成，结果已保存到 output.json');
})();
