const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');

const CONFIG = {
  url: 'https://creator.douyin.com/creator-micro/data/following/chat',
  targetUsers: process.env.TARGET_USERS || 'lb\n哎哎哎哎哎哎哎哎哎唉\n鸡排炸虾🍤',
  messageTemplate: process.env.MESSAGE_TEMPLATE || '—————每日续火—————\n\n[API]',
  gotoTimeout: 60000
};

const log = (level, msg) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`);

async function getHitokoto() {
  try {
    const { data } = await axios.get('https://v1.hitokoto.cn/');
    return `${data.hitokoto} —— ${data.from}`;
  } catch { return '保持热爱，奔赴山海。'; }
}

async function scrollAndFindUser(page, username) {
  log('info', `🔍 正在寻找用户: ${username}`);
  for (let i = 0; i < 25; i++) {
    const found = await page.evaluate((name) => {
      const spans = Array.from(document.querySelectorAll('span[class*="name"]'));
      const target = spans.find(el => el.textContent.trim() === name);
      if (target) {
        target.scrollIntoView();
        target.click();
        return true;
      }
      return false;
    }, username);

    if (found) return true;

    // 滚动逻辑
    await page.evaluate(() => {
      const grid = document.querySelector('.ReactVirtualized__Grid, [role="grid"], .semi-list-items');
      if (grid) grid.scrollTop += 600;
      else window.scrollBy(0, 600);
    });
    await page.waitForTimeout(1500);
  }
  return false;
}

async function main() {
  const targetUsers = CONFIG.targetUsers.split('\n').map(u => u.trim()).filter(u => u);
  let cookies;
  try {
    cookies = JSON.parse(process.env.DOUYIN_COOKIES);
  } catch (e) {
    log('error', '❌ COOKIES 解析失败，请检查 Secret 格式');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  // 关键：模拟超大视口，防止 React 列表因为窗口小而不加载
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    log('info', '🚀 正在进入抖音页面...');
    await page.goto(CONFIG.url, { waitUntil: 'domcontentloaded', timeout: CONFIG.gotoTimeout });
    
    // 诊断：检查是否跳转到了登录页
    await page.waitForTimeout(5000);
    const currentUrl = page.url();
    log('info', `📍 当前 URL: ${currentUrl}`);
    
    if (currentUrl.includes('login')) {
      log('error', '❌ Cookies 已失效或被拦截，正在截取登录页... [查看 Artifacts]');
      await page.screenshot({ path: 'error_login_wall.png' });
      return;
    }

    log('info', '⏳ 等待列表加载 (15秒)...');
    await page.waitForTimeout(15000);

    // 诊断：打印当前 DOM 中能看到的任何名字
    const visibleNames = await page.evaluate(() => 
      Array.from(document.querySelectorAll('span[class*="name"]')).map(el => el.textContent.trim())
    );
    log('debug', `当前可见用户数量: ${visibleNames.length}`);
    if (visibleNames.length > 0) {
      log('debug', `可见用户示例: ${visibleNames.slice(0, 3).join(' | ')}`);
    } else {
      log('warn', '⚠️ 列表为空！正在截取当前页面状态... [查看 Artifacts]');
      await page.screenshot({ path: 'error_empty_list.png' });
    }

    for (const user of targetUsers) {
      const found = await scrollAndFindUser(page, user);
      if (!found) {
        log('error', `❌ 找不到用户: ${user}`);
        continue;
      }

      await page.waitForTimeout(2000);
      const inputSelector = 'div[contenteditable="true"], .chat-input-dccKiL, textarea';
      try {
        await page.waitForSelector(inputSelector, { timeout: 8000 });
        const hitokoto = await getHitokoto();
        const finalMsg = CONFIG.messageTemplate.replace('[API]', hitokoto);
        await page.fill(inputSelector, finalMsg);
        await page.keyboard.press('Enter');
        log('success', `✨ 已发给: ${user}`);
      } catch (e) {
        log('error', `❌ ${user} 聊天框未打开`);
        await page.screenshot({ path: `error_${user}_chat.png` });
      }
    }
  } catch (e) {
    log('error', `致命异常: ${e.message}`);
    await page.screenshot({ path: 'error_fatal.png' });
  } finally {
    await browser.close();
    log('info', '🏁 任务结束');
  }
}

main();