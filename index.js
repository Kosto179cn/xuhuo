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


async function getHitokoto() {
  try {
    // 1. 获取一言
    const { data: hitokotoData } = await axios.get('https://v1.hitokoto.cn/');
    const yiyan = `${hitokotoData.hitokoto} —— ${hitokotoData.from}`;

    // 2. 获取天气
    const { data: weatherData } = await axios.get('https://uapis.cn/api/v1/misc/weather?city=深圳&lang=zh');
    const city = weatherData.city;
    const weather = weatherData.weather;
    const temp = weatherData.temperature;
    const wind = weatherData.wind_direction;
    const windPower = weatherData.wind_power;

    // 3. 获取日历
    const { data: holidayData } = await axios.get('https://uapis.cn/api/v1/misc/holiday-calendar?timezone=Asia%2FShanghai&holiday_type=legal&include_nearby=true&nearby_limit=7');
    const dayInfo = holidayData.days[0];
    const weekday = dayInfo.weekday_cn;
    const lunar = `${dayInfo.lunar_month_name}${dayInfo.lunar_day_name}`;

    // ==========================================
    // 核心修复：处理服务器时区（假设服务器是 UTC 或美国时间）
    // JavaScript 中 new Date() 获取的是服务器本地时间。
    // 北京时间 = UTC时间 + 8小时
    // 如果服务器是美国西海岸（UTC-8），那么服务器时间比北京时间慢16小时，需要加16小时。
    // 为了通用，我们直接获取时间戳并强制加上 8小时（28800000毫秒）的偏移来得到北京时间。
    // ==========================================
    const now = new Date();
    // 转换为 北京时间的时间戳 (毫秒)
    // 注意：这里 + 8小时 是因为 UTC+8。如果你的服务器已经是 UTC，加 8 小时即可。
    const nowTimestamp = now.getTime() + (8 * 60 * 60 * 1000); 
    const nowBeijing = new Date(nowTimestamp);

    // 天数转 月+天 (辅助函数)
    function toMonthDay(days) {
      if (days < 0) return '已结束';
      if (days === 0) return '今天';
      const m = Math.floor(days / 30);
      const d = days % 30;
      if (m === 0) return `${d}天`;
      if (d === 0) return `${m}个月`;
      return `${m}个月${d}天`;
    }

    // 只保留合法假期，排除调休上班
    const nextList = (holidayData.nearby?.next || []).filter(item => {
      const e = item.events[0];
      return e.type === 'legal_rest';
    });

    // 按节日名称分组
    const groups = {};
    nextList.forEach(item => {
      const name = item.events[0].name;
      if (!groups[name]) groups[name] = [];
      groups[name].push(item.date);
    });

    const lines = [];
    for (const name in groups) {
      const days = groups[name];
      const lastDay = days[days.length - 1]; // 该节日最后一天
      const firstDay = days[0];

      // --- 计算假期结束时间 (北京时间) ---
      // lastDay 是字符串，如 "2024-02-17"
      const endDate = new Date(lastDay);
      // 1. 先给 endDate 加上 8小时偏移，使其变为北京时间
      const endDateBeijing = new Date(endDate.getTime() + (8 * 60 * 60 * 1000));
      // 2. 设置为当天的最后一秒 (23:59:59)
      endDateBeijing.setHours(23, 59, 59, 999);

      // --- 计算时间差 ---
      const ms = endDateBeijing - nowBeijing; // 现在都是北京时间，计算准确
      const d = Math.floor(ms / (1000 * 60 * 60 * 24));
      const h = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

      // --- 计算距离放假开始还有几天 (用于非假期期间显示) ---
      const firstDate = new Date(firstDay);
      const firstDateBeijing = new Date(firstDate.getTime() + (8 * 60 * 60 * 1000));
      const totalMs = firstDateBeijing - nowBeijing;
      const totalDays = Math.ceil(totalMs / (1000 * 60 * 60 * 24)); // 向上取整

      if (dayInfo.is_holiday && dayInfo.legal_holiday_name === name) {
        // 修正：如果天数为0，只显示小时
        if (d <= 0) {
          lines.push(`${name}（假期还剩 ${h}小时）`);
        } else {
          lines.push(`${name}（假期还剩 ${d}天${h}小时）`);
        }
      } else {
        lines.push(`${name}（还有 ${toMonthDay(totalDays)}）`);
      }
    }

    const festivalText = lines.length ? '\n最近假期：\n' + lines.join('\n') : '';

    // 4. 抖音热搜 TOP5
    const { data: hotData } = await axios.get('https://uapis.cn/api/v1/misc/hotboard?type=douyin&limit=10');
    const hotList = hotData.list
      .slice(0, 5)
      .map(item => `${item.index}. ${item.title} 🔥${item.hot_value}`)
      .join('\n');

    // 最终文案（确保标题只出现一次）
    let msg = `—————每日续火—————
    
今日${city}：${weather}，气温${temp}℃，${wind}${windPower}，${weekday}，农历${lunar}`;
    
    msg += festivalText;
    
    msg += `
    
由我为您推荐今日抖音热搜 TOP5：
${hotList}

${yiyan}
接抖音续火花5○-30○/月`;

    return msg;
  } catch (e) {
    // 如果出错，返回简单文本
    return '—————每日续火—————\n保持热爱，奔赴山海。';
  }
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
