const { chromium } = require('playwright');
const axios = require('axios');

const CONFIG = {
  url: 'https://creator.douyin.com/creator-micro/data/following/chat',
  // ⭐ 这里的逻辑确保：如果是 index.js 更新触发的，只给 Kosto 发
  targetUsers: process.env.ONLY_FOR_KOSTO 
    ? 'Kosto' 
    : (process.env.TARGET_USERS || ''),
  messageTemplate: process.env.MESSAGE_TEMPLATE || '꧁————每日续火————꧂\n\n[API]',
  gotoTimeout: 60000 // ⭐ 找回了你原来的 60 秒超时设置
};

const log = (level, msg) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`);

// ⭐ 找回了你原来的天气+一言完整逻辑
async function getHitokoto() {
  try {
    const { data: hData } = await axios.get('https://v1.hitokoto.cn/');
    const { data: wData } = await axios.get('https://uapis.cn/api/v1/misc/weather?city=深圳&lang=zh');
    return `今日${wData.city}：${wData.weather}，气温${wData.temp}℃\n${hData.hitokoto} —— ${hData.from}`;
  } catch (e) {
    return "祝你今天开心，万事顺意！";
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // --- Cookie 清洗 (修复 sameSite 报错) ---
  let cookies = [];
  try {
    cookies = JSON.parse(process.env.DOUYIN_COOKIES || '[]');
    cookies = cookies.map(c => {
      const valid = ['Strict', 'Lax', 'None'];
      if (!valid.includes(c.sameSite)) delete c.sameSite;
      return c;
    });
  } catch (e) { log('error', 'Cookie 格式错误'); }

  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    log('info', `任务启动。目标模式: ${process.env.ONLY_FOR_KOSTO ? '代码更新(仅限Kosto)' : '全员轮询'}`);
    
    // ⭐ 使用 CONFIG 里的长超时
    await page.goto(CONFIG.url, { waitUntil: 'networkidle', timeout: CONFIG.gotoTimeout });
    await page.waitForTimeout(5000); 

    let pendingUsers = CONFIG.targetUsers.split('\n').map(u => u.trim()).filter(u => u);
    const nameSelector = '.item-header-name-vL_79m';
    const gridSelector = '.ReactVirtualized__Grid';

    for (let cycle = 0; cycle < 50; cycle++) {
      if (pendingUsers.length === 0) {
        log('success', '✅ 所有目标已处理完毕！');
        break;
      }

      // 获取当前可视的名字
      const visibleNames = await page.$$eval(nameSelector, els => els.map(el => el.innerText.trim()));
      
      for (const user of [...pendingUsers]) {
        if (visibleNames.includes(user)) {
          log('info', `🎯 匹配到: ${user}，正在进入聊天界面...`);
          
          // 1. 先点击名字进入聊天界面
          const userBtn = page.locator(nameSelector).filter({ hasText: user }).last();
          await userBtn.click();
          await page.waitForTimeout(3000); // 稍微多等一会儿让输入框加载

          // 2. 找到输入框并发送消息
          const inputSelector = 'div[contenteditable="true"]';
          try {
            await page.waitForSelector(inputSelector, { timeout: 10000 });
            const content = await getHitokoto();
            const finalMsg = CONFIG.messageTemplate.replace('[API]', content);

            await page.focus(inputSelector);
            // 模拟真人打字
            await page.keyboard.type(finalMsg, { delay: 60 });
            await page.keyboard.press('Enter');
            
            log('success', `✨ 已成功发给: ${user}`);
            pendingUsers = pendingUsers.filter(u => u !== user); // 标记完成
            await page.waitForTimeout(2000);
          } catch (e) {
            log('error', `❌ 没找到 ${user} 的输入框，可能是界面没跳过去`);
          }
        }
      }

      // --- 如果没找齐，执行【对位】的可视化小幅滑动 ---
      if (pendingUsers.length > 0) {
        log('info', `未找齐，执行可视化下划... (剩余: ${pendingUsers.join(',')})`);
        const box = await page.locator(gridSelector).boundingBox();
        if (box) {
          await page.mouse.move(box.x + 50, box.y + 100);
          // 这里就是你要求的“不要太大”的小幅效果
          for (let s = 0; s < 3; s++) {
            await page.mouse.wheel(0, 180); 
            await page.waitForTimeout(300); 
          }
        }
        await page.waitForTimeout(2000); // 等待 React 渲染新 HTML
      }
    }
  } catch (err) {
    log('error', `运行崩溃: ${err.message}`);
    await page.screenshot({ path: 'fatal_error.png' });
  } finally {
    await browser.close();
  }
}

main();