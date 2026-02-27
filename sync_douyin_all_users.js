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

// 日志函数
const log = (level, msg, ...args) => {
  const timestamp = new Date().toLocaleTimeString();
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
    // 获取文件sha（更新用）
    const getRes = await axios.get(CONFIG.GITEE_JSON_URL, {
      params: { access_token: token },
      timeout: 20000
    }).catch(err => {
        if (err.response?.status === 404) return null; // 文件不存在
        throw err;
    });
    const sha = getRes?.data?.sha;
    // 上传更新或新建
    await axios.put(CONFIG.GITEE_JSON_URL, {
      access_token: token,
      content: base64Content,
      message: sha ? 'update: 同步抖音私信全量用户数据(含最近聊天时间)' : 'init: 初始化抖音私信全量用户JSON数据(含最近聊天时间)',
      sha: sha
    }, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
      timeout: 30000
    });
    return true;
  } catch (err) {
    log('error', `❌ Gitee JSON上传失败: ${err.message}`);
    if (err.response) log('error', `   响应: ${JSON.stringify(err.response.data)}`);
    return false;
  }
};

// =============== 新增：UTC转北京时间函数 ===============
// 专门解决服务器是UTC，想显示北京时间的问题
function convertUtcToBeijingTime(utcStr) {
  // 如果是“刚刚”、“小时前”这种相对描述，直接返回（没法算）
  if (!utcStr || utcStr.includes('刚刚') || utcStr.includes('分钟') || utcStr.includes('小时') || utcStr.includes('昨天') || utcStr.includes('前天')) {
    return utcStr;
  }

  // 尝试解析 "02-27 02:30" 这种格式（无年份）
  const shortMatch = utcStr.match(/(\d{2})-(\d{2}) (\d{2}:\d{2})/);
  if (shortMatch) {
    const now = new Date();
    // 构造一个UTC时间
    const utcDate = new Date(Date.UTC(
      now.getFullYear(),
      parseInt(shortMatch) - 1,
      parseInt(shortMatch),
      parseInt(shortMatch.split(':')),
      parseInt(shortMatch.split(':'))
    ));
    // 转为北京时间（加8小时）
    utcDate.setHours(utcDate.getHours() + 8);
    return formatDate(utcDate);
  }

  // 尝试解析 "2026-02-27 02:30" 这种格式
  const fullMatch = utcStr.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
  if (fullMatch) {
    const utcDate = new Date(Date.UTC(
      parseInt(fullMatch),
      parseInt(fullMatch) - 1,
      parseInt(fullMatch),
      parseInt(fullMatch.split(':')),
      parseInt(fullMatch.split(':'))
    ));
    utcDate.setHours(utcDate.getHours() + 8);
    return formatDate(utcDate);
  }

  // 都不匹配，原样返回
  return utcStr;
}

// 格式化日期为 "MM-DD HH:mm"（保持和原来一样的风格）
function formatDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}
// ==================================================

