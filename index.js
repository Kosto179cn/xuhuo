const { chromium } = require('playwright');
const axios = require('axios');

// === 配置区 ===
const CONFIG = {
  // 抖音创作者后台私信页面URL
  url: 'https://creator.douyin.com/creator-micro/data/following/chat',
  
  // ⭐ 从环境变量 TARGET_USERS 读取抖音号列表 (一行一个)，与 Actions 工作流文件中的变量名对应
  targetDyIds: (process.env.TARGET_USERS || '').split('\n').map(id => id.trim()).filter(id => id),
  
  // ⭐ 新增：单人模式：如果设置了环境变量，则只发送给该用户 (优先级最高)
  onlyFor: process.env.ONLY_FOR_KOSTO || '',

  // 标题在这里统一定义，[API] 会被替换为下方 getHitokoto 的内容
  messageTemplate: process.env.MESSAGE_TEMPLATE || '꧁————每日续火————꧂\n\n[API]',
  gotoTimeout: 60000,
  
  // Gitee 配置
  giteeRepoOwner: 'Kosto179',
  giteeRepoName: 'kosto-battle-clicker-new',
  giteeFilePath: 'douyinh.txt',
  giteeBranch: 'master',
  giteeToken: process.env.GITEE_TOKEN,
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
    // 最终文案
    let msg = `今日${city}：${weather}，气温${temp}℃，${wind}${windPower}，${weekday}，农历${lunar}`;
    
    msg += festivalText;
    
    msg += `\n    \n由我为您推荐今日抖音热搜 TOP5：\n${hotList}\n${yiyan}\n\n接自动抖音续火花5米-30米/月 有需要可直接在此处聊天发信息`;
    return msg;
  } catch (e) {
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

// ============ 抖音ID获取核心函数 ============
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

// 上传文件到 Gitee
async function uploadToGitee(data) {
  if (!CONFIG.giteeToken) {
    log('error', '❌ GITEE_TOKEN 未设置，无法上传数据');
    return;
  }

  try {
    const apiUrl = `https://gitee.com/api/v5/repos/${CONFIG.giteeRepoOwner}/${CONFIG.giteeRepoName}/contents/${CONFIG.giteeFilePath}`;
    
    // 获取当前文件信息（用于获取 sha）
    const fileResponse = await axios.get(apiUrl, {
      params: {
        ref: CONFIG.giteeBranch
      },
      headers: {
        Authorization: `Bearer ${CONFIG.giteeToken}`
      }
    });

    const currentSha = fileResponse.data.sha;
    const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');

    const updateResponse = await axios.put(apiUrl, {
      access_token: CONFIG.giteeToken,
      content: content,
      sha: currentSha,
      message: `Update douyinh.txt - ${new Date().toISOString()}`,
      branch: CONFIG.giteeBranch
    });

    log('success', '✅ 用户数据已成功上传到 Gitee');
  } catch (e) {
    if (e.response) {
      log('error', `❌ Gitee API 错误: ${e.response.status} - ${e.response.data.message || e.response.data}`);
    } else {
      log('error', `❌ 上传到 Gitee 时发生错误: ${e.message}`);
    }
  }
}

async function scanAllUsers(page) {
  log('info', '🔍 开始扫描所有用户...');
  
  let allUsers = [];
  let maxScrollAttempts = 100; 
  let scrollAttempt = 0;
  let previousUserCount = 0;
  let noChangeCount = 0;

  while (scrollAttempt < maxScrollAttempts && noChangeCount < 5) {
    scrollAttempt++;
    log('info', `🔄 第 ${scrollAttempt} 次扫描...`);
    
    // 获取当前页面可见的所有用户元素
    const visibleUsers = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll('span[class*="name"]'));
        return spans.map(el => ({
            name: el.textContent.trim(),
            elementIndex: spans.indexOf(el)
        })).filter(u => u.name);
    });

    if (visibleUsers.length === 0) {
        log('warn', '⚠️ 当前页面未加载任何用户，尝试滚动...');
    }

    // 检查是否有新用户被加载
    if (visibleUsers.length <= previousUserCount) {
      noChangeCount++;
    } else {
      noChangeCount = 0; // 有新增用户，重置计数器
    }
    previousUserCount = visibleUsers.length;

    // 遍历当前可见用户，获取抖音号
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
      
      await page.waitForTimeout(2000);

      // 获取抖音号
      const dyId = await getDouyinId(page);
      
      if (dyId) {
          log('info', `🆔 用户 [${userDisplayname}] 的抖音号: ${dyId}`);
          
          // 检查是否在目标列表中
          const isActive = CONFIG.targetDyIds.includes(dyId) ? 1 : 0;
          
          // 检查是否已存在，避免重复添加
          const existingUser = allUsers.find(user => user.id === dyId);
          if (!existingUser) {
            allUsers.push({
              id: dyId,
              name: userDisplayname,
              status: isActive
            });
          }
      } else {
          log('warn', `⚠️ 未能获取用户 [${userDisplayname}] 的抖音号`);
      }
      
      // 返回列表（可以通过再次点击其他用户或刷新来实现，这里简单等待）
      await page.waitForTimeout(1000);
    }

    // 滚动加载更多
    log('info', '⬇️ 向下滚动加载更多...');
    await page.evaluate(async () => {
       const scrollContainer = document.querySelector('.ReactVirtualized__Grid, [role="grid"], .semi-list-items');
       if (!scrollContainer) {
         window.scrollBy(0, 800);
         return;
       }
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
     await page.waitForTimeout(2000);
  }

  log('info', `✅ 扫描完成，共获取到 ${allUsers.length} 个用户`);
  return allUsers;
}

