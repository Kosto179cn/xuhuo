const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 固定配置（无修改）
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

// 日志函数（日志时间也显示北京时间）
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

// Gitee上传JSON文件（无修改）
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
      message: sha ? 'update: 同步抖音私信用户(UTC转北京时间HH:MM)' : 'init: 初始化抖音私信用户(UTC转北京时间HH:MM)',
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

// 🔥 核心函数：UTC时间(HH:MM) → 北京时间(HH:MM)，仅显示时间，如6:16→14:16
function utcToBeijingTime(utcTimeStr) {
  // 只匹配HH:MM格式，其他格式（刚刚/小时前）直接返回
  const match = utcTimeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return utcTimeStr;

  let utcH = parseInt(match[1], 10);
  const utcM = parseInt(match[2], 10);

  // UTC+8小时得到北京时间，自动处理跨天（如UTC22:00→北京06:00）
  let bjH = utcH + 8;
  if (bjH >= 24) bjH -= 24;

  // 补零为两位，返回HH:MM
  return `${String(bjH).padStart(2, '0')}:${String(utcM).padStart(2, '0')}`;
}

// 主函数
async function runSync() {
  let browser = null;
  try {
    log('info', '🚀 启动抖音私信采集（UTC→北京时间HH:MM版）');
    log('info', `⏳ 前置等待 ${CONFIG.PRE_SCRIPT_WAIT / 1000} 秒...`);
    await new Promise(resolve => setTimeout(resolve, CONFIG.PRE_SCRIPT_WAIT));

    // 环境变量校验
    const giteeToken = process.env.GITEE_TOKEN?.trim();
    const douyinCookies = process.env.DOUYIN_COOKIES?.trim();
    if (!giteeToken || !douyinCookies) {
      log('error', '❌ 缺少环境变量 GITEE_TOKEN 或 DOUYIN_COOKIES');
      process.exit(1);
    }

    // 启动浏览器
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
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

    // 访问抖音创作者私信页
    log('info', '🌐 进入抖音创作者私信页...');
    await page.goto(CONFIG.CREATOR_CHAT_URL, { waitUntil: 'domcontentloaded', timeout: CONFIG.GOTO_TIMEOUT });
    await page.waitForTimeout(15000);

    // 验证Cookie有效性
    if (page.url().includes('login')) {
      log('error', '❌ Cookie已失效，请重新获取');
      process.exit(1);
    }

    // 等待用户列表加载
    log('info', '🔍 等待用户列表渲染...');
    await page.waitForSelector('.semi-list-item, [class*="name"]', { timeout: 60000 });

    // 核心采集逻辑（修复抖音号提取+空值判断）
    log('info', '✅ 开始滚动采集用户数据...');
    const scanResult = await page.evaluate(async (CONFIG) => {
      const allUsers = [];
      const processedIds = new Set();
      const PROCESSED_ATTR = 'data-user-processed';
      let noNewUserCount = 0;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      // 鼠标事件触发
      function triggerMouseEvent(element, eventType) {
        if (!element) return;
        const rect = element.getBoundingClientRect();
        element.dispatchEvent(new MouseEvent(eventType, {
          bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2
        }));
      }

      // 查找「查看Ta的主页」元素
      function findHoverTarget() {
        for (const el of document.querySelectorAll('span, div, a')) {
          if (el.textContent.trim() === '查看Ta的主页') return el;
        }
        return null;
      }

      // 查找滚动容器
      function findScrollContainer() {
        const semiContainer = document.querySelector('.semi-list, .semi-list-items');
        if (semiContainer) return semiContainer;
        for (const div of document.querySelectorAll('div')) {
          const style = getComputedStyle(div);
          if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && div.scrollHeight > div.clientHeight) {
            return div;
          }
        }
        return document.scrollingElement;
      }

      // 滚动列表触发懒加载
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

      // 采集循环
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
            if (!rowItem) continue;

            // 提取头像
            let avatar = 'default.jpg';
            const imgEl = rowItem.querySelector('.semi-avatar img, img[src*="avatar"]');
            if (imgEl && imgEl.src) {
              avatar = imgEl.src.startsWith('//') ? `https:${imgEl.src}` : imgEl.src;
            }

            // 提取原始UTC时间（页面显示的HH:MM）
            let lastChatTime = '未获取到';
            const timeEl = rowItem?.querySelector('[class^="item-header-time-"], [class*="time"]');
            if (timeEl && timeEl.textContent) {
              lastChatTime = timeEl.textContent.trim();
            }

            // 点击用户，加载右侧信息
            nickEl.scrollIntoView({ block: "center" });
            await sleep(100);
            nickEl.click({ force: true });
            await sleep(1500);

            // 提取抖音号（修复match.trim报错）
            let douyinId = '未获取到';
            const hoverTarget = findHoverTarget();
            if (hoverTarget) {
              triggerMouseEvent(hoverTarget, 'mouseenter');
              await sleep(100);
              for (let k = 0; k < 15; k++) {
                await sleep(150);
                const match = document.body.innerText.match(/抖音号\s*[:：]\s*([\w\.\-_]+)/);
                if (match && match[1]) {
                  douyinId = match[1].trim();
                  break;
                }
              }
              triggerMouseEvent(hoverTarget, 'mouseleave');
            }

            // 去重存储
            const uniqueKey = douyinId !== '未获取到' ? douyinId : `nick_${nickname}`;
            if (!processedIds.has(uniqueKey)) {
              processedIds.add(uniqueKey);
              allUsers.push({ nickname, douyinId, avatar, lastChatTime });
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

    // 采集异常处理
    if (!scanResult.success) {
      log('error', `⚠️ 采集失败: ${scanResult.error}`);
      process.exit(1);
    }
    log('info', `📝 采集完成，共获取 ${scanResult.count || 0} 个用户`);

    // 🔥 关键转换：UTC时间转北京时间（仅HH:MM）
    log('info', '🕰️ 转换UTC时间→北京时间（仅显示时:分）...');
    const finalUsers = scanResult.allUsers.map(user => ({
      ...user,
      lastChatTime: utcToBeijingTime(user.lastChatTime)
    }));

    // 保存本地+上传Gitee
    const jsonStr = JSON.stringify(finalUsers, null, 2);
    fs.writeFileSync(CONFIG.LOCAL_USERS_JSON, jsonStr, 'utf8');
    log('info', '📤 同步用户数据到Gitee...');
    const uploadRes = await uploadJsonToGitee(jsonStr, giteeToken);

    if (uploadRes) {
      log('success', '✅ 所有任务完成！时间已转为北京时间HH:MM格式');
    } else {
      log('error', '❌ Gitee同步失败');
      process.exit(1);
    }
  } catch (err) {
    log('error', `🚨 脚本致命错误: ${err.message}`);
    process.exit(1);
  } finally {
    // 关闭浏览器
    if (browser) await browser.close();
  }
}

// 执行脚本
runSync();
