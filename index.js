const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');

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
 * 核心：模拟真人行为寻找用户
 */
async function scrollAndFindUser(page, username) {
  log('info', `🔍 正在寻找用户: ${username}`);
  for (let i = 0; i < 30; i++) {
    // 1. 在 DOM 中直接查找匹配名字的元素 (注入式查找，最稳)
    const found = await page.evaluate((name) => {
      const spans = Array.from(document.querySelectorAll('span[class*="name"]'));
      const target = spans.find(el => el.textContent.trim() === name);
      if (target) {
        target.scrollIntoView();
        target.click(); // 执行点击
        return true;
      }
      return false;
    }, username);

    if (found) {
      log('success', `✅ 找到并进入用户聊天: ${username}`);
      return true;
    }

    // 2. 没找到就暴力滚动容器
    await page.evaluate(() => {
      const grid = document.querySelector('.ReactVirtualized__Grid, [role="grid"], .semi-list-items');
      if (grid) {
        grid.scrollTop += 600;
      } else {
        window.scrollBy(0, 600);
      }
    });

    await page.waitForTimeout(1500); // 等待 React 渲染
  }
  return false;
}

async function main() {
  const targetUsers = CONFIG.targetUsers.split('\n').map(u => u.trim()).filter(u => u);
  
  let cookies;
  try {
    cookies = JSON.parse(process.env.DOUYIN_COOKIES);
  } catch (e) {
    log('error', 'COOKIES 格式错误，请检查 GitHub Secrets 中的配置是否为 JSON 格式');
    process.exit(1);
  }

  // 1. 启动浏览器并伪装环境
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }, // 大分辨率防止容器塌陷
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai'
  });

  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    log('info', '🚀 正在进入抖音页面...');
    // 使用 domcontentloaded 提高速度，配合手动等待
    await page.goto(CONFIG.url, { waitUntil: 'domcontentloaded', timeout: CONFIG.gotoTimeout });
    
    // 2. 强制等待并检查是否重定向到登录页
    await page.waitForTimeout(8000);
    const currentUrl = page.url();
    log('info', `📍 当前地址: ${currentUrl}`);

    if (currentUrl.includes('login')) {
      log('error', '❌ Cookie 已失效！检测到重定向至登录页。');
      await page.screenshot({ path: 'COOKIE_EXPIRED.png', fullPage: true });
      return;
    }

    log('info', '⏳ 等待 10s 确保列表完全加载...');
    await page.waitForTimeout(10000);

    // 诊断：打印当前能看到的名单（前 3 个）
    const debugNames = await page.evaluate(() => 
      Array.from(document.querySelectorAll('span[class*="name"]')).map(el => el.textContent.trim())
    );
    if (debugNames.length === 0) {
      log('warn', '🚨 警告：列表为空，可能被反爬虫拦截');
      await page.screenshot({ path: 'EMPTY_LIST.png' });
    } else {
      log('debug', `当前可见用户: ${debugNames.slice(0, 3).join(' | ')}...`);
    }

    // 3. 循环处理
    for (const user of targetUsers) {
      const found = await scrollAndFindUser(page, user);
      if (!found) {
        log('error', `❌ 跳过用户: ${user} (滚动到底部也未找到)`);
        continue;
      }

      await page.waitForTimeout(2000); // 等待窗口弹出

      // 4. 定位输入框并发送
      const inputSelector = 'div[contenteditable="true"], .chat-input-dccKiL, textarea';
      try {
        await page.waitForSelector(inputSelector, { timeout: 8000 });
        const hitokoto = await getHitokoto();
        const finalMsg = CONFIG.messageTemplate.replace('[API]', hitokoto);
        
        await page.focus(inputSelector);
        await page.fill(inputSelector, finalMsg);
        await page.keyboard.press('Enter');
        
        log('success', `✨ 已发给: ${user}`);
        await page.waitForTimeout(3000); // 避免发送过快
      } catch (e) {
        log('error', `❌ 用户 ${user} 聊天框加载失败`);
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