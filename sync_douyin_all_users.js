const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
// 固定配置（完全保留原有，未做任何修改）
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
// 日志函数（完全保留原有）
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
// Gitee上传JSON文件（完全保留原有上传逻辑）
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
// --- 新函数：将相对时间（如“06:16”、“昨天 05:11”）转换为北京时间戳 ---
function convertRelativeToBeijingTime(relativeStr) {
  const now = new Date();
  const beijingNow = new Date(now.getTime() + 8 * 60 * 60 * 1000); // 当前北京时间

  // 1. 处理“刚刚”、“X分钟前”、“X小时前”
  const justNowMatch = relativeStr.match(/刚刚/);
  if (justNowMatch) {
    return formatDate(beijingNow);
  }

  const minuteMatch = relativeStr.match(/(\d+)分钟前/);
  if (minuteMatch) {
    const minutes = parseInt(minuteMatch[1]);
    const time = new Date(beijingNow.getTime() - minutes * 60 * 1000);
    return formatDate(time);
  }

  const hourMatch = relativeStr.match(/(\d+)小时前/);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1]);
    const time = new Date(beijingNow.getTime() - hours * 60 * 60 * 1000);
    return formatDate(time);
  }

  // 2. 处理“昨天 HH:MM”
  const yesterdayMatch = relativeStr.match(/昨天\s*(\d{2}:\d{2})/);
  if (yesterdayMatch) {
    const [hours, minutes] = yesterdayMatch[1].split(':').map(Number);
    const time = new Date(beijingNow);
    time.setDate(beijingNow.getDate() - 1);
    time.setHours(hours, minutes, 0, 0);
    return formatDate(time);
  }

  // 3. 处理“前天 HH:MM”
  const dayBeforeYesterdayMatch = relativeStr.match(/前天\s*(\d{2}:\d{2})/);
  if (dayBeforeYesterdayMatch) {
    const [hours, minutes] = dayBeforeYesterdayMatch[1].split(':').map(Number);
    const time = new Date(beijingNow);
    time.setDate(beijingNow.getDate() - 2);
    time.setHours(hours, minutes, 0, 0);
    return formatDate(time);
  }

  // 4. 处理“HH:MM”（默认是今天）
  const todayMatch = relativeStr.match(/^(\d{2}:\d{2})$/);
  if (todayMatch) {
    const [hours, minutes] = todayMatch[1].split(':').map(Number);
    const time = new Date(beijingNow);
    time.setHours(hours, minutes, 0, 0);
    return formatDate(time);
  }

  // 5. 其他情况，直接返回原始字符串
  return relativeStr;
}

