const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 固定配置
const CONFIG = {
  GITEE_JSON_URL: 'https://gitee.com/api/v5/repos/Kosto179/kosto-battle-clicker-new/contents/douyin_all_users.json',
  LOCAL_USERS_JSON: 'douyin_all_users.json',
  CREATOR_CHAT_URL: 'https://creator.douyin.com/creator-micro/data/following/chat',
  GOTO_TIMEOUT: 120000,
  MAX_SCROLL_ATTEMPTS: 150,
  SCROLL_TOTAL_STEP: 600,
  SCROLL_STEP: 100,
  MAX_NO_NEW_USER_COUNT: 8,
  PRE_SCRIPT_WAIT: 30000
};

// 日志函数（显示北京时间）
const log = (level, msg, ...args) => {
  const beijingNow = new Date(new Date().getTime() + 8 * 60 * 60 * 1000);
  const timestamp = beijingNow.toLocaleTimeString();
  const colors = {
    info: '\x1b[36m',
    success: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m'
  };
  const reset = '\x1b[0m';
  const color = colors[level] || colors.info;
  console.log(`[${timestamp}] ${color}[${level.toUpperCase()}]${reset} ${msg}`, ...args);
};

// Gitee上传JSON文件
const uploadJsonToGitee = async (content, token) => {
  try {
    const base64Content = Buffer.from(content).toString('base64');
    const getRes = await axios.get(CONFIG.GITEE_JSON_URL, {
      params: { access_token: token },
      timeout: 20000
    }).catch(err => {
        if (err.response?.status === 404) return null;
        throw err;
    });
    const sha = getRes?.data?.sha;
    await axios.put(CONFIG.GITEE_JSON_URL, {
      access_token: token,
      content: base64Content,
      message: sha ? 'update: 抖音私信用户(获抖音号+北京时间)' : 'init: 抖音私信用户(获抖音号+北京时间)',
      sha: sha
    }, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
      timeout: 30000
    });
    return true;
  } catch (err) {
    log('error', `❌ Gitee上传失败: ${err.message}`);
    if (err.response) log('error', `   响应: ${JSON.stringify(err.response.data)}`);
    return false;
  }
};

// 核心：UTC时间(HH:MM) → 北京时间(HH:MM) 仅显示时间，无日期
function convertUtcToBeijingTimeOnly(utcTimeStr) {
  // 匹配纯时间格式 HH:MM，其他格式直接返回
  const timeMatch = utcTimeStr.match(/^(\d{2}):(\d{2})$/);
  if (!timeMatch) return utcTimeStr;

  let utcHours = parseInt(timeMatch[1], 10);
  const utcMinutes = parseInt(timeMatch[2], 10);

  // UTC+8得到北京时间，处理跨天（如UTC23:30→北京07:30）
  let bjHours = utcHours + 8;
  if (bjHours >= 24) bjHours -= 24;

  // 补0返回纯时间
  return `${String(bjHours).padStart(2, '0')}:${String(utcMinutes).padStart(2, '0')}`;
}