async function main() {
  // 1. 初始化
  let targetDyIds = new Set(CONFIG.targetDyIds);
  
  // 如果没有配置 TARGET_USERS，直接退出
  if (targetDyIds.size === 0) {
    log('error', '❌ 未在环境变量 TARGET_USERS 中找到任何抖音号，请检查 Actions 工作流配置');
    log('error', '📌 确保工作流文件中 env.TARGET_USERS 映射了仓库机密 TARGET_USERS');
    process.exit(1);
  }
  
  // ⭐ 单人模式：如果设置了 ONLY_FOR_KOSTO，则只发送给该用户
  if (CONFIG.onlyFor) {
    const onlyUser = CONFIG.onlyFor.trim();
    targetDyIds = new Set([onlyUser]);
    log('info', `🎯 单人模式已启用，仅发送给: ${onlyUser}`);
  } else {
    log('info', `📋 已加载 ${targetDyIds.size} 个目标抖音号`);
  }

  let rawCookies;
  try {
    rawCookies = JSON.parse(process.env.DOUYIN_COOKIES);
  } catch (e) {
    log('error', 'COOKIES JSON 解析失败');
    process.exit(1);
  }
  const cleanCookies = fixCookies(rawCookies);
  
  const isCI = process.env.CI === 'true';
  const browser = await chromium.launch({ 
      headless: true,
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
    
    // ⭐ 等待时间延长至 60 秒
    log('info', '⏳ 等待页面完全加载及稳定 (60秒)...');
    await page.waitForTimeout(60000);

    if (page.url().includes('login')) {
      log('error', '❌ Cookie 已失效');
      return;
    }

    // 2. 扫描所有用户
    const allUsers = await scanAllUsers(page);
    
    // 3. 上传用户数据到 Gitee
    await uploadToGitee(allUsers);
    
    // 4. 统计目标用户发送情况
    const apiContent = await getHitokoto();
    const finalMsg = CONFIG.messageTemplate.replace('[API]', apiContent);
    const inputSelector = 'div[contenteditable="true"], .chat-input-dccKiL, textarea';

    let totalSent = 0;
    let pendingDyIds = new Set(targetDyIds); // 用于追踪尚未发送的目标

    // 重新遍历所有用户，只给目标用户发消息
    for (const user of allUsers) {
      if (user.status === 1) { // 只处理目标用户
        // 找到该用户在列表中的位置并点击
        const userIndex = await page.evaluate((userName) => {
          const spans = Array.from(document.querySelectorAll('span[class*="name"]'));
          return spans.findIndex(el => el.textContent.trim() === userName);
        }, user.name);

        if (userIndex !== -1) {
          await page.evaluate((index) => {
            const spans = Array.from(document.querySelectorAll('span[class*="name"]'));
            if(spans[index]) {
              spans[index].scrollIntoView();
              spans[index].click();
            }
          }, userIndex);
          
          await page.waitForTimeout(2000);

          try {
            await page.waitForSelector(inputSelector, { timeout: 8000 });
            await typeRealMessage(page, inputSelector, finalMsg);
            log('success', `✨ 已发给: ${user.id} (${user.name})`);
            
            totalSent++;
            pendingDyIds.delete(user.id);
            
            await page.waitForTimeout(3000);
          } catch (e) {
            log('error', `❌ ${user.id} 发送失败: ${e.message}`);
          }
        }
      }
    }

    if (pendingDyIds.size === 0) {
        log('success', '🎉 所有目标抖音号均已发送完成！');
    } else {
        log('warn', `⚠️ 任务结束，仍有 ${pendingDyIds.size} 个目标未发送:`, Array.from(pendingDyIds).join(', '));
    }
    
    log('info', `🏁 最终统计：成功发送 ${totalSent} 人`);

  } catch (e) {
    log('error', `致命错误: ${e.message}`);
    console.error(e.stack);
  } finally {
    await browser.close();
  }
}

main();
