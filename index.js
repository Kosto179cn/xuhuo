const { chromium } = require('playwright');
const axios = require('axios');

// === 配置区 ===
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

/**
 * 核心：格式化并修复 Cookie
 */
function formatCookies(rawCookies) {
  return rawCookies.map(cookie => {
    // 1. 修复 sameSite 格式问题
    if (cookie.sameSite) {
      const ss = cookie.sameSite.toLowerCase();
      if (ss === 'lax') cookie.sameSite = 'Lax';
      else if (ss === 'strict') cookie.sameSite = 'Strict';
      else if (ss === 'none') cookie.sameSite = 'None';
      else delete cookie.sameSite; // 如果是其他乱七八糟的值，直接删掉
    } else {
      delete cookie.sameSite; // 如果为空字符串，删掉
    }
    
    // 2. 确保 storeId 等 Playwright 不认识的字段被移除
    delete cookie.storeId;
    
    return cookie;
  });
}

async function scrollAndFindUser(page, username) {
  log('info', `🔍 正在寻找用户: ${username}`);
  for (let i = 0; i < 30; i++) {
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
  
  let rawCookies;
  try {
    rawCookies = JSON.parse(process.env.DOUYIN_COOKIES);
  } catch (e) {
    log('error', 'COOKIES 格式解析失败，请确保 Secret 中是标准的 JSON 数组');
    process.exit(1);
  }

  // 执行 Cookie 修复
  const cleanCookies = formatCookies(rawCookies);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  try {
    // 注入修复后的 Cookie
    await context.addCookies(cleanCookies);
    const page = await context.newPage();

    log('info', '🚀 正在进入抖音页面...');
    await page.goto(CONFIG.url, { waitUntil: 'domcontentloaded', timeout: CONFIG.gotoTimeout });
    
    await page.waitForTimeout(10000);
    if (page.url().includes('login')) {
      log('error', '❌ Cookie 已失效，页面被重定向至登录页');
      await page.screenshot({ path: 'COOKIE_EXPIRED.png' });
      return;
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
        await page.waitForTimeout(3000);
      } catch (e) {
        log('error', `❌ ${user} 聊天界面未成功加载`);
      }
    }
  } catch (e) {
    log('error', `运行异常: ${e.message}`);
  } finally {
    await browser.close();
    log('info', '🏁 任务结束');
  }
}

main();