// 主函数
async function runSync() {
  let browser = null;
  try {
    log('info', '🚀 启动抖音私信采集（强更抖音号+纯北京时间）');
    await new Promise(resolve => setTimeout(resolve, CONFIG.PRE_SCRIPT_WAIT));

    // 环境变量校验
    const giteeToken = process.env.GITEE_TOKEN?.trim();
    const douyinCookies = process.env.DOUYIN_COOKIES?.trim();
    if (!giteeToken || !douyinCookies) {
      log('error', '❌ 缺少GITEE_TOKEN或DOUYIN_COOKIES');
      process.exit(1);
    }

    // 启动浏览器（关闭无头可调试，调试完改回true）
    browser = await chromium.launch({
      headless: true, 
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--start-maximized']
    });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      extraHTTPHeaders: { 'accept-language': 'zh-CN,zh;q=0.9' }
    });

    // Cookie处理
    const cleanCookies = JSON.parse(douyinCookies).map(cookie => {
      if (cookie.sameSite) {
        const ss = cookie.sameSite.toLowerCase();
        cookie.sameSite = ['strict', 'lax', 'none'].includes(ss) ? ss.charAt(0).toUpperCase() + ss.slice(1) : 'Lax';
      } else {
        cookie.sameSite = 'Lax';
      }
      delete cookie.storeId; delete cookie.hostOnly; delete cookie.session;
      return cookie;
    });
    await context.addCookies(cleanCookies);
    const page = await context.newPage();

    // 访问私信页
    log('info', '🌐 进入抖音创作者私信页...');
    await page.goto(CONFIG.CREATOR_CHAT_URL, { waitUntil: 'networkidle', timeout: CONFIG.GOTO_TIMEOUT });
    await page.waitForTimeout(10000);

    // 验证Cookie有效性
    if (page.url().includes('login') || page.url().includes('passport')) {
      log('error', '❌ Cookie失效，请重新获取');
      process.exit(1);
    }
    log('info', '🔍 Cookie有效，等待用户列表加载...');
    await page.waitForSelector('.semi-list-item', { timeout: 60000 });

    // 核心采集（强化抖音号获取逻辑）
    const scanResult = await page.evaluate(async (CONFIG) => {
      const allUsers = [];
      const processedIds = new Set();
      const PROCESSED_ATTR = 'data-user-processed';
      let noNewUserCount = 0;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      // 找滚动容器（精准匹配私信列表）
      function findScrollContainer() {
        return document.querySelector('[class*="chat-list"]') || document.querySelector('.semi-list') || document.scrollingElement;
      }

      // 滚动列表（触发懒加载）
      async function scrollDouyinList() {
        const container = findScrollContainer();
        const startTop = container.scrollTop;
        container.scrollTop = container.scrollTop + CONFIG.SCROLL_TOTAL_STEP;
        await sleep(2000);
        return container.scrollTop > startTop;
      }

      try {
        const container = findScrollContainer();
        for (let attempt = 0; attempt < CONFIG.MAX_SCROLL_ATTEMPTS; attempt++) {
          // 只取未处理的用户项
          const userItems = Array.from(document.querySelectorAll('.semi-list-item')).filter(el => !el.hasAttribute(PROCESSED_ATTR));
          if (userItems.length === 0) {
            noNewUserCount++;
            const scrolled = await scrollDouyinList();
            if (!scrolled || noNewUserCount >= CONFIG.MAX_NO_NEW_USER_COUNT) break;
            continue;
          }
          noNewUserCount = 0;

          for (const item of userItems) {
            item.setAttribute(PROCESSED_ATTR, 'true');
            // 提取昵称
            const nickEl = item.querySelector('[class*="name"], .item-header-name-vL_79m');
            const nickname = nickEl?.textContent.trim() || '未知昵称';
            // 提取原始UTC时间
            let lastChatTime = '未获取到';
            const timeEl = item.querySelector('[class*="time"], .item-header-time-*');
            if (timeEl && timeEl.textContent) lastChatTime = timeEl.textContent.trim();
            // 提取头像
            let avatar = 'default.jpg';
            const imgEl = item.querySelector('img[src*="avatar"], .semi-avatar img');
            if (imgEl && imgEl.src) avatar = imgEl.src.startsWith('//') ? `https:${imgEl.src}` : imgEl.src;

            // ********** 强化：抖音号获取核心逻辑 **********
            let douyinId = '未获取到';
            // 1. 点击用户项，确保右侧聊天窗口加载完成
            item.click({ force: true });
            await sleep(2000);
            // 2. 精准找“查看Ta的主页”（优先找聊天窗口的头像/昵称区域）
            const homeLink = document.querySelector('[title*="查看主页"], [text="查看Ta的主页"], a[href*="/user/"]') || Array.from(document.querySelectorAll('span, div')).find(el => el.textContent.trim() === '查看Ta的主页');
            if (homeLink) {
              // 3. 悬浮触发弹窗（多次触发确保加载）
              homeLink.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 100, clientY: 100 }));
              homeLink.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
              await sleep(1500); // 延长弹窗加载时间
              // 4. 多正则匹配抖音号（兼容“抖音号：xxx”/“抖音号xxx”/“ID：xxx”）
              const bodyText = document.body.innerText;
              const dyMatch = bodyText.match(/抖音号\s*[:：]\s*([\w\.\-_\d]+)/) || bodyText.match(/抖音号\s*([\w\.\-_\d]+)/) || bodyText.match(/ID\s*[:：]\s*([\w\.\-_\d]+)/);
              if (dyMatch && dyMatch[1]) {
                douyinId = dyMatch[1].trim();
                // 去重：避免匹配到多余字符
                douyinId = douyinId.replace(/[^\w\.\-_\d]/g, '');
              }
              // 移开鼠标，防止弹窗遮挡后续操作
              homeLink.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
            }

            // 去重存储（优先抖音号，无则用昵称）
            const uniqueKey = douyinId !== '未获取到' ? douyinId : `nick_${nickname}`;
            if (!processedIds.has(uniqueKey)) {
              processedIds.add(uniqueKey);
              allUsers.push({ nickname, douyinId, avatar, lastChatTime });
            }
            await sleep(500);
          }
          await scrollDouyinList();
        }
        return { success: true, allUsers, count: allUsers.length };
      } catch (e) {
        return { success: false, error: e.message, allUsers: [] };
      }
    }, CONFIG);

    // 采集异常处理
    if (!scanResult.success) {
      log('error', `⚠️ 采集异常: ${scanResult.error}`);
      process.exit(1);
    }
    log('info', `📝 采集完成，共获取 ${scanResult.count} 个用户`);

    // 转换时间：UTC(HH:MM)→北京时间(HH:MM) 仅显时间
    log('info', '🕰️ 转换UTC时间为纯北京时间...');
    const finalUsers = scanResult.allUsers.map(user => ({
      ...user,
      lastChatTime: convertUtcToBeijingTimeOnly(user.lastChatTime)
    }));

    // 保存本地+上传Gitee
    const jsonStr = JSON.stringify(finalUsers, null, 2);
    fs.writeFileSync(CONFIG.LOCAL_USERS_JSON, jsonStr, 'utf8');
    log('info', '📤 上传用户数据到Gitee...');
    const uploadRes = await uploadJsonToGitee(jsonStr, giteeToken);

    if (uploadRes) {
      log('success', '✅ 全部完成！抖音号已获取+时间为纯北京时间(HH:MM)');
    } else {
      log('error', '❌ 上传Gitee失败，本地文件已保存');
      process.exit(1);
    }
  } catch (err) {
    log('error', `🚨 致命错误: ${err.message}`);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

runSync();
