const { chromium } = require('playwright');
const axios = require('axios');

const CONFIG = {
  url: 'https://creator.douyin.com/creator-micro/data/following/chat',
  // 逻辑：如果有单人标记就只发给单人，否则读取环境变量列表
  targetUsers: process.env.ONLY_FOR_KOSTO 
    ? 'Kosto' 
    : (process.env.TARGET_USERS || ''),
  messageTemplate: process.env.MESSAGE_TEMPLATE || '꧁————每日续火————꧂\n\n[API]',
  gotoTimeout: 60000
};

const log = (level, msg) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`);

// 获取天气和一言 (保持你原来的代码逻辑)
async function getHitokoto() {
  try {
    const { data: hData } = await axios.get('https://v1.hitokoto.cn/');
    const { data: wData } = await axios.get('https://uapis.cn/api/v1/misc/weather?city=深圳&lang=zh');
    return `今日${wData.city}：${wData.weather}，气温${wData.temp}℃\n${hData.hitokoto} —— ${hData.from}`;
  } catch (e) {
    return "祝你今天开心！";
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const cookies = JSON.parse(process.env.DOUYIN_COOKIES || '[]');
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    log('info', `准备任务。目标模式: ${process.env.ONLY_FOR_KOSTO ? '代码更新(仅Kosto)' : '定时/手动(全员)'}`);
    await page.goto(CONFIG.url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    let pendingUsers = CONFIG.targetUsers.split('\n').map(u => u.trim()).filter(u => u);
    const nameSelector = '.item-header-name-vL_79m';
    const gridSelector = '.ReactVirtualized__Grid';

    for (let cycle = 0; cycle < 50; cycle++) {
      if (pendingUsers.length === 0) break;

      const visibleNames = await page.$$eval(nameSelector, els => els.map(el => el.innerText.trim()));
      let foundAny = false;

      for (const user of [...pendingUsers]) {
        if (visibleNames.includes(user)) {
          foundAny = true;
          log('info', `🎯 找到目标: ${user}`);
          await page.locator(nameSelector).filter({ hasText: user }).last().click();
          await page.waitForTimeout(2000);

          const finalMsg = CONFIG.messageTemplate.replace('[API]', await getHitokoto());
          const inputSelector = 'div[contenteditable="true"]';
          await page.focus(inputSelector);
          await page.keyboard.type(finalMsg, { delay: 50 });
          await page.keyboard.press('Enter');

          log('success', `✨ 已发给: ${user}`);
          pendingUsers = pendingUsers.filter(u => u !== user);
          await page.waitForTimeout(3000);
        }
      }

      // 如果没找齐，执行【小幅可视化滑动】
      if (pendingUsers.length > 0) {
        log('info', `未找齐，执行可视化下划...`);
        const box = await page.locator(gridSelector).boundingBox();
        if (box) {
          await page.mouse.move(box.x + 50, box.y + 100);
          // 这里的循环就是你要求的“不要太大”的小幅效果
          for (let step = 0; step < 3; step++) {
            await page.mouse.wheel(0, 150); // 每次轻滚 150 像素
            await page.waitForTimeout(200); 
          }
        }
        // 触发一次 scroll 事件确保网页识别
        await page.evaluate((s) => {
          const el = document.querySelector(s);
          if (el) el.dispatchEvent(new Event('scroll', { bubbles: true }));
        }, gridSelector);
        await page.waitForTimeout(1500);
      }
    }
  } catch (err) {
    log('error', err.message);
    await page.screenshot({ path: 'error.png' });
  } finally {
    await browser.close();
  }
}

main();