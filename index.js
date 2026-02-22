const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// === 配置区 ===
const CONFIG = {
  url: 'https://creator.douyin.com/creator-micro/data/following/chat',
  targetUsers: fs.existsSync(path.join(__dirname, 'users.txt'))
    ? fs.readFileSync(path.join(__dirname, 'users.txt'), 'utf8')
    : '用户1\n用户2', 
  // 标题统一定义在这里，[API] 会被替换成 getHitokoto 的结果
  messageTemplate: process.env.MESSAGE_TEMPLATE || '—————每日续火—————\n\n[API]',
  gotoTimeout: 60000
};

const log = (level, msg) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`);

/**
 * 获取 API 内容 (维持你原本的接口逻辑)
 */
async function getHitokoto() {
  try {
    const fetchOpt = { timeout: 5000 };
    
    // 并发请求你指定的接口
    const [hito, weather, holiday, hot] = await Promise.allSettled([
      axios.get('https://v1.hitokoto.cn/', fetchOpt),
      axios.get('https://uapis.cn/api/v1/misc/weather?city=深圳&lang=zh', fetchOpt),
      axios.get('https://uapis.cn/api/v1/misc/holiday-calendar?timezone=Asia%2FShanghai&holiday_type=legal&include_nearby=true&nearby_limit=7', fetchOpt),
      axios.get('https://uapis.cn/api/v1/misc/hotboard?type=douyin&limit=5', fetchOpt)
    ]);

    let segments = [];

    // 1. 处理天气和日历
    if (weather.status === 'fulfilled' && weather.value.data) {
      const w = weather.value.data;
      const hData = holiday.status === 'fulfilled' ? holiday.value.data : {};
      const dayInfo = (hData.days && hData.days[0]) || {};
      
      const dateStr = dayInfo.weekday_cn ? `，${dayInfo.weekday_cn}，农历${dayInfo.lunar_month_name}${dayInfo.lunar_day_name}` : "";
      segments.push(`今日${w.city}：${w.weather}，气温${w.temperature}℃，${w.wind_direction}${w.wind_power}${dateStr}`);

      // 假期逻辑
      if (hData.nearby?.next) {
        const nextList = hData.nearby.next.filter(item => item.events[0].type === 'legal_rest');
        const groups = {};
        nextList.forEach(item => {
          const name = item.events[0].name;
          if (!groups[name]) groups[name] = [];
          groups[name].push(item.date);
        });

        const nowBJ = new Date(new Date().getTime() + 8 * 3600000);
        let holidayLines = [];
        for (const name in groups) {
          const days = groups[name];
          const firstDay = days[0];
          const lastDay = days[days.length - 1];
          const endDateBJ = new Date(new Date(lastDay).getTime() + 8 * 3600000);
          endDateBJ.setHours(23, 59, 59, 999);
          const ms = endDateBJ - nowBJ;
          
          if (dayInfo.is_holiday && dayInfo.legal_holiday_name === name) {
            const h = Math.floor((ms % 86400000) / 3600000);
            holidayLines.push(`${name}（假期还剩 ${Math.floor(ms/86400000)}天${h}小时）`);
          } else {
            const totalDays = Math.ceil((new Date(new Date(firstDay).getTime() + 8 * 3600000) - nowBJ) / 86400000);
            if (totalDays >= 0) holidayLines.push(`${name}（还有 ${totalDays}天）`);
          }
        }
        if (holidayLines.length) segments.push(`最近假期：\n${holidayLines.join('\n')}`);
      }
    }

    // 2. 处理热搜
    if (hot.status === 'fulfilled' && hot.value.data.list) {
      const hots = hot.value.data.list.slice(0, 5).map(item => `${item.index}. ${item.title}`);
      segments.push(`今日抖音热报：\n${hots.join('\n')}`);
    }

    // 3. 处理一言
    const yiyanStr = (hito.status === 'fulfilled' && hito.value.data) 
      ? `${hito.value.data.hitokoto} —— ${hito.value.data.from}`
      : "保持热爱，奔赴山海。";
    
    segments.push(yiyanStr + "\n接抖音续火花5○-30○/月");

    return segments.join('\n\n');

  } catch (e) {
    return `保持热爱，奔赴山海。`;
  }
}

/**
 * 核心修复：模拟键盘输入，解决 \n 失效
 */
async function typeRealMessage(page, selector, text) {
  await page.focus(selector);
  // 清空原有内容
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');

  // 逐字输入并处理换行
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

function fixCookies(rawCookies) {
  return rawCookies.map(cookie => {
    if (cookie.sameSite) {
      const ss = cookie.sameSite.toLowerCase();
      if (ss === 'lax') cookie.sameSite = 'Lax';
      else if (ss === 'strict') cookie.sameSite = 'Strict';
      else if (ss === 'none') cookie.sameSite = 'None';
      else delete cookie.sameSite;
    } else {
      delete cookie.sameSite;
    }
    delete cookie.storeId; delete cookie.hostOnly; delete cookie.session;
    return cookie;
  });
}

async function scrollAndFindUser(page, username) {
  log('info', `🔍 寻找用户: ${username}`);
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
    await page.waitForTimeout(1200);
  }
  return false;
}

async function main() {
  const users = CONFIG.targetUsers.split('\n').map(u => u.trim()).filter(u => u);
  let rawCookies;
  try {
    rawCookies = JSON.parse(process.env.DOUYIN_COOKIES);
  } catch (e) {
    log('error', 'COOKIES JSON 解析失败');
    process.exit(1);
  }

  const cleanCookies = fixCookies(rawCookies);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  try {
    await context.addCookies(cleanCookies);
    const page = await context.newPage();
    log('info', '🚀 正在进入页面...');
    await page.goto(CONFIG.url, { waitUntil: 'domcontentloaded', timeout: CONFIG.gotoTimeout });
    await page.waitForTimeout(10000);

    if (page.url().includes('login')) {
      log('error', '❌ Cookie 已失效');
      return;
    }

    // 1. 先生成好最终文案 (去重、换行已处理)
    const apiContent = await getHitokoto();
    const finalMsg = CONFIG.messageTemplate.replace('[API]', apiContent);

    const failedUsers = [];
    const inputSelector = 'div[contenteditable="true"], .chat-input-dccKiL, textarea';

    // 2. 遍历发送
    for (const user of users) {
      try {
        const found = await scrollAndFindUser(page, user);
        if (!found) {
          failedUsers.push(user);
          continue;
        }
        await page.waitForTimeout(2000);
        await page.waitForSelector(inputSelector, { timeout: 8000 });
        
        await typeRealMessage(page, inputSelector, finalMsg);
        
        log('success', `✨ 已发给: ${user}`);
        await page.waitForTimeout(3000);
      } catch (e) {
        log('error', `❌ ${user} 异常`);
        failedUsers.push(user);
      }
    }

    // 3. 重试逻辑 (重试时同样使用键盘模拟输入)
    if (failedUsers.length > 0) {
      log('info', `🔁 正在重试 ${failedUsers.length} 个用户`);
      for (const user of failedUsers) {
        for (let i = 1; i <= 2; i++) {
          try {
            if (await scrollAndFindUser(page, user)) {
              await page.waitForSelector(inputSelector, { timeout: 8000 });
              await typeRealMessage(page, inputSelector, finalMsg);
              log('success', `✅ 重试成功: ${user}`);
              break;
            }
          } catch (e) {
            await page.waitForTimeout(2000);
          }
        }
      }
    }
  } catch (e) {
    log('error', `致命错误: ${e.message}`);
  } finally {
    await browser.close();
    log('info', '🏁 任务结束');
  }
}

main();
