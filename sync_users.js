const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 固定配置
const CONFIG = {
  GITEE_API_URL: 'https://gitee.com/api/v5/repos/Kosto179/kosto-battle-clicker-new/contents/douyinh.txt',
  LOCAL_USERS_FILE: 'users.txt',
  CREATOR_CHAT_URL: 'https://creator.douyin.com/creator-micro/data/following/chat',
  GOTO_TIMEOUT: 120000,
  MAX_SCROLL_ATTEMPTS: 200,
  SCROLL_TOTAL_STEP: 600,
  SCROLL_STEP: 100,
  MAX_NO_NEW_USER_COUNT: 15,
  PRE_SCRIPT_WAIT: 30000
};

// 日志函数（增强版，带时间戳和颜色）
const log = (level, msg, ...args) => {
  const timestamp = new Date().toLocaleTimeString();
  const colors = {
    info: '\x1b[36m',    // 青色
    success: '\x1b[32m', // 绿色
    warn: '\x1b[33m',    // 黄色
    error: '\x1b[31m'    // 红色
  };
  const reset = '\x1b[0m';
  const color = colors[level] || colors.info;
  console.log(`[${timestamp}] ${color}[${level.toUpperCase()}]${reset} ${msg}`, ...args);
};

// 主函数
async function runSync() {
  let browser = null;
  let page = null;
  try {
    log('info', '🚀 启动抖音用户同步脚本（弹窗触发+全量日志版）');
    log('info', `⏳ 脚本开始前等待 ${CONFIG.PRE_SCRIPT_WAIT / 1000} 秒，确保网页加载完成...`);
    await new Promise(resolve => setTimeout(resolve, CONFIG.PRE_SCRIPT_WAIT));
    log('info', '✅ 等待结束，开始执行任务');

    // ========== 1. 环境变量校验 ==========
    log('info', '🔍 开始校验环境变量...');
    const giteeToken = process.env.GITEE_TOKEN?.trim();
    const douyinCookies = process.env.DOUYIN_COOKIES?.trim();
    if (!giteeToken) {
      log('error', '❌ 未读取到GITEE_TOKEN，请检查GitHub Secrets配置');
      process.exit(1);
    }
    if (!douyinCookies) {
      log('error', '❌ 未读取到DOUYIN_COOKIES，请检查GitHub Secrets配置');
      process.exit(1);
    }
    log('success', `✅ 环境变量读取完成，Gitee Token长度: ${giteeToken.length}`);

    // ========== 2. 从Gitee拉取目标抖音号列表 ==========
    log('info', '📥 正在从Gitee拉取目标抖音号列表...');
    const giteeRes = await axios.get(CONFIG.GITEE_API_URL, {
      params: { access_token: giteeToken },
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
      timeout: 30000
    }).catch(err => {
      if (err.response) {
        log('error', `❌ Gitee API请求失败，状态码: ${err.response.status}`);
        err.response.status === 401 && log('error', '   原因：Gitee Token无效或无仓库权限');
        err.response.status === 404 && log('error', '   原因：仓库/文件路径不存在');
      } else {
        log('error', `❌ Gitee API网络请求失败: ${err.message}`);
      }
      process.exit(1);
    });

    const rawFileContent = Buffer.from(giteeRes.data.content, 'base64').toString();
    const TARGET_DOUYIN_IDS = rawFileContent.split('\n')
      .map(id => id.trim())
      .filter(id => id && !id.startsWith('#'));

    if (TARGET_DOUYIN_IDS.length === 0) {
      log('error', '❌ 从Gitee拉取的抖音号列表为空');
      process.exit(1);
    }
    log('success', `✅ 成功拉取到${TARGET_DOUYIN_IDS.length}个目标抖音号`);
    log('info', `目标抖音号列表: ${TARGET_DOUYIN_IDS.join(', ')}`);

    // ========== 3. 启动浏览器，注入Cookie ==========
    log('info', '🌐 正在启动无头浏览器...');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh'] });
      window.chrome = { runtime: {} };
    });

    let parsedCookies;
    try {
      parsedCookies = JSON.parse(douyinCookies);
      log('info', `✅ 成功解析Cookie，共 ${parsedCookies.length} 条`);
    } catch (err) {
      log('error', '❌ DOUYIN_COOKIES格式错误，必须是标准JSON字符串');
      process.exit(1);
    }

    const fixCookies = (rawCookies) => {
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
    };
    const cleanCookies = fixCookies(parsedCookies);
    await context.addCookies(cleanCookies);
    log('success', '✅ Cookie注入完成');

    page = await context.newPage();
    page.on('pageerror', err => log('error', `页面运行错误: ${err.message}`));
    page.on('request', req => log('info', `→ 发送请求: ${req.url()}`));
    page.on('requestfailed', req => log('warn', `✗ 请求失败: ${req.url()} - ${req.failure()?.errorText}`));
    page.on('response', res => {
      if (res.status() >= 400) {
        log('warn', `← 响应异常: ${res.url()} - ${res.status()}`);
      } else {
        log('info', `← 收到响应: ${res.url()} - ${res.status()}`);
      }
    });
    log('success', '✅ 浏览器启动完成');

    // ========== 4. 页面加载 ==========
    log('info', '🌐 正在进入抖音创作者中心私信页面...');
    await page.goto(CONFIG.CREATOR_CHAT_URL, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.GOTO_TIMEOUT
    });

    log('info', '⏳ 页面加载后等待10秒，确保内容渲染...');
    await page.waitForTimeout(10000);
    const currentUrl = page.url();
    log('info', `当前页面URL: ${currentUrl}`);
    if (currentUrl.includes('login') || currentUrl.includes('passport') || currentUrl.includes('verify')) {
      log('error', '❌ Cookie已失效/触发人机验证，请重新获取Cookie');
      process.exit(1);
    }

    log('info', '🔍 等待用户列表元素出现...');
    await page.waitForSelector('span[class*="name"], div[class*="name"], [class*="user-item"]', {
      timeout: 60000,
      state: 'attached'
    });
    log('success', '✅ 页面加载完成，用户列表已渲染，开始全量遍历扫描');

    // ================= 【核心修复：强制触发弹窗+全量日志】 =================
    const scanResult = await page.evaluate(async (params) => {
      const { CONFIG, TARGET_DOUYIN_IDS } = params;
      
      const results = [];
      const processedNicknames = new Set();
      const PROCESSED_ATTR = 'data-user-processed';
      let remainingTargets = [...TARGET_DOUYIN_IDS];
      let noNewUserCount = 0;

      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      // 强制触发“查看Ta的主页”弹窗
      const findAndTriggerProfilePopup = () => {
        console.log('🔍 正在查找“查看Ta的主页”元素...');
        let profileEl = null;
        const allElements = document.querySelectorAll('span, div, a, button');
        
        for (const el of allElements) {
          const text = el.textContent.trim().toLowerCase();
          if (text.includes('查看ta的主页') || text.includes('查看主页') || text.includes('profile')) {
            profileEl = el;
            console.log('✅ 找到“查看Ta的主页”元素:', el);
            break;
          }
        }
        
        if (!profileEl) {
          console.log('❌ 未找到“查看Ta的主页”元素');
          return null;
        }

        // 强制触发所有能唤起弹窗的事件
        console.log('🔥 强制触发弹窗事件...');
        profileEl.click();
        profileEl.focus();
        profileEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        profileEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        profileEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        
        return profileEl;
      };

      function findScrollContainer() {
        let container = document.querySelector('.ReactVirtualized__Grid, [role="grid"], .semi-list-items');
        if (container) return container;

        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
          const style = window.getComputedStyle(div);
          const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
          const isTall = div.clientHeight > window.innerHeight * 0.6;
          const hasUserItems = div.querySelector('[class*="name"], [class*="user"], [class*="message"]');
          const isLongList = div.scrollHeight > div.clientHeight + 100;
          if (isScrollable && isTall && hasUserItems && isLongList) {
            return div;
          }
        }

        return document.scrollingElement || document.documentElement;
      }

      async function scrollDouyinList() {
        const container = findScrollContainer();
        const beforeScrollTop = container.scrollTop;
        console.log(`📜 执行滚动，当前滚动位置: ${beforeScrollTop}, 容器总高度: ${container.scrollHeight}`);

        const stepCount = CONFIG.SCROLL_TOTAL_STEP / CONFIG.SCROLL_STEP;
        for (let j = 0; j < stepCount; j++) {
          container.dispatchEvent(new WheelEvent('wheel', {
            deltaY: CONFIG.SCROLL_STEP,
            bubbles: true,
            cancelable: true,
            composed: true
          }));
          container.scrollTop += CONFIG.SCROLL_STEP;
          await sleep(50);
        }

        container.scrollTo({ top: container.scrollTop + CONFIG.SCROLL_TOTAL_STEP, behavior: 'smooth' });
        container.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'PageDown', code: 'PageDown', keyCode: 34, which: 34, bubbles: true
        }));

        await sleep(2000);
        const afterScrollTop = container.scrollTop;
        console.log(`📜 滚动完成，新滚动位置: ${afterScrollTop}, 滚动距离: ${afterScrollTop - beforeScrollTop}`);
        
        return Math.abs(afterScrollTop - beforeScrollTop) > 20;
      }

      try {
        const container = findScrollContainer();
        console.log(`✅ 锁定滚动容器，容器高度: ${container.scrollHeight}`);

        for (let attempt = 0; attempt < CONFIG.MAX_SCROLL_ATTEMPTS; attempt++) {
          console.log(`\n🔄 第 ${attempt + 1} 轮遍历 | 已处理: ${processedNicknames.size} | 剩余目标: ${remainingTargets.length}`);
          
          const allNameElements = Array.from(document.querySelectorAll(
            'span[class*="name"], div[class*="name"], span[data-testid*="nickname"], div[data-testid*="user-name"], [class*="user-item"] span'
          ));
          
          const unprocessedElements = allNameElements.filter(el => {
            const nickname = el.textContent.trim();
            return nickname && nickname.length > 1 && !processedNicknames.has(nickname) && !el.hasAttribute(PROCESSED_ATTR);
          });

          console.log(`📝 当前页找到 ${unprocessedElements.length} 个未处理用户`);

          if (unprocessedElements.length === 0) {
            console.log("⚠️ 当前页无未处理用户，执行滚动加载更多");
            noNewUserCount++;
            
            const isScrolled = await scrollDouyinList();
            if (!isScrolled || noNewUserCount >= CONFIG.MAX_NO_NEW_USER_COUNT) {
              console.log("🚫 已无法滚动到新内容，列表已到底部，停止遍历");
              break;
            }
            continue;
          }

          noNewUserCount = 0;

          for (const el of unprocessedElements) {
            const nickname = el.textContent.trim();
            if (processedNicknames.has(nickname) || el.hasAttribute(PROCESSED_ATTR)) continue;

            console.log(`👤 正在查看用户: ${nickname}`);
            el.scrollIntoView({ block: "center", behavior: "auto" });
            await sleep(100);
            el.click({ force: true });
            await sleep(1500);

            // 强制触发弹窗并提取抖音号
            const profileEl = findAndTriggerProfilePopup();
            let dyId = null;
            if (profileEl) {
              console.log('⏳ 等待弹窗出现并提取抖音号...');
              for (let i = 0; i < 40; i++) {
                await sleep(100);
                const text = document.body.innerText;
                const match = text.match(/抖音号\s*[:：]\s*([\w\.\-_]+)/i);
                if (match) {
                  dyId = match[1].trim();
                  console.log(`✅ 成功提取抖音号: ${dyId}`);
                  break;
                }
                console.log(`⏳ 第 ${i + 1} 次尝试提取抖音号...`);
              }
            }

            processedNicknames.add(nickname);
            el.setAttribute(PROCESSED_ATTR, 'true');
            console.log(`✅ 已标记用户: ${nickname} | 提取抖音号: ${dyId || '未提取到'}`);

            if (dyId && TARGET_DOUYIN_IDS.includes(dyId) && remainingTargets.includes(dyId)) {
              console.log(`🎯 命中目标: ${dyId} | 昵称: ${nickname}`);
              results.push({ id: dyId, nickname: nickname });
              remainingTargets = remainingTargets.filter(id => id !== dyId);
            }

            if (remainingTargets.length === 0) {
              console.log("🎉 所有目标抖音号已找到，提前结束遍历");
              break;
            }
            await sleep(300);
          }

          if (remainingTargets.length === 0) break;

          console.log("📥 当前页所有用户处理完毕，滚动加载更多");
          await scrollDouyinList();
        }

        console.log("\n================ 🏁 遍历最终结果 ================");
        let content = "";
        TARGET_DOUYIN_IDS.forEach(id => {
          const res = results.find(r => r.id === id);
          content += res ? `${res.nickname}\n` : `${id}\n`;
        });

        return {
          success: true,
          results,
          content: content.trim(),
          remainingTargets,
          processedCount: processedNicknames.size
        };

      } catch (error) {
        console.error("💥 遍历过程出错:", error);
        return {
          success: false,
          error: error.message,
          content: TARGET_DOUYIN_IDS.join('\n').trim(),
          remainingTargets,
          processedCount: processedNicknames.size
        };
      }
    }, { CONFIG, TARGET_DOUYIN_IDS });

    // ========== 5. 结果处理 ==========
    log('info', `📝 遍历完成，共扫描处理 ${scanResult.processedCount || 0} 个用户`);
    if (!scanResult.success && scanResult.error) {
      log('warn', `⚠️ 遍历过程出现异常: ${scanResult.error}`);
    }

    fs.writeFileSync(CONFIG.LOCAL_USERS_FILE, scanResult.content, 'utf8');
    log('success', `✅ ${CONFIG.LOCAL_USERS_FILE} 文件已成功生成/更新`);
    log('info', `🏁 任务全部完成，成功匹配 ${scanResult.results?.length || 0}/${TARGET_DOUYIN_IDS.length} 个目标抖音号`);

    if (scanResult.remainingTargets?.length > 0) {
      log('warn', `⚠️ 未找到的目标抖音号: ${scanResult.remainingTargets.join(', ')}`);
    }

  } catch (err) {
    log('error', `🚨 任务执行失败: ${err.message}`);
    log('error', '错误详情:', err.stack);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
      log('info', '✅ 浏览器已关闭，脚本执行完毕');
    }
  }
}

runSync();
