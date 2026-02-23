const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// === 配置区 ===
const CONFIG = {
  // 抖音创作者后台私信页面URL
  url: 'https://creator.douyin.com/creator-micro/data/following/chat',
  // 读取目标用户
  targetUsers: fs.existsSync(path.join(__dirname, 'users.txt'))
    ? fs.readFileSync(path.join(__dirname, 'users.txt'), 'utf8')
    : '用户1\n用户2\n用户3',
  // 标题在这里统一定义，[API] 会被替换为下方 getHitokoto 的内容
  messageTemplate: process.env.MESSAGE_TEMPLATE || '꧁————每日续火————꧂\n\n[API]',
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
    // ==========================================
    const now = new Date();
    // 转换为 北京时间的时间戳 (毫秒)
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
      const endDate = new Date(lastDay);
      const endDateBeijing = new Date(endDate.getTime() + (8 * 60 * 60 * 1000));
      endDateBeijing.setHours(23, 59, 59, 999);

      // --- 计算时间差 ---
      const ms = endDateBeijing - nowBeijing; 
      const d = Math.floor(ms / (1000 * 60 * 60 * 24));
      const h = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

      // --- 计算距离放假开始还有几天 (用于非假期期间显示) ---
      const firstDate = new Date(firstDay);
      const firstDateBeijing = new Date(firstDate.getTime() + (8 * 60 * 60 * 1000));
      const totalMs = firstDateBeijing - nowBeijing;
      const totalDays = Math.ceil(totalMs / (1000 * 60 * 60 * 24)); 

      if (dayInfo.is_holiday && dayInfo.legal_holiday_name === name) {
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

    // 最终文案（去掉了标题“每日续火”）
    let msg = `今日${city}：${weather}，气温${temp}℃，${wind}${windPower}，${weekday}，农历${lunar}`;
    
    msg += festivalText;
    
    msg += `
    
由我为您推荐今日抖音热搜 TOP5：
${hotList}

${yiyan}
\n接自动抖音续火花5米-30米/月 有需要可直接在此处聊天发信息`;

    return msg;
  } catch (e) {
    // 如果出错，返回简单文本（去掉了标题）
    return '保持热爱，奔赴山海。';
  }
}

/**
 * 模拟真实按键输入（解决换行符 \n 失效问题）
 */
async function typeRealMessage(page, selector, text) {
  await page.focus(selector);
  // 先清空输入框
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');

  // 逐字输入，遇到换行按 Shift+Enter
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
  await page.keyboard.press('Enter'); // 发送
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
    delete cookie.storeId;
    delete cookie.hostOnly;
    delete cookie.session;
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
  const browser = await chromium.launch({ headless: true }); // GitHub Actions 运行
  const context = await browser.newContext();
  
  // 注入 Cookie
  const cookies = JSON.parse(process.env.DOUYIN_COOKIES || '[]');
  await context.addCookies(cookies);
  const page = await context.newPage();

  try {
    log('info', '正在打开私信页面...');
    await page.goto(CONFIG.url, { waitUntil: 'networkidle', timeout: CONFIG.gotoTimeout });
    await page.waitForTimeout(5000); 

    // 获取待办用户列表
    let pendingUsers = CONFIG.targetUsers.split('\n').map(u => u.trim()).filter(u => u);
    const nameSelector = '.item-header-name-vL_79m';
    const gridSelector = '.ReactVirtualized__Grid';

    // 每一轮滑动的逻辑
    for (let cycle = 0; cycle < 50; cycle++) {
      if (pendingUsers.length === 0) break;

      // 1. 获取当前视口所有可见名字
      const visibleNames = await page.$$eval(nameSelector, els => els.map(el => el.innerText.trim()));
      
      let foundInThisRound = false;
      for (const user of pendingUsers) {
        if (visibleNames.includes(user)) {
          log('info', `🎯 找到目标用户: ${user}`);
          // 点击用户（增加一点延迟模拟真人）
          await page.locator(nameSelector).filter({ hasText: user }).last().click();
          await page.waitForTimeout(2000);

          // --- 发送消息逻辑 ---
          const apiContent = await getHitokoto();
          const finalMsg = CONFIG.messageTemplate.replace('[API]', apiContent);
          const inputSelector = 'div[contenteditable="true"]';
          
          await page.focus(inputSelector);
          await page.keyboard.type(finalMsg, { delay: 50 });
          await page.keyboard.press('Enter');
          
          log('success', `✨ 已发给: ${user}`);
          pendingUsers = pendingUsers.filter(u => u !== user); // 移除已完成
          foundInThisRound = true;
          await page.waitForTimeout(3000);
        }
      }

      // 2. 如果没找齐，执行“可视小幅滚动”
      if (pendingUsers.length > 0) {
        log('info', `未找齐，执行可视化小幅下划 (当前剩余: ${pendingUsers.length}人)...`);
        
        // 确保鼠标在侧边栏区域
        const gridBox = await page.locator(gridSelector).boundingBox();
        if (gridBox) {
          await page.mouse.move(gridBox.x + 50, gridBox.y + 100);
          
          // --- 核心改动：小步幅物理滚动 ---
          // 每次只滚 100px，分 4 次滚，每步停顿，确保 React 能反应过来
          for (let step = 0; step < 4; step++) {
            await page.mouse.wheel(0, 100); // 往下拨动 100 像素
            await page.waitForTimeout(150); // 微调停顿，产生“可视”滚动感
          }
        }

        // 补一个 scroll 事件通知 React 重绘 DOM
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.dispatchEvent(new Event('scroll', { bubbles: true }));
        }, gridSelector);

        await page.waitForTimeout(1500); // 等待新名字渲染
      }
    }
  } catch (err) {
    log('error', `运行出错: ${err.message}`);
    await page.screenshot({ path: 'debug_error.png' });
  } finally {
    await browser.close();
  }
}

main();