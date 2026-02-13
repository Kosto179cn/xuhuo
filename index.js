const { chromium } = require('playwright');
const axios = require('axios');

// === 配置区 ===
const CONFIG = {
  url: 'https://creator.douyin.com/creator-micro/data/following/chat',
  // 环境变量中读取用户，每行一个
  targetUsers: process.env.TARGET_USERS || 'lb\n哎哎哎哎哎哎哎哎哎唉\n鸡排炸虾🍤',
  messageTemplate: process.env.MESSAGE_TEMPLATE || '—————每日续火—————\n\n[API]',
  gotoTimeout: 60000
};

const log = (level, msg) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`);

// 获取每日一言
async function getHitokoto() {
  try {
    const { data } = await axios.get('https://v1.hitokoto.cn/');
    return `${data.hitokoto} —— ${data.from}`;
  } catch { return '保持热爱，奔赴山海。'; }
}

/**
 * 核心修复函数：清洗 Cookie 格式，解决 sameSite 报错
 */
function fixCookies(rawCookies) {
  return rawCookies.map(cookie => {
    // 处理 Playwright 严格要求的 sameSite 格式
    if (cookie.sameSite) {
      const ss = cookie.sameSite.toLowerCase();
      if (ss === 'lax') cookie.sameSite = 'Lax';
      else if (ss === 'strict') cookie.sameSite = 'Strict';
      else if (ss === 'none') cookie.sameSite = 'None';
      else delete cookie.sameSite; // 无法识别的值直接删除
    } else {
      delete cookie.sameSite; // 空字符串删除
    }
    // 移除 Playwright 不支持的字段（如 storeId）
    delete cookie.storeId;
    return cookie;
  });
}

/**
 * 模拟真人行为寻找并点击用户
 */
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

    if (found) {
      log('success', `✅ 已进入用户聊天: ${username}`);
      return true;
    }

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
  
  let rawCookies;
  try {
    rawCookies = JSON.parse(process.env.DOUYIN_COOKIES);
  } catch (e) {
    log('error', 'COOKIES JSON 解析失败，请检查 Secret 配置');
    process.exit(1);
  }

  // 清洗并修复 Cookie 格式
  const cleanCookies = fixCookies(rawCookies);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  try {
    await context.addCookies(cleanCookies);
    const page = await context.newPage();

    log('info', '🚀 正在进入抖音页面...');
    await page.goto(CONFIG.url, { waitUntil: 'domcontentloaded', timeout: CONFIG.gotoTimeout });
    
    await page.waitForTimeout(10000); // 给页面留出加载时间

    // 诊断：检查是否被重定向到登录页
    if (page.url().includes('login')) {
      log('error', '❌ Cookie 已失效，重定向到了登录页！');
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

      // 定位输入框并发送
      const inputSelector = 'div[contenteditable="true"], .chat-input-dccKiL, textarea';
      try {
        await page.waitForSelector(inputSelector, { timeout: 8000 });
        const hitokoto = await getHitokoto();
        const finalMsg = CONFIG.messageTemplate.replace('[API]', hitokoto);
        
        await page.focus(inputSelector);
        await page.fill(inputSelector, finalMsg);
        await page.keyboard.press('Enter');
        
        log('success', `✨ 已发给: ${user}`);
        await page.waitForTimeout(3000); 
      } catch (e) {
        log('error', `❌ ${user} 聊天窗口加载失败`);
        await page.screenshot({ path: `ERROR_${user}.png` });
      }
    }
  } catch (e) {
    log('error', `致命错误: ${e.message}`);
    await page.screenshot({ path: 'FATAL_ERROR.png' });
  } finally {
    await browser.close();
    log('info', '🏁 任务结束');
  }
}

main();