const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// === 配置区 ===
const CONFIG = {
  // 抖音创作者后台私信页面URL
  url: 'https://creator.douyin.com/creator-micro/data/following/chat',
  
  /**
   * 核心逻辑：从程序 A 产出的 user_id.txt 中提取用户【名称】
   */
  targetUsers: (() => {
    const artifactPath = path.join(__dirname, 'user_id.txt');
    if (fs.existsSync(artifactPath)) {
      console.log(`[${new Date().toLocaleTimeString()}] [INFO] 📂 发现 user_id.txt，正在解析昵称列表...`);
      const content = fs.readFileSync(artifactPath, 'utf8');
      
      const nicknames = content.split('\n')
        .map(line => line.trim())
        .filter(line => line && line.includes('-')) // 过滤掉空行和非规范行
        .map(line => {
            const parts = line.split('-');
            return parts[1]; // ⭐ 提取横杠后的内容（昵称）
        })
        .filter(name => name && !['未匹配', '异常', '提取失败', '处理跳过'].includes(name)); // 排除异常项
      
      return nicknames;
    }
    // 兜底方案：如果产物不存在，检查本地 users.txt
    const fallbackPath = path.join(__dirname, 'users.txt');
    if (fs.existsSync(fallbackPath)) {
      return fs.readFileSync(fallbackPath, 'utf8').split('\n').map(u => u.trim()).filter(u => u);
    }
    return [];
  })(),

  messageTemplate: process.env.MESSAGE_TEMPLATE || '꧁————每日续火————꧂\n\n[API]',
  gotoTimeout: 60000
};

const log = (level, msg) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`);

/**
 * 聚合 API 信息（天气、热搜、一言、假期）
 */
async function getHitokoto() {
  try {
    // 1. 获取一言
    const { data: hitokotoData } = await axios.get('https://v1.hitokoto.cn/');
    const yiyan = `${hitokotoData.hitokoto} —— ${hitokotoData.from}`;

    // 2. 获取天气
    const { data: weatherData } = await axios.get('https://uapis.cn/api/v1/misc/weather?city=深圳&lang=zh');
    
    // 3. 获取日历/假期（处理北京时间）
    const { data: holidayData } = await axios.get('https://uapis.cn/api/v1/misc/holiday-calendar?timezone=Asia%2FShanghai');
    const dayInfo = holidayData.days[0];
    const now = new Date();
    const nowBeijing = new Date(now.getTime() + (8 * 60 * 60 * 1000));

    // 4. 获取热搜 TOP5
    const { data: hotData } = await axios.get('https://uapis.cn/api/v1/misc/hotboard?type=douyin&limit=10');
    const hotList = hotData.list.slice(0, 5).map(item => `${item.index}. ${item.title}`).join('\n');

    // 组合文案
    let msg = `今日${weatherData.city}：${weatherData.weather}，${weatherData.temperature}℃，${dayInfo.weekday_cn}，农历${dayInfo.lunar_month_name}${dayInfo.lunar_day_name}\n`;
    msg += `\n🔥 今日抖音热搜 TOP5：\n${hotList}\n\n${yiyan}\n\n[每日续火提醒] 有需要可直接在此回复`;
    return msg;
  } catch (e) {
    return '保持热爱，奔赴山海。祝你今天心情愉快！';
  }
}

/**
 * 修复 Cookie 格式兼容性
 */
function fixCookies(rawCookies) {
  return rawCookies.map(cookie => {
    if (cookie.sameSite) {
      const ss = cookie.sameSite.toLowerCase();
      cookie.sameSite = ss.charAt(0).toUpperCase() + ss.slice(1);
    }
    delete cookie.storeId;
    delete cookie.hostOnly;
    delete cookie.session;
    return cookie;
  });
}

/**
 * 逐字输入并发送，处理换行符
 */
async function typeRealMessage(page, selector, text) {
  await page.focus(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');

  for (const char of text) {
    if (char === '\n') {
      await page.keyboard.down('Shift');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Shift');
    } else {
      await page.keyboard.type(char);
    }
  }
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
}

/**
 * 主程序
 */
async function main() {
  const users = CONFIG.targetUsers;
  if (users.length === 0) {
    log('error', '❌ 无待执行用户，请确认程序 A 是否产出了 user_id.txt');
    process.exit(0);
  }

  log('info', `📋 最终待续火昵称列表: ${users.join(', ')}`);

  let rawCookies;
  try {
    rawCookies = JSON.parse(process.env.DOUYIN_COOKIES);
  } catch (e) {
    log('error', 'DOUYIN_COOKIES JSON 解析失败');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  try {
    await context.addCookies(fixCookies(rawCookies));
    const page = await context.newPage();
    
    log('info', '🚀 正在进入后台私信页面...');
    await page.goto(CONFIG.url, { waitUntil: 'domcontentloaded', timeout: CONFIG.gotoTimeout });
    await page.waitForTimeout(8000);

    if (page.url().includes('login')) {
      log('error', '❌ Cookie 失效，请重新获取');
      return;
    }

    const apiContent = await getHitokoto();
    const finalMsg = CONFIG.messageTemplate.replace('[API]', apiContent);
    const inputSelector = 'div[contenteditable="true"], .chat-input-dccKiL, textarea';

    let pendingUsers = [...users];
    let totalSent = 0;

    // 循环滚动查找待发送用户
    while (pendingUsers.length > 0) {
      const beforeLength = pendingUsers.length;
      
      for (let i = 0; i < 30; i++) {
        if (pendingUsers.length === 0) break;

        const foundUser = await page.evaluate((names) => {
          const spans = Array.from(document.querySelectorAll('span[class*="name"]'));
          for (const el of spans) {
            const text = el.textContent.trim();
            if (names.includes(text)) {
              el.scrollIntoView();
              el.click();
              return text;
            }
          }
          return null;
        }, pendingUsers);

        if (foundUser) {
          try {
            await page.waitForTimeout(2000);
            await page.waitForSelector(inputSelector, { timeout: 5000 });
            await typeRealMessage(page, inputSelector, finalMsg);
            
            log('success', `✨ 已成功发给: ${foundUser}`);
            totalSent++;
            pendingUsers = pendingUsers.filter(u => u !== foundUser);
            await page.waitForTimeout(3000);
          } catch (e) {
            log('error', `❌ ${foundUser} 发送失败: ${e.message}`);
          }
        } else {
          // 向下滚动查找
          await page.evaluate(() => {
            const grid = document.querySelector('.ReactVirtualized__Grid, [role="grid"], .semi-list-items');
            if (grid) grid.scrollTop += 600;
            else window.scrollBy(0, 600);
          });
          await page.waitForTimeout(1500);
        }
      }

      if (pendingUsers.length === beforeLength) {
        log('warn', `⚠️ 滚动搜索结束，未找到剩余用户: ${pendingUsers.join(', ')}`);
        break;
      }
    }

    log('info', `🏁 续火任务结束，成功发送 ${totalSent}/${users.length} 人`);

  } catch (e) {
    log('error', `出现致命错误: ${e.message}`);
  } finally {
    await browser.close();
  }
}

main();