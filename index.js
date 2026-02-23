const { chromium } = require('playwright');
const axios = require('axios');

const CONFIG = {
  url: 'https://creator.douyin.com/creator-micro/data/following/chat',
  // 逻辑：如果环境变量 ONLY_FOR_KOSTO 有值（即 push 触发），则只发给 Kosto
  targetUsers: process.env.ONLY_FOR_KOSTO 
    ? 'Kosto' 
    : (process.env.TARGET_USERS || ''),
  messageTemplate: process.env.MESSAGE_TEMPLATE || '꧁————每日续火————꧂\n\n[API]',
};

const log = (level, msg) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`);

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

  // --- Cookie 清洗逻辑，解决 sameSite 报错 ---
  let cookies = [];
  try {
    cookies = JSON.parse(process.env.DOUYIN_COOKIES || '[]');
    cookies = cookies.map(cookie => {
      // 如果 sameSite 不是标准值，直接删掉该属性，由浏览器自动处理
      const validSameSite = ['Strict', 'Lax', 'None'];
      if (!validSameSite.includes(cookie.sameSite)) {
        delete cookie.sameSite;
      }
      return cookie;
    });
  } catch (e) {
    log('error', 'Cookie 解析失败，请检查 Secret 格式');
  }

  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    log('info', `任务启动。当前模式: ${process.env.ONLY_FOR_KOSTO ? '代码更新(仅限Kosto)' : '常规全员'}`);
    await page.goto(CONFIG.url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    let pendingUsers = CONFIG.targetUsers.split('\n').map(u => u.trim()).filter(u => u);
    const nameSelector = '.item-header-name-vL_79m';
    const gridSelector = '.ReactVirtualized__Grid';

    for (let cycle = 0; cycle < 50; cycle++) {
      if (pendingUsers.length === 0) break;

      const visibleNames = await page.$$eval(nameSelector, els => els.map(el => el.innerText.trim()));
      
      for (const user of [...pendingUsers]) {
        if (visibleNames.includes(user)) {
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

      // 找不到用户时，执行“对位”的可视化小幅滑动
      if (pendingUsers.length > 0) {
        log('info', `未找齐目标，正在执行可视化微划...`);
        const box = await page.locator(gridSelector).boundingBox();
        if (box) {
          await page.mouse.move(box.x + 50, box.y + 100);
          // 每次只滚 150px，分 3 次滚动，确保 React 识别
          for (let step = 0; step < 3; step++) {
            await page.mouse.wheel(0, 150); 
            await page.waitForTimeout(200); 
          }
        }
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