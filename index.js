const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// === 配置区 ===
const CONFIG = {
  // 抖音创作者后台私信页面URL
  url: 'https://creator.douyin.com/creator-micro/data/following/chat',
  
  // ⭐ 修改：从环境变量 DYID 读取抖音号列表 (一行一个)
  // 如果没有设置环境变量，默认为空数组
  targetDyIds: (process.env.DYID || '').split('\n').map(id => id.trim()).filter(id => id),
  
  // ⭐ 新增：是否启用抖音号验证模式
  // 设置为 'true' 时，只会给 DYID 列表里匹配成功的用户发消息
  // 设置为 'false' 时，仅记录抖音号，不拦截发送（适合测试期）
  enableDyIdCheck: process.env.ENABLE_DYID_CHECK === 'true',

  // 标题在这里统一定义，[API] 会被替换为下方 getHitokoto 的内容
  messageTemplate: process.env.MESSAGE_TEMPLATE || '꧁————每日续火————꧂\n\n[API]',
  gotoTimeout: 60000,
  
  // ⭐ 单人模式：如果设置了环境变量，则只发送给该用户 (优先级最高)
  onlyFor: process.env.ONLY_FOR_KOSTO || ''
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
      const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
      // --- 计算距离放假开始还有几天 (用于非假期期间显示) ---
      const firstDate = new Date(firstDay);
      const firstDateBeijing = new Date(firstDate.getTime() + (8 * 60 * 60 * 1000));
      const totalMs = firstDateBeijing - nowBeijing;
      const totalDays = Math.ceil(totalMs / (1000 * 60 * 60 * 24)); 
      const totalHours = Math.floor(totalMs / (1000 * 60 * 60));
      const totalMinutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
      if (dayInfo.is_holiday && dayInfo.legal_holiday_name === name) {
        if (ms <= 0) {
          const pastMs = -ms;
          const pastMinutes = Math.floor(pastMs / (1000 * 60));
          if (pastMinutes < 30) {
            lines.push(`${name}（已结束${pastMinutes}分钟）`);
          } else {
            lines.push(`${name}（已结束）`);
          }
        } else if (d === 0) {
          if (h === 0) {
            lines.push(`${name}（假期还剩 ${m}分钟）`);
          } else {
            lines.push(`${name}（假期还剩 ${h}小时${m}分钟）`);
          }
        } else {
          lines.push(`${name}（假期还剩 ${d}天${h}小时）`);
        }
      } else {
        if (totalDays === 0 && totalMs > 0) {
          if (totalHours === 0) {
            lines.push(`${name}（还有 ${totalMinutes}分钟）`);
          } else {
            lines.push(`${name}（还有 ${totalHours}小时${totalMinutes}分钟）`);
          }
        } else {
          lines.push(`${name}（还有 ${toMonthDay(totalDays)}）`);
        }
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
    
    msg += `\n    \n由我为您推荐今日抖音热搜 TOP5：\n${hotList}\n${yiyan}\n\n接自动抖音续火花5米-30米/月 有需要可直接在此处聊天发信息`;
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

// ============ 抖音ID获取核心函数 (已整合) ============
async function getDouyinId(page) {
    try {
        const dyId = await page.evaluate(async () => {
            return await new Promise((resolve) => {
                // 1. 定位"查看Ta的主页"按钮
                const trigger = Array.from(document.querySelectorAll('span, div'))
                    .find(el => el.innerText && el.innerText.trim() === '查看Ta的主页');

                if (!trigger) {
                    resolve(null);
                    return;
                }

                // 2. 强制让元素可见并计算坐标
                trigger.scrollIntoView({ block: "center", inline: "center" });
                const rect = trigger.getBoundingClientRect();
                
                // 检查元素是否真的可见 (防止 headless 模式下 rect 为 0)
                if (rect.width === 0 || rect.height === 0) {
                    resolve(null);
                    return;
                }

                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;

                // 3. 构造鼠标事件
                function fireMouseEvent(type, x, y) {
                    const event = new MouseEvent(type, {
                        clientX: x,
                        clientY: y,
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        buttons: 1
                    });
                    trigger.dispatchEvent(event);
                }

                // 4. 模拟鼠标悬停事件链
                fireMouseEvent('mousemove', centerX, centerY - 10);
                fireMouseEvent('mouseenter', centerX, centerY);
                fireMouseEvent('mouseover', centerX, centerY);
                fireMouseEvent('mousemove', centerX, centerY);

                // 5. 等待并检索 semi-portal 弹窗
                let dyId = null;
                const checkInterval = setInterval(() => {
                    const portals = document.querySelectorAll('.semi-portal');
                    for (const portal of portals) {
                        if (portal.innerText.includes('抖音号：')) {
                            const match = portal.innerText.match(/抖音号：\s*([\w\.\-_]+)/);
                            if (match) {
                                dyId = match[1];
                                clearInterval(checkInterval);
                                resolve(dyId);
                                return;
                            }
                        }
                    }
                }, 300);

                // 超时处理（4.5秒）
                setTimeout(() => {
                    clearInterval(checkInterval);
                    resolve(dyId);
                }, 4500);
            });
        });
        return dyId;
    } catch (e) {
        log('warn', `获取抖音ID时发生错误: ${e.message}`);
        return null;
    }
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
  // 1. 初始化
  let users;
  
  // ⭐ 核心逻辑：如果是单人模式，直接忽略其他，强制使用指定用户
  if (CONFIG.onlyFor) {
    const onlyUser = CONFIG.onlyFor.trim();
    users = [onlyUser];
    log('info', `🎯 单人模式已启用，仅发送给: ${onlyUser}`);
  } else {
    // ⭐ 修改：这里不再读取 users.txt，而是直接使用 DYID 列表作为目标
    // 注意：这里的 users 变量现在存储的是 "期望匹配的抖音号" 或者 "昵称"
    // 如果你的 DYID 里存的是抖音号，而页面上显示的是昵称，这里需要对应调整
    // 目前逻辑：我们遍历页面上的所有用户，尝试获取他们的抖音号，然后判断抖音号是否在 CONFIG.targetDyIds 中
    
    // 为了兼容旧逻辑，如果没开抖音号验证，我们可以暂时留空或者给个提示
    if (CONFIG.enableDyIdCheck && CONFIG.targetDyIds.length === 0) {
        log('error', '❌ 已启用抖音号验证但未找到 DYID 环境变量，请检查 Secrets 设置');
        process.exit(1);
    }
    
    users = CONFIG.targetDyIds; // 这里暂时用抖音号列表占位，实际逻辑在下面动态判断
    log('info', `📋 已加载 ${users.length} 个目标抖音号 (验证模式: ${CONFIG.enableDyIdCheck})`);
  }

  let rawCookies;
  try {
    rawCookies = JSON.parse(process.env.DOUYIN_COOKIES);
  } catch (e) {
    log('error', 'COOKIES JSON 解析失败');
    process.exit(1);
  }
  const cleanCookies = fixCookies(rawCookies);
  
  // ⭐ 适配 GitHub Actions: 如果是 CI 环境，可能需要特定的启动参数
  const isCI = process.env.CI === 'true';
  const browser = await chromium.launch({ 
      headless: true, // GitHub Actions 必须 headless
      args: isCI ? ['--no-sandbox', '--disable-setuid-sandbox'] : []
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  
  try {
    await context.addCookies(cleanCookies);
    const page = await context.newPage();
    
    log('info', '🚀 正在进入抖音页面...');
    await page.goto(CONFIG.url, { waitUntil: 'domcontentloaded', timeout: CONFIG.gotoTimeout });
    
    // ⭐ 修改：等待时间延长至 60 秒，满足你的需求
    log('info', '⏳ 等待页面完全加载及稳定 (60秒)...');
    await page.waitForTimeout(60000);

    if (page.url().includes('login')) {
      log('error', '❌ Cookie 已失效');
      return;
    }

    // 💡 获取一次通用内容
    const apiContent = await getHitokoto();
    const finalMsg = CONFIG.messageTemplate.replace('[API]', apiContent);
    const inputSelector = 'div[contenteditable="true"], .chat-input-dccKiL, textarea';

    // 2. 核心逻辑：逐个处理用户
    // 现在的逻辑变为：滚动列表 -> 获取每个可见用户的抖音号 -> 判断是否在白名单 -> 发送
    
    let totalSent = 0;
    let processedCount = 0;
    
    // 标记哪些抖音号已经发送过，避免重复
    let sentDyIds = new Set();

    // 只要还有未发送的目标抖音号，就继续循环
    // 如果 enableDyIdCheck 为 false，则逻辑退化为发送给所有能获取到抖音号的人（或者你可以改回原来的昵称匹配）
    let targetSet = new Set(CONFIG.targetDyIds);
    
    // 最大滚动次数限制，防止死循环
    let maxScrollAttempts = 50; 
    let scrollAttempt = 0;

    while (scrollAttempt < maxScrollAttempts) {
        scrollAttempt++;
        log('info', `🔄 第 ${scrollAttempt} 轮扫描...`);
        
        // 获取当前页面可见的所有用户元素
        const visibleUsers = await page.evaluate(() => {
            const spans = Array.from(document.querySelectorAll('span[class*="name"]'));
            return spans.map(el => ({
                name: el.textContent.trim(),
                elementIndex: spans.indexOf(el) // 简单标记
            })).filter(u => u.name);
        });

        if (visibleUsers.length === 0) {
            log('warn', '⚠️ 当前页面未加载任何用户，尝试滚动...');
        }

        let foundInThisRound = false;

        // 遍历当前可见用户
        for (let i = 0; i < visibleUsers.length; i++) {
            const userDisplayname = visibleUsers[i].name;
            
            // 点击进入聊天
            await page.evaluate((index) => {
                const spans = Array.from(document.querySelectorAll('span[class*="name"]'));
                if(spans[index]) {
                    spans[index].scrollIntoView();
                    spans[index].click();
                }
            }, i);
            
            await page.waitForTimeout(2000); // 等待进入聊天

            // ⭐ 核心：获取抖音号
            const dyId = await getDouyinId(page);
            
            if (dyId) {
                log('info', `🆔 用户 [${userDisplayname}] 的抖音号: ${dyId}`);
                
                // 判断逻辑
                let shouldSend = false;

                if (CONFIG.enableDyIdCheck) {
                    // 验证模式：只有在白名单里才发
                    if (targetSet.has(dyId) && !sentDyIds.has(dyId)) {
                        shouldSend = true;
                        log('success', `✅ 匹配成功，准备发送给: ${dyId}`);
                    } else if (sentDyIds.has(dyId)) {
                        log('skip', `⏭️ 抖音号 ${dyId} 已发送过，跳过`);
                    } else {
                        log('skip', `⏭️ 抖音号 ${dyId} 不在白名单中，跳过`);
                    }
                } else {
                    // 非验证模式：为了测试，我们可以选择发送给所有人，或者只记录
                    // 这里设定为：如果不验证，且没发过，就发（方便你测试获取功能是否正常）
                    if (!sentDyIds.has(dyId)) {
                        shouldSend = true;
                        log('warn', `⚠️ 未开启严格验证，尝试发送给: ${dyId}`);
                    }
                }

                if (shouldSend) {
                    try {
                        await page.waitForSelector(inputSelector, { timeout: 8000 });
                        await typeRealMessage(page, inputSelector, finalMsg);
                        log('success', `✨ 已发给: ${dyId} (${userDisplayname})`);
                        totalSent++;
                        sentDyIds.add(dyId);
                        
                        // 如果开启了验证，且这个号发完了，可以从目标集合移除（可选优化）
                        // targetSet.delete(dyId); 
                        
                        await page.waitForTimeout(3000); // 发送间隔
                        foundInThisRound = true;
                    } catch (e) {
                        log('error', `❌ ${dyId} 发送失败: ${e.message}`);
                    }
                }
            } else {
                log('warn', `⚠️ 未能获取用户 [${userDisplayname}] 的抖音号，跳过`);
            }
            
            // 返回私信列表页 (通常需要点击左上角返回或刷新，这里简单处理：重新加载页面或点击返回按钮)
            // 抖音网页版点击用户后，通常左侧列表还在，直接再次点击列表其他人即可
            // 但如果状态卡住，可能需要刷新。这里假设直接循环点击列表即可。
            // 为了防止状态异常，每处理几个用户刷新一次页面是个好习惯，但会慢。
            // 暂时保持连续操作，如果发现问题再加大刷新频率。
        }

        // 如果这一轮没找到任何可发送的新用户，尝试滚动加载更多
        if (!foundInThisRound) {
             log('info', '⬇️ 本轮未发现新目标，向下滚动加载更多...');
             await page.evaluate(async () => {
                const scrollContainer = document.querySelector('.ReactVirtualized__Grid, [role="grid"], .semi-list-items');
                if (!scrollContainer) {
                  window.scrollBy(0, 800);
                  return;
                }
                // 模拟物理滚轮
                for (let j = 0; j < 8; j++) {
                  scrollContainer.dispatchEvent(new WheelEvent('wheel', {
                    deltaY: 100,
                    bubbles: true,
                    cancelable: true,
                    composed: true
                  }));
                  scrollContainer.scrollTop += 100;
                  await new Promise(r => setTimeout(r, 50));
                }
              });
              await page.waitForTimeout(2000); // 等待加载
        } else {
            // 如果这轮找到了人，重置一下滚动尝试计数？或者继续
            // 这里逻辑比较简单：一直滚直到达到最大次数
        }
        
        // 检查是否所有目标都已完成
        if (CONFIG.enableDyIdCheck && sentDyIds.size >= CONFIG.targetDyIds.length) {
            log('success', '🎉 所有目标抖音号均已发送完成！');
            break;
        }
    }

    log('info', `🏁 任务结束，成功发送 ${totalSent} 人`);
    
  } catch (e) {
    log('error', `致命错误: ${e.message}`);
    console.error(e.stack);
  } finally {
    await browser.close();
  }
}

main();