const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// === 配置区 ===
const CONFIG = {
  // 抖音创作者后台私信页面URL（根据实际路径调整）
  url: 'https://creator.douyin.com/creator-micro/data/following/chat',
  // 从users.txt文件读取目标用户，文件不存在时使用默认值
  targetUsers: fs.existsSync(path.join(__dirname, 'users.txt'))
    ? fs.readFileSync(path.join(__dirname, 'users.txt'), 'utf8')
    : 'lb\n哎哎哎哎哎哎哎哎哎唉\n鸡排炸虾🍤',
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
    // 1. 处理 Playwright 严格要求的 sameSite 格式
    if (cookie.sameSite) {
      const ss = cookie.sameSite.toLowerCase();
      if (ss === 'lax') cookie.sameSite = 'Lax';
      else if (ss === 'strict') cookie.sameSite = 'Strict';
      else if (ss === 'none') cookie.sameSite = 'None';
      else delete cookie.sameSite; // 无法识别的值直接删除，防止报错
    } else {
      delete cookie.sameSite; // 空字符串也必须删除
    }

    // 2. 移除 Playwright 不支持的字段（如 storeId, hostOnly 等）
    delete cookie.storeId;
    delete cookie.hostOnly;
    delete cookie.session;

    return cookie;
  });
}

/**
 * 寻找并点击用户
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
    log('error', 'COOKIES JSON 解析失败，请检查 Secret 配置是否为正确的 JSON 数组');
    process.exit(1);
  }

  // 【关键修复】清洗并修复 Cookie 格式
  const cleanCookies = fixCookies(rawCookies);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  try {
    // 注入修复后的 Cookie
    await context.addCookies(cleanCookies);
    const page = await context.newPage();

    log('info', '🚀 正在进入抖音页面...');
    await page.goto(CONFIG.url, { waitUntil: 'domcontentloaded', timeout: CONFIG.gotoTimeout });

    await page.waitForTimeout(10000); // 预留加载时间

    // 检查是否重定向到登录页
    if (page.url().includes('login')) {
      log('error', '❌ Cookie 已失效，重定向到了登录页！');
      await page.screenshot({ path: 'COOKIE_EXPIRED.png' });
      return;
    }

    // ======================
    // 下面是帮你实现的逻辑：
    // 1. 先处理能找到的用户
    // 2. 找不到的先存起来
    // 3. 全部发完后，再重试失败的
    // ======================

    // 存放失败的用户
    const failedUsers = [];

    // 第一次：正常发送，失败先跳过
    for (const user of targetUsers) {
      try {
        const found = await scrollAndFindUser(page, user);
        if (!found) {
          log('warn', `⚠️ 暂时找不到用户: ${user}，最后统一重试`);
          failedUsers.push(user);
          continue;
        }

        await page.waitForTimeout(2000);

        const inputSelector = 'div[contenteditable="true"], .chat-input-dccKiL, textarea';
        await page.waitForSelector(inputSelector, { timeout: 8000 });
        const hitokoto = await getHitokoto();
        const finalMsg = CONFIG.messageTemplate.replace('[API]', hitokoto);
        
        await page.focus(inputSelector);
await page.fill(inputSelector, '');

for (const c of finalMsg) {
  if (c === '\n') {
    await page.keyboard.down('Shift');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Shift');
  } else {
    await page.keyboard.type(c);
  }
}

await page.keyboard.press('Enter');
        
        log('success', `✨ 已发给: ${user}`);
        await page.waitForTimeout(3000); 
      } catch (e) {
        log('error', `❌ ${user} 异常，加入重试列表`);
        failedUsers.push(user);
        await page.screenshot({ path: `ERROR_${user}.png` }).catch(() => {});
      }
    }

        // 第二次：重试失败的用户（每个重试3次）
    if (failedUsers.length > 0) {
      log('info', `🔁 开始重试失败用户，共 ${failedUsers.length} 个`);
      const MAX_RETRY = 3;

      for (const user of failedUsers) {
        let success = false;

        for (let i = 1; i <= MAX_RETRY; i++) {
          try {
            log('info', `🔁 重试用户 ${user} 第 ${i}/${MAX_RETRY} 次`);
            const found = await scrollAndFindUser(page, user);
            if (!found) throw new Error('找不到用户');

            await page.waitForTimeout(2000);
            const inputSelector = 'div[contenteditable="true"], .chat-input-dccKiL, textarea';
            await page.waitForSelector(inputSelector, { timeout: 8000 });

            const hitokoto = await getHitokoto();
            const finalMsg = CONFIG.messageTemplate.replace('[API]', hitokoto);
            
            await page.focus(inputSelector);
            await page.fill(inputSelector, finalMsg);
            await page.keyboard.press('Enter');
            
            log('success', `✅ 重试成功: ${user}`);
            success = true;
            break;
          } catch (e) {
            log('error', `❌ ${user} 第 ${i} 次失败: ${e.message}`);
            await page.waitForTimeout(2000);
          }
        }

        if (!success) {
          log('error', `💀 ${user} 全部重试失败，已跳过`);
        }
      }
    }

  } catch (e) {
    log('error', `致命错误: ${e.message}`);
    await page.screenshot({ path: 'FATAL_ERROR.png' }).catch(() => {});
  } finally {
    await browser.close();
    log('info', '🏁 任务结束');
  }
}

main();
