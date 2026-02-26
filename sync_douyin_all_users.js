const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
// 固定配置：全量用户JSON同步到Gitee同仓库根目录
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
// 日志函数（带时间戳+颜色）
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
// Gitee上传JSON文件（处理首次上传/更新冲突）
const uploadJsonToGitee = async (content, token) => {
  try {
    const base64Content = Buffer.from(content).toString('base64');
    // 获取文件sha（更新用，避免409冲突）
    const getRes = await axios.get(CONFIG.GITEE_JSON_URL, {
      params: { access_token: token },
      timeout: 20000
    });
    const sha = getRes.data.sha;
    // 上传更新
    await axios.put(CONFIG.GITEE_JSON_URL, {
      access_token: token,
      content: base64Content,
      message: 'update: 同步抖音私信全量用户数据（头像+抖音号+昵称）',
      sha: sha
    }, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
      timeout: 30000
    });
    return true;
  } catch (err) {
    // 首次上传（文件不存在，无sha）
    if (err.response?.status === 404) {
      const base64Content = Buffer.from(content).toString('base64');
      await axios.put(CONFIG.GITEE_JSON_URL, {
        access_token: token,
        content: base64Content,
        message: 'init: 初始化抖音私信全量用户JSON数据'
      }, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
        timeout: 30000
      });
      return true;
    }
    log('error', `❌ Gitee JSON上传失败: ${err.message}`);
    err.response && log('error', `   状态码: ${err.response.status}, 响应: ${JSON.stringify(err.response.data)}`);
    return false;
  }
};
// 主函数：全量采集私信所有用户
async function runSync() {
  let browser = null;
  let page = null;
  try {
    log('info', '🚀 启动抖音私信全量用户采集脚本（头像+抖音号+昵称）');
    log('info', `⏳ 脚本开始前等待 ${CONFIG.PRE_SCRIPT_WAIT / 1000} 秒，确保网页加载完成...`);
    await new Promise(resolve => setTimeout(resolve, CONFIG.PRE_SCRIPT_WAIT));
    log('info', '✅ 等待结束，开始执行任务');
    // 1. 环境变量校验
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
    // 2. 启动浏览器，注入Cookie
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
    // 隐藏浏览器指纹，绕过抖音反爬
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh'] });
      window.chrome = { runtime: {} };
    });
    // 解析并修复抖音Cookie格式【核心修复：sameSite强制兜底合法值】
    let parsedCookies;
    try {
      parsedCookies = JSON.parse(douyinCookies);
      log('info', `✅ 成功解析Cookie，共 ${parsedCookies.length} 条`);
    } catch (err) {
      log('error', '❌ DOUYIN_COOKIES格式错误，必须是标准JSON字符串');
      process.exit(1);
    }
    // 修复Cookie：强制sameSite为Strict/Lax/None，无则兜底Lax（彻底解决报错）
    const fixCookies = (rawCookies) => {
      return rawCookies.map(cookie => {
        // 核心修复：处理sameSite，仅保留3个合法值，无则设为Lax
        if (cookie.sameSite) {
          const ss = cookie.sameSite.toLowerCase().trim();
          cookie.sameSite = ss === 'strict' ? 'Strict' : ss === 'none' ? 'None' : 'Lax';
        } else {
          cookie.sameSite = 'Lax'; // 无sameSite字段，直接兜底合法值
        }
        // 删掉Playwright不识别的字段
        delete cookie.storeId;
        delete cookie.hostOnly;
        delete cookie.session;
        return cookie;
      });
    };
    const cleanCookies = fixCookies(parsedCookies);
    await context.addCookies(cleanCookies);
    log('success', '✅ Cookie注入完成');
    // 新建页面并监听错误
    page = await context.newPage();
    page.on('pageerror', err => log('error', `页面运行错误: ${err.message}`));
    log('success', '✅ 浏览器启动完成');
    // 3. 进入抖音创作者私信页，验证登录
    log('info', '🌐 正在进入抖音创作者中心私信页面...');
    await page.goto(CONFIG.CREATOR_CHAT_URL, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.GOTO_TIMEOUT
    });
    log('info', '⏳ 页面加载后等待20秒，确保内容渲染...');
    await page.waitForTimeout(20000);
    const currentUrl = page.url();
    log('info', `当前页面URL: ${currentUrl}`);
    // 验证Cookie是否有效（未登录/验证则退出）
    if (currentUrl.includes('login') || currentUrl.includes('passport') || currentUrl.includes('verify')) {
      log('error', '❌ Cookie已失效/触发人机验证，请重新获取抖音Cookie');
      process.exit(1);
    }
    // 等待用户列表元素渲染
    log('info', '🔍 等待用户列表元素出现...');
    await page.waitForSelector('span[class*="name"], div[class*="name"], [class*="user-item"]', {
      timeout: 60000,
      state: 'attached'
    });
    log('success', '✅ 页面加载完成，用户列表已渲染，初始化选中状态');
    // 4. 首元素点击（兜底，解决虚拟列表加载问题）
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      const scrollContainer = document.querySelector('.ReactVirtualized__Grid, [role="grid"], .semi-list-items') || document.scrollingElement;
      if (scrollContainer) scrollContainer.scrollTop = 0;
    });
    await page.waitForTimeout(800);
    const firstNicknameLocator = page.locator('span[class*="name"], div[class*="name"], [class*="user-item"] span').first();
    await firstNicknameLocator.waitFor({ state: 'attached', timeout: 30000 });
    await firstNicknameLocator.scrollIntoViewIfNeeded({ block: 'center' });
    await page.waitForTimeout(1000);
    await firstNicknameLocator.click({ force: true, timeout: 10000 });
    await page.waitForTimeout(2000);
    log('success', '✅ 初始化完成，开始全量滚动采集所有用户');
    // 5. 核心：全量滚动采集（提取所有用户的头像+抖音号+昵称）
    const scanResult = await page.evaluate(async (CONFIG) => {
      const allUsers = [];
      const processedDouyinIds = new Set();
      const PROCESSED_ATTR = 'data-user-processed';
      let noNewUserCount = 0;
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      // 触发鼠标事件（模拟人工）
      function triggerMouseEvent(element, eventType) {
        if (!element) return;
        const rect = element.getBoundingClientRect();
        element.dispatchEvent(new MouseEvent(eventType, {
          bubbles: true, cancelable: true, view: window,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
        }));
      }
      // 查找“查看Ta的主页”元素
      function findHoverTarget() {
        const elements = document.querySelectorAll('span, div');
        for (const el of elements) {
          if (el.textContent.trim() === '查看Ta的主页') return el;
        }
        return null;
      }
      // 查找私信列表滚动容器（适配抖音虚拟列表）
      function findScrollContainer() {
        let container = document.querySelector('.ReactVirtualized__Grid, [role="grid"], .semi-list-items');
        if (container) return container;
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
          const style = window.getComputedStyle(div);
          const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
          const hasUserItems = div.querySelector('[class*="name"], [class*="user"]');
          if (isScrollable && hasUserItems && div.scrollHeight > div.clientHeight + 100) return div;
        }
        return document.scrollingElement || document.documentElement;
      }
      // 滚动加载更多用户
      async function scrollDouyinList() {
        const container = findScrollContainer();
        const beforeScrollTop = container.scrollTop;
        const stepCount = CONFIG.SCROLL_TOTAL_STEP / CONFIG.SCROLL_STEP;
        for (let j = 0; j < stepCount; j++) {
          container.dispatchEvent(new WheelEvent('wheel', { deltaY: CONFIG.SCROLL_STEP, bubbles: true }));
          container.scrollTop += CONFIG.SCROLL_STEP;
          await sleep(50);
        }
        container.scrollTo({ top: container.scrollTop + CONFIG.SCROLL_TOTAL_STEP, behavior: 'smooth' });
        container.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
        await sleep(2000);
        const afterScrollTop = container.scrollTop;
        return Math.abs(afterScrollTop - beforeScrollTop) > 20;
      }
      // 开始全量遍历
      try {
        const container = findScrollContainer();
        for (let attempt = 0; attempt < CONFIG.MAX_SCROLL_ATTEMPTS; attempt++) {
          const allNameElements = Array.from(document.querySelectorAll(
            'span[class*="name"], div[class*="name"], span[data-testid*="nickname"], [class*="user-item"] span'
          ));
          const unprocessedElements = allNameElements.filter(el => {
            const nickname = el.textContent.trim();
            return nickname && !el.hasAttribute(PROCESSED_ATTR);
          });
          if (unprocessedElements.length === 0) {
            noNewUserCount++;
            const isScrolled = await scrollDouyinList();
            if (!isScrolled || noNewUserCount >= CONFIG.MAX_NO_NEW_USER_COUNT) {
              break;
            }
            continue;
          }
          noNewUserCount = 0;
          // 遍历处理每个未处理用户
          for (const el of unprocessedElements) {
            const nickname = el.textContent.trim();
            if (el.hasAttribute(PROCESSED_ATTR)) continue;
            el.scrollIntoView({ block: "center" });
            await sleep(100);
            el.click({ force: true });
            await sleep(1500);
            // 提取头像链接
            const avatarEl = el.closest('[class*="user-item"], div[class*="chat-item"], [class*="msg-item"]')
              ?.querySelector('img[class*="avatar"], div[class*="avatar"] img, [src*="avatar"]');
            const avatar = avatarEl ? avatarEl.src : '未获取到';
            // 提取抖音号
            let douyinId = '未获取到';
            const hoverTarget = findHoverTarget();
            if (hoverTarget) {
              triggerMouseEvent(hoverTarget, 'mouseenter');
              await sleep(100);
              // 多次尝试提取（避免渲染延迟）
              for (let i = 0; i < 20; i++) {
                await sleep(100);
                const match = document.body.innerText.match(/抖音号\s*[:：]\s*([\w\.\-_]+)/);
                if (match) {
                  douyinId = match[1].trim();
                  break;
                }
              }
              triggerMouseEvent(hoverTarget, 'mouseleave');
            }
            // 去重后加入列表
            if (!processedDouyinIds.has(douyinId) && douyinId !== '未获取到') {
              processedDouyinIds.add(douyinId);
              allUsers.push({ avatar, douyinId, nickname });
            } else if (douyinId === '未获取到') {
              const nickKey = `nick_${nickname}`;
              if (!processedDouyinIds.has(nickKey)) {
                processedDouyinIds.add(nickKey);
                allUsers.push({ avatar, douyinId, nickname });
              }
            }
            // 标记为已处理
            el.setAttribute(PROCESSED_ATTR, 'true');
            await sleep(300);
          }
          // 本页处理完，滚动加载下一页
          await scrollDouyinList();
        }
        return {
          success: true,
          allUsers,
          processedCount: allUsers.length
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          allUsers: [],
          processedCount: 0
        };
      }
    }, CONFIG);
    // 6. 结果处理：生成本地JSON + 同步到Gitee
    if (!scanResult.success) {
      log('error', `⚠️ 采集过程出现异常: ${scanResult.error}`);
    }
    const totalCount = scanResult.processedCount;
    log('info', `📝 全量采集完成，共获取 ${totalCount} 个抖音私信用户（已去重）`);
    // 生成格式化JSON
    const userJsonStr = JSON.stringify(scanResult.allUsers, null, 2);
    fs.writeFileSync(CONFIG.LOCAL_USERS_JSON, userJsonStr, 'utf8');
    log('success', `✅ 本地JSON文件生成完成: ${CONFIG.LOCAL_USERS_JSON}`);
    // 同步JSON到Gitee
    log('info', '📤 正在将全量用户JSON同步到Gitee...');
    const uploadSuccess = await uploadJsonToGitee(userJsonStr, giteeToken);
    if (uploadSuccess) {
      log('success', `✅ 全量用户数据已成功同步到Gitee: ${CONFIG.GITEE_JSON_URL}`);
    } else {
      log('error', '❌ Gitee同步失败，本地JSON文件已保留');
      process.exit(1);
    }
    log('success', '🏁 抖音私信全量用户采集+Gitee同步任务全部完成！');
  } catch (err) {
    log('error', `🚨 任务执行失败: ${err.message}`);
    log('error', '错误详情:', err.stack);
    process.exit(1);
  } finally {
    // 关闭浏览器
    if (browser) {
      await browser.close();
      log('info', '✅ 浏览器已关闭');
    }
  }
}
// 执行主函数
runSync();
