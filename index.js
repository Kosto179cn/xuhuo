const { chromium } = require('playwright');
const axios = require('axios');

// === 配置区 ===
const CONFIG = {
  url: 'https://creator.douyin.com/creator-micro/data/following/chat',
  targetUsers: process.env.TARGET_USERS || 'lb\n哎哎哎\n鸡排炸虾🍤',
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
 * 核心调试函数：打印当前 DOM 中所有的用户名
 */
async function debugDumpNames(page) {
  const names = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('span[class*="name"]'))
                .map(el => el.textContent.trim())
                .filter(t => t.length > 0);
  });
  log('debug', `当前可见用户列表(${names.length}个): ${names.join(' | ')}`);
}

/**
 * 模拟控制台的滚动逻辑
 */
async function scrollAndFindUser(page, username) {
  log('info', `正在寻找用户: ${username}`);
  
  for (let i = 0; i < 30; i++) {
    // 1. 尝试在当前 DOM 找人
    const found = await page.evaluate((name) => {
      const spans = Array.from(document.querySelectorAll('span[class*="name"]'));
      const target = spans.find(el => el.textContent.trim() === name);
      if (target) {
        target.scrollIntoView();
        target.click(); // 模拟点击
        return true;
      }
      return false;
    }, username);

    if (found) {
      log('success', `✅ 成功定位并点击用户: ${username}`);
      return true;
    }

    // 2. 没找到则打印当前列表（仅在第1次和最后一次尝试时打印）
    if (i === 0 || i === 29) await debugDumpNames(page);

    // 3. 模拟滚动：直接操作 DOM 容器
    const scrollResult = await page.evaluate(() => {
      const grid = document.querySelector('.ReactVirtualized__Grid, [role="grid"], .semi-list-items');
      if (grid) {
        grid.scrollTop += 600;
        return "CONTAINER_SCROLLED";
      }
      window.scrollBy(0, 600);
      return "WINDOW_SCROLLED";
    });

    if (i === 0) log('debug', `滚动状态: ${scrollResult}`);
    await page.waitForTimeout(1500); // 等待渲染
  }
  return false;
}

async function main() {
  // 1. 环境准备
  const targetUsers = CONFIG.targetUsers.split('\n').map(u => u.trim()).filter(u => u);
  let cookies;
  try {
    cookies = JSON.parse(process.env.DOUYIN_COOKIES);
  } catch (e) {
    log('error', `COOKIES 解析失败: ${e.message}`);
    process.exit(1);
  }

  // 2. 启动浏览器（关键：模拟大显示器防止容器塌陷）
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    log('info', '🚀 正在进入抖音私信页面...');
    await page.goto(CONFIG.url, { waitUntil: 'networkidle', timeout: CONFIG.gotoTimeout });
    
    // 强制等待 10 秒，确保 React 列表加载
    log('info', '等待 10s 确保列表初次渲染...');
    await page.waitForTimeout(10000);

    for (const user of targetUsers) {
      try {
        const found = await scrollAndFindUser(page, user);
        if (!found) {
          log('error', `❌ 无法找到用户 [${user}]，已尝试滚动 30 次`);
          continue;
        }

        // 3. 等待输入框加载
        await page.waitForTimeout(2000);
        const inputSelector = 'div[contenteditable="true"], .chat-input-dccKiL, textarea';
        const inputHandle = await page.waitForSelector(inputSelector, { timeout: 10000 }).catch(() => null);

        if (!inputHandle) {
          log('error', `❌ 找到 [${user}] 但未弹出聊天框（输入框未出现）`);
          continue;
        }

        // 4. 发送消息
        const hitokoto = await getHitokoto();
        const finalMsg = CONFIG.messageTemplate.replace('[API]', hitokoto);
        
        // 使用更稳妥的 fill + press
        await page.focus(inputSelector);
        await page.fill(inputSelector, finalMsg);
        await page.keyboard.press('Enter');
        
        log('success', `✨ 已给 ${user} 发送成功`);
        await page.waitForTimeout(3000); // 频率控制

      } catch (userError) {
        log('error', `处理用户 ${user} 时发生意外: ${userError.message}`);
      }
    }
  } catch (globalError) {
    log('error', `致命错误: ${globalError.message}`);
  } finally {
    await browser.close();
    log('info', '浏览器已关闭，任务结束');
  }
}

main();