async function runSync() {
  let browser = null;
  let page = null;
  try {
    log('info', '🚀 启动抖音私信全量用户采集脚本');
    log('info', `⏳ 脚本开始前等待 ${CONFIG.PRE_SCRIPT_WAIT / 1000} 秒...`);
    await new Promise(resolve => setTimeout(resolve, CONFIG.PRE_SCRIPT_WAIT));

    // 1. 环境变量校验
    const giteeToken = process.env.GITEE_TOKEN?.trim();
    const douyinCookies = process.env.DOUYIN_COOKIES?.trim();
    if (!giteeToken || !douyinCookies) {
      log('error', '❌ 缺少环境变量 GITEE_TOKEN 或 DOUYIN_COOKIES');
      process.exit(1);
    }

    // 2. 启动浏览器
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });

    // Cookie 处理
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
    page = await context.newPage();

    // 3. 进入页面
    log('info', '🌐 进入抖音创作者私信页...');
    await page.goto(CONFIG.CREATOR_CHAT_URL, { waitUntil: 'domcontentloaded', timeout: CONFIG.GOTO_TIMEOUT });
    await page.waitForTimeout(15000);

    // 验证登录
    if (page.url().includes('login')) {
      log('error', '❌ Cookie已失效');
      process.exit(1);
    }

    // 等待列表加载
    log('info', '🔍 等待用户列表渲染...');
    await page.waitForSelector('.semi-list-item, [class*="name"]', { timeout: 60000 });

    // 4. 全量采集核心逻辑
    log('info', '✅ 开始全量滚动采集（含最近聊天时间）');

    const scanResult = await page.evaluate(async (CONFIG) => {
      const allUsers = [];
      const processedIds = new Set();
      const PROCESSED_ATTR = 'data-user-processed';
      let noNewUserCount = 0;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      // --- 辅助函数（保持不变）---
      function triggerMouseEvent(element, eventType) {
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const event = new MouseEvent(eventType, {
          bubbles: true, cancelable: true, view: window,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2
        });
        element.dispatchEvent(event);
      }
      function findHoverTarget() {
        const elements = document.querySelectorAll('span, div, a');
        for (const el of elements) {
          if (el.textContent.trim() === '查看Ta的主页') return el;
        }
        return null;
      }
      function findScrollContainer() {
        const semiContainer = document.querySelector('.semi-list, .semi-list-items');
        if (semiContainer) return semiContainer;
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
          const style = window.getComputedStyle(div);
          if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && div.scrollHeight > div.clientHeight) {
            return div;
          }
        }
        return document.scrollingElement;
      }
      async function scrollDouyinList() {
        const container = findScrollContainer();
        const startTop = container.scrollTop;
        const steps = CONFIG.SCROLL_TOTAL_STEP / CONFIG.SCROLL_STEP;
        for (let i = 0; i < steps; i++) {
          container.scrollTop += CONFIG.SCROLL_STEP;
          await sleep(50);
        }
        container.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
        await sleep(1500);
        return container.scrollTop > startTop;
      }

      // --- 采集循环 ---
      try {
        const container = findScrollContainer();
        for (let attempt = 0; attempt < CONFIG.MAX_SCROLL_ATTEMPTS; attempt++) {
          const potentialNicknames = Array.from(document.querySelectorAll(
            '.semi-list-item .item-header-name-vL_79m, .semi-list-item span[class*="name"]'
          ));
          const unprocessed = potentialNicknames.filter(el => !el.hasAttribute(PROCESSED_ATTR));
          if (unprocessed.length === 0) {
            noNewUserCount++;
            const scrolled = await scrollDouyinList();
            if (!scrolled || noNewUserCount >= CONFIG.MAX_NO_NEW_USER_COUNT) break;
            continue;
          }
          noNewUserCount = 0;
          for (const nickEl of unprocessed) {
            if (nickEl.hasAttribute(PROCESSED_ATTR)) continue;
            const nickname = nickEl.textContent.trim();
            const rowItem = nickEl.closest('.semi-list-item');

            // 1. 获取头像
            let avatar = 'default.jpg';
            if (rowItem) {
              const imgEl = rowItem.querySelector('.semi-avatar img, img[src*="avatar"]');
              if (imgEl && imgEl.src) {
                avatar = imgEl.src;
                if (avatar.startsWith('//')) avatar = 'https:' + avatar;
              }
            }

            // ====== 提取最近聊天时间 (原始 UTC 时间) ======
            let lastChatTime = '未获取到';
            const timeEl = rowItem?.querySelector('[class^="item-header-time-"], [class*="time"]');
            if (timeEl) {
              lastChatTime = timeEl.textContent.trim();
            }
            // =====================================

            // 滚动并点击
            nickEl.scrollIntoView({ block: "center" });
            await sleep(100);
            nickEl.click({ force: true });
            await sleep(1500);

            // 2. 获取抖音号
            let douyinId = '未获取到';
            const hoverTarget = findHoverTarget();
            if (hoverTarget) {
              triggerMouseEvent(hoverTarget, 'mousemove');
              await sleep(50);
              triggerMouseEvent(hoverTarget, 'mouseenter');
              await sleep(50);
              triggerMouseEvent(hoverTarget, 'mouseover');
              for (let k = 0; k < 15; k++) {
                await sleep(150);
                const match = document.body.innerText.match(/抖音号\s*[:：]\s*([\w\.\-_]+)/);
                if (match) {
                  douyinId = match.trim();
                  break;
                }
              }
              triggerMouseEvent(hoverTarget, 'mouseleave');
            }

            // 存储数据
            const uniqueKey = douyinId !== '未获取到' ? douyinId : `nick_${nickname}`;
            if (!processedIds.has(uniqueKey)) {
              processedIds.add(uniqueKey);
              allUsers.push({
                nickname: nickname,
                douyinId: douyinId,
                avatar: avatar,
                lastChatTime: lastChatTime // 存储原始时间
              });
            }
            nickEl.setAttribute(PROCESSED_ATTR, 'true');
            await sleep(200);
          }
          await scrollDouyinList();
        }
        return { success: true, allUsers, count: allUsers.length };
      } catch (e) {
        return { success: false, error: e.message, allUsers: [] };
      }
    }, CONFIG);

    if (!scanResult.success) {
      log('error', `⚠️ 采集异常: ${scanResult.error}`);
    }
    log('info', `📝 采集完成，共获取 ${scanResult.count || 0} 个用户`);

    // =============== 关键步骤：转换时间 ===============
    log('info', '🕰️ 正在将 UTC 时间转换为 北京时间...');
    const finalUsers = scanResult.allUsers.map(user => {
      // 调用我们上面写的转换函数
      const beijingTime = convertUtcToBeijingTime(user.lastChatTime);
      return {
        ...user,
        lastChatTime: beijingTime
      };
    });
    // =============================================

    // 5. 保存与上传
    const jsonStr = JSON.stringify(finalUsers, null, 2);
    fs.writeFileSync(CONFIG.LOCAL_USERS_JSON, jsonStr, 'utf8');

    log('info', '📤 同步到 Gitee...');
    const uploadRes = await uploadJsonToGitee(jsonStr, giteeToken);

    if (uploadRes) {
      log('success', '✅ 任务全部完成（时间已转换为北京时间）');
    } else {
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
