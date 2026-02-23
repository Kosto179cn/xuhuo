const { chromium } = require('playwright');
const axios = require('axios');

const CONFIG = {
  url: 'https://creator.douyin.com/creator-micro/data/following/chat',
  // 如果是 push 触发，ONLY_FOR_KOSTO 会有值，此时只处理 Kosto
  targetUsers: process.env.ONLY_FOR_KOSTO 
    ? 'Kosto' 
    : (process.env.TARGET_USERS || ''),
  messageTemplate: process.env.MESSAGE_TEMPLATE || '꧁————每日续火————꧂\n\n[API]',
};

const log = (level, msg) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`);

// 获取天气和一言的函数 (保持不变)
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

  // --- 1. 修复 sameSite 报错：Cookie 清洗 ---
  let cookies = [];
  try {
    cookies = JSON.parse(process.env.DOUYIN_COOKIES || '[]');
    cookies = cookies.map(c => {
      const valid = ['Strict', 'Lax', 'None'];
      if (!valid.includes(c.sameSite)) delete c.sameSite;
      return c;
    });
  } catch (e) { log('error', 'Cookie 解析失败'); }

  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    log('info', `任务启动。目标模式: ${process.env.ONLY_FOR_KOSTO ? '代码更新(仅限Kosto)' : '全员轮询'}`);
    await page.goto(CONFIG.url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000); 

    let pendingUsers = CONFIG.targetUsers.split('\n').map(u => u.trim()).filter(u => u);
    const nameSelector = '.item-header-name-vL_79m'; // 名字选择器
    const gridSelector = '.ReactVirtualized__Grid'; // 滚动容器

    // 主循环：寻找并发送
    for (let cycle = 0; cycle < 50; cycle++) {
      if (pendingUsers.length === 0) {
        log('success', '所有目标已处理完毕，任务结束。');
        break;
      }

      // 获取当前可视区域的所有用户
      const visibleNames = await page.$$eval(nameSelector, els => els.map(el => el.innerText.trim()));
      
      for (const user of [...pendingUsers]) {
        if (visibleNames.includes(user)) {
          log('info', `🎯 匹配到用户: ${user}，准备进入聊天界面...`);
          
          // --- A. 点击左侧列表进入聊天 ---
          const userElement = page.locator(nameSelector).filter({ hasText: user }).last();
          await userElement.click();
          await page.waitForTimeout(2000); // 等待右侧输入框加载

          // --- B. 寻找输入框并发送 ---
          const inputSelector = 'div[contenteditable="true"]';
          try {
            await page.waitForSelector(inputSelector, { timeout: 5000 });
            const apiContent = await getHitokoto();
            const finalMsg = CONFIG.messageTemplate.replace('[API]', apiContent);

            await page.focus(inputSelector);
            await page.keyboard.type(finalMsg, { delay: 50 });
            await page.keyboard.press('Enter');
            
            log('success', `✨ 已成功发给: ${user}`);
            pendingUsers = pendingUsers.filter(u => u !== user); // 从待办移除
            await page.waitForTimeout(2000);
          } catch (e) {
            log('error', `进入 ${user} 界面后未找到输入框，跳过`);
          }
        }
      }

      // --- C. 如果还没找齐，执行【可视小幅下划】 ---
      if (pendingUsers.length > 0) {
        log('info', `未找齐目标，正在执行可视下划寻找: ${pendingUsers.join(', ')}`);
        const box = await page.locator(gridSelector).boundingBox();
        if (box) {
          await page.mouse.move(box.x + 50, box.y + 100);
          for (let step = 0; step < 3; step++) {
            await page.mouse.wheel(0, 150); // 每次滚一小段
            await page.waitForTimeout(200); 
          }
        }
        await page.waitForTimeout(1500); // 给 React 留出渲染新用户的时间
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