// 格式化日期为 "YYYY-MM-DD HH:mm"
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
// --- 新函数结束 ---
// 主函数
async function runSync() {
  let browser = null;
  let page = null;
  try {
    log('info', '🚀 启动抖音私信全量用户采集脚本（修复版：头像+抖音号+最近聊天时间）');
    log('info', `⏳ 脚本开始前等待 ${CONFIG.PRE_SCRIPT_WAIT / 1000} 秒...`);
    await new Promise(resolve => setTimeout(resolve, CONFIG.PRE_SCRIPT_WAIT));
    // 1. 环境变量校验（原有逻辑）
    const giteeToken = process.env.GITEE_TOKEN?.trim();
    const douyinCookies = process.env.DOUYIN_COOKIES?.trim();
    if (!giteeToken || !douyinCookies) {
      log('error', '❌ 缺少环境变量 GITEE_TOKEN 或 DOUYIN_COOKIES');
      process.exit(1);
    }
    // 2. 启动浏览器（原有逻辑）
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });
    // Cookie 处理（原有逻辑）
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
    // 3. 进入页面（原有逻辑）
    log('info', '🌐 进入抖音创作者私信页...');
    await page.goto(CONFIG.CREATOR_CHAT_URL, { waitUntil: 'domcontentloaded', timeout: CONFIG.GOTO_TIMEOUT });
    await page.waitForTimeout(15000);
    // 验证登录（原有逻辑）
    if (page.url().includes('login')) {
      log('error', '❌ Cookie已失效');
      process.exit(1);
    }
    // 等待列表加载（原有逻辑）
    log('info', '🔍 等待用户列表渲染...');
    await page.waitForSelector('.semi-list-item, [class*="name"]', { timeout: 60000 });
    // 4. 全量采集核心逻辑（修复抖音号提取+优化时间提取空值判断）
    log('info', '✅ 开始全量滚动采集（含最近聊天时间）');
    const scanResult = await page.evaluate(async (CONFIG) => {
      const allUsers = [];
      const processedIds = new Set(); // 用于去重 (优先用抖音号，没有则用昵称)
      const PROCESSED_ATTR = 'data-user-processed';
      let noNewUserCount = 0;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      // --- 移植自 sync_users.js 的核心辅助函数（原有逻辑）---
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
        // 优先查找 semi-design 的列表容器
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
        // 模拟键盘 PageDown 以触发懒加载
        container.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
        await sleep(1500);
        return container.scrollTop > startTop;
      }
      // --- 采集循环（核心修复：抖音号提取 + 时间提取空值优化）---
      try {
        const container = findScrollContainer();
        for (let attempt = 0; attempt < CONFIG.MAX_SCROLL_ATTEMPTS; attempt++) {
          // 查找所有昵称元素 (对应 HTML 中的 .item-header-name-vL_79m)
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
            // 找到当前行的父容器 (HTML中的 li.semi-list-item)
            const rowItem = nickEl.closest('.semi-list-item');
            // 1. 获取头像 (原有逻辑)
            let avatar = 'default.jpg';
            if (rowItem) {
              const imgEl = rowItem.querySelector('.semi-avatar img, img[src*="avatar"]');
              if (imgEl && imgEl.src) {
                avatar = imgEl.src;
                // 修复相对协议
                if (avatar.startsWith('//')) avatar = 'https:' + avatar;
              }
            }
            // ====== 提取最近聊天时间 (优化空值判断，防止报错) ======
            let lastChatTime = '未获取到';
            const timeEl = rowItem?.querySelector('[class^="item-header-time-"], [class*="time"]');
            if (timeEl && timeEl.textContent) { // 增加文本非空判断
              lastChatTime = timeEl.textContent.trim();
            }
            // =====================================
            // 滚动到该元素并点击（原有逻辑）
            nickEl.scrollIntoView({ block: "center" });
            await sleep(100);
            nickEl.click({ force: true });
            await sleep(1500); // 等待右侧聊天窗口加载
            // 2. 获取抖音号 (核心修复：match数组取值 + 空值判断)
            let douyinId = '未获取到';
            const hoverTarget = findHoverTarget(); // 查找 "查看Ta的主页"
            if (hoverTarget) {
              // 模拟完整的鼠标交互序列
              triggerMouseEvent(hoverTarget, 'mousemove');
              await sleep(50);
              triggerMouseEvent(hoverTarget, 'mouseenter');
              await sleep(50);
              triggerMouseEvent(hoverTarget, 'mouseover');
              // 循环检测弹窗内容
              for (let k = 0; k < 15; k++) {
                await sleep(150);
                const match = document.body.innerText.match(/抖音号\s*[:：]\s*([\w\.\-_]+)/);
                if (match && match[1]) { // 增加数组非空+捕获项存在判断
                  douyinId = match[1].trim(); // 取捕获组第1项再trim，修复核心报错
                  break;
                }
              }
              triggerMouseEvent(hoverTarget, 'mouseleave'); // 移开鼠标防止遮挡
            }
            // 存储数据 (去重，原有逻辑+新增lastChatTime字段)
            const uniqueKey = douyinId !== '未获取到' ? douyinId : `nick_${nickname}`;
            if (!processedIds.has(uniqueKey)) {
              processedIds.add(uniqueKey);
              allUsers.push({
                nickname: nickname,
                douyinId: douyinId,
                avatar: avatar,
                lastChatTime: lastChatTime // 存储原始时间（相对时间）
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
    log('info', `📝 采集完成，共获取 ${scanResult.count || 0} 个用户（含最近聊天时间）`);
    // --- 新增逻辑：将相对时间转换为 北京时间 ---
    log('info', '🕰️ 正在将相对时间转换为 北京时间...');
    const finalUsers = scanResult.allUsers.map(user => {
      // 调用新的转换函数
      const beijingTime = convertRelativeToBeijingTime(user.lastChatTime);
      return {
        ...user,
        lastChatTime: beijingTime
      };
    });
    // --- 转换结束 ---
    // 5. 保存与上传（使用转换后的新数据）
    const jsonStr = JSON.stringify(finalUsers, null, 2);
    fs.writeFileSync(CONFIG.LOCAL_USERS_JSON, jsonStr, 'utf8');
    log('info', '📤 同步到 Gitee...');
    const uploadRes = await uploadJsonToGitee(jsonStr, giteeToken);
    if (uploadRes) {
      log('success', '✅ 任务全部完成（用户数据+北京时间已同步至Gitee）');
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
