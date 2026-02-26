const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 固定配置
const CONFIG = {
  GITEE_API_URL: 'https://gitee.com/api/v5/repos/Kosto179/kosto-battle-clicker-new/contents/douyinh.txt',
  LOCAL_USERS_FILE: 'users.txt',
  CREATOR_CHAT_URL: 'https://creator.douyin.com/creator-micro/data/following/chat',
  DOUYIN_HOME_URL: 'https://creator.douyin.com/',
  GOTO_TIMEOUT: 180000, // 超时时间加大到180秒，给足加载缓冲
  MAX_LOAD_RETRY: 2, // 页面加载失败自动重试2次
  MAX_SCROLL_ATTEMPTS: 200,
  SCROLL_STEP: 800,
  MAX_NO_NEW_USER_COUNT: 12,
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

// 页面加载重试函数（核心解决超时）
async function gotoWithRetry(page, url, options, maxRetry = CONFIG.MAX_LOAD_RETRY) {
  let lastError;
  for (let i = 0; i <= maxRetry; i++) {
    try {
      log('info', `🌐 第${i+1}次尝试加载页面: ${url}`);
      await page.goto(url, options);
      log('success', `✅ 页面加载成功: ${url}`);
      return true;
    } catch (err) {
      lastError = err;
      log('warn', `⚠️ 第${i+1}次页面加载失败: ${err.message}`);
      if (i < maxRetry) {
        log('info', `⏳ 等待5秒后重试...`);
        await page.waitForTimeout(5000);
      }
    }
  }
  throw lastError;
}

// 主函数
async function runSync() {
  let browser = null;
  let page = null;
  try {
    log('info', '🚀 启动抖音用户同步脚本（超时修复+滚动优化版）');
    log('info', `⏳ 脚本开始前等待 ${CONFIG.PRE_SCRIPT_WAIT / 1000} 秒，确保运行环境就绪...`);
    await new Promise(resolve => setTimeout(resolve, CONFIG.PRE_SCRIPT_WAIT));
    log('info', '✅ 等待结束，开始执行任务');

    // ========== 1. 环境变量校验 ==========
    log('info', '🔍 开始校验环境变量...');
    const giteeToken = process.env.GITEE_TOKEN?.trim();
    const douyinCookies = process.env.DOUYIN_COOKIES?.trim();
    if (!giteeToken) {
      log('error', '❌ 未读取到GITEE_TOKEN，请检查Secrets配置');
      process.exit(1);
    }
    if (!douyinCookies) {
      log('error', '❌ 未读取到DOUYIN_COOKIES，请检查Secrets配置');
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
    log('info', `【完整目标抖音号列表】: ${TARGET_DOUYIN_IDS.join(', ')}`);

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
        '--disable-renderer-backgrounding',
        // 【新增】加速页面加载，禁用无用资源
        '--disable-images',
        '--disable-fonts',
        '--disable-css-animations',
        '--disable-plugins',
        '--disable-extensions',
        '--disable-sync',
        '--disable-translate',
        '--no-first-run',
        '--no-default-browser-check'
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
      // 【新增】拦截图片/字体请求，大幅加快页面加载速度
      route: async (route) => {
        const request = route.request();
        const resourceType = request.resourceType();
        // 拦截图片、字体、媒体资源，只保留核心页面和脚本
        if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
          await route.abort();
        } else {
          await route.continue();
        }
      }
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
    page.on('console', msg => log('info', `[页面内日志] ${msg.text()}`));
    page.on('pageerror', err => log('error', `页面运行错误: ${err.message}`));
    log('success', '✅ 浏览器启动完成，页面日志转发已开启');

    // ========== 4. 页面加载（核心修复超时） ==========
    log('info', '🌐 先访问抖音创作者主页预热，降低风控概率...');
    // 先访问主页预热，再跳转到私信页，避免直接跳转被拦截
    await gotoWithRetry(page, CONFIG.DOUYIN_HOME_URL, {
      waitUntil: 'domcontentloaded', // 只等DOM渲染完成，不等待所有资源
      timeout: CONFIG.GOTO_TIMEOUT
    });
    await page.waitForTimeout(5000);

    log('info', '🌐 正在跳转到抖音创作者中心私信页面...');
    await gotoWithRetry(page, CONFIG.CREATOR_CHAT_URL, {
      waitUntil: 'domcontentloaded', // 放宽加载要求，核心解决超时
      timeout: CONFIG.GOTO_TIMEOUT
    });

    log('info', '⏳ 页面加载后等待15秒，确保列表完全渲染...');
    await page.waitForTimeout(15000);
    const currentUrl = page.url();
    log('info', `当前页面URL: ${currentUrl}`);
    if (currentUrl.includes('login') || currentUrl.includes('passport') || currentUrl.includes('verify')) {
      log('error', '❌ Cookie已失效/触发人机验证，请重新获取Cookie');
      process.exit(1);
    }

    // 优先切换到「全部私信」标签，确保在完整列表里
    log('info', '🔍 正在切换到「全部私信」标签...');
    await page.click('div[role="tab"]:has-text("全部私信")', { force: true }).catch(() => {
      log('warn', '⚠️ 未找到「全部私信」标签，使用当前列表');
    });
    await page.waitForTimeout(2000);

    log('info', '🔍 等待用户列表元素出现...');
    await page.waitForSelector('div[class*="conversation-item"], [class*="user-item"], span[class*="name"]', {
      timeout: 60000,
      state: 'attached'
    });
    log('success', '✅ 页面加载完成，用户列表已渲染，开始全量遍历扫描');

    // ================= 【核心：滚动+遍历逻辑】 =================
    const scanResult = await page.evaluate(async (params) => {
      const { CONFIG, TARGET_DOUYIN_IDS } = params;
      
      const results = [];
      const processedIds = new Set();
      const PROCESSED_ATTR = 'data-user-processed';
      let remainingTargets = [...TARGET_DOUYIN_IDS];
      let noNewUserCount = 0;

      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
        console.log('🔍 正在查找「查看Ta的主页」元素...');
        const elements = document.querySelectorAll('span, div, a');
        for (const el of elements) {
          const text = el.textContent.trim();
          if (text === '查看Ta的主页') {
            console.log('✅ 找到「查看Ta的主页」元素');
            return el;
          }
        }
        console.log('❌ 未找到「查看Ta的主页」元素');
        return null;
      }

      // 精准查找私信列表滚动容器
      function findScrollContainer() {
        console.log('🔍 正在查找私信列表滚动容器...');
        let container = document.querySelector('.conversation-list, .chat-list, [class*="message-list"], [class*="conversation-wrapper"]');
        if (container) {
          console.log('✅ 找到私信列表专属容器');
          return container;
        }

        container = document.querySelector('.ReactVirtualized__Grid, [role="grid"], .semi-list-items');
        if (container) {
          console.log('✅ 找到虚拟列表容器');
          return container;
        }

        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
          const style = window.getComputedStyle(div);
          const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
          const isTall = div.clientHeight > window.innerHeight * 0.6;
          const hasUserItems = div.querySelector('[class*="name"], [class*="user-item"], [class*="conversation-item"]');
          const isLongList = div.scrollHeight > div.clientHeight + 200;
          if (isScrollable && isTall && hasUserItems && isLongList) {
            console.log('✅ 找到通用可滚动容器');
            return div;
          }
        }

        console.log('⚠️ 使用页面根滚动兜底');
        return document.scrollingElement || document.documentElement;
      }

      // 重写滚动逻辑，确保触发虚拟列表加载
      async function scrollDouyinList(container) {
        const beforeScrollTop = container.scrollTop;
        const beforeScrollHeight = container.scrollHeight;
        console.log(`📜 执行滚动，当前位置: ${beforeScrollTop}, 列表总高度: ${beforeScrollHeight}`);

        container.scrollTop = container.scrollHeight - container.clientHeight - 200;
        await sleep(100);

        container.dispatchEvent(new WheelEvent('wheel', {
          deltaY: CONFIG.SCROLL_STEP,
          bubbles: true,
          cancelable: true,
          composed: true
        }));

        container.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'PageDown', code: 'PageDown', keyCode: 34, which: 34, bubbles: true
        }));

        await sleep(2500);
        const afterScrollTop = container.scrollTop;
        const afterScrollHeight = container.scrollHeight;
        console.log(`📜 滚动完成，新位置: ${afterScrollTop}, 新列表高度: ${afterScrollHeight}`);
        
        return afterScrollHeight > beforeScrollHeight || Math.abs(afterScrollTop - beforeScrollTop) > 100;
      }

      try {
        const container = findScrollContainer();
        console.log(`✅ 锁定最终滚动容器，容器高度: ${container.scrollHeight}`);

        for (let attempt = 0; attempt < CONFIG.MAX_SCROLL_ATTEMPTS; attempt++) {
          console.log(`\n========== 第 ${attempt + 1} 轮遍历开始 ==========`);
          console.log(`📊 当前进度：已处理 ${processedIds.size} 个用户 | 剩余目标 ${remainingTargets.length} 个`);
          
          const allUserItems = Array.from(document.querySelectorAll(
            'div[class*="conversation-item"], [class*="user-item"], [class*="message-item"]'
          ));
          console.log(`📝 当前页面共找到 ${allUserItems.length} 个用户条目`);
          
          const unprocessedItems = allUserItems.filter(item => {
            const nameEl = item.querySelector('span[class*="name"], div[class*="name"], span[data-testid*="nickname"]');
            const nickname = nameEl?.textContent?.trim();
            const itemId = item.getAttribute('data-id') || item.getAttribute('data-conversation-id') || nickname;
            return nickname && nickname.length > 1 && itemId && !processedIds.has(itemId) && !item.hasAttribute(PROCESSED_ATTR);
          });

          console.log(`📝 当前页未处理用户数量: ${unprocessedItems.length}`);

          const currentPageNicknames = unprocessedItems.map(item => {
            const nameEl = item.querySelector('span[class*="name"], div[class*="name"]');
            return nameEl?.textContent?.trim() || '未知昵称';
          });
          console.log(`📋 当前页未处理用户昵称: ${currentPageNicknames.join(' | ')}`);

          if (unprocessedItems.length === 0) {
            console.log("⚠️ 当前页无未处理用户，执行滚动加载更多");
            noNewUserCount++;
            
            const hasNewContent = await scrollDouyinList(container);
            if (!hasNewContent || noNewUserCount >= CONFIG.MAX_NO_NEW_USER_COUNT) {
              console.log("🚫 已无法加载新内容，列表已到底部，停止遍历");
              break;
            }
            continue;
          }

          noNewUserCount = 0;

          for (const item of unprocessedItems) {
            const nameEl = item.querySelector('span[class*="name"], div[class*="name"]');
            const nickname = nameEl?.textContent?.trim();
            const itemId = item.getAttribute('data-id') || item.getAttribute('data-conversation-id') || nickname;
            
            if (!nickname || processedIds.has(itemId) || item.hasAttribute(PROCESSED_ATTR)) continue;

            console.log(`\n👤 开始处理用户: ${nickname}`);
            item.scrollIntoView({ block: "center", behavior: "auto" });
            await sleep(100);
            item.click({ force: true });
            await sleep(2000);

            const hoverTarget = findHoverTarget();
            let dyId = null;
            if (hoverTarget) {
              console.log('🔥 触发「查看Ta的主页」弹窗...');
              hoverTarget.scrollIntoView({ block: "center" });
              triggerMouseEvent(hoverTarget, 'mousemove');
              await sleep(100);
              triggerMouseEvent(hoverTarget, 'mouseenter');
              triggerMouseEvent(hoverTarget, 'mouseover');

              console.log('⏳ 开始循环提取抖音号...');
              for (let i = 0; i < 30; i++) {
                await sleep(100);
                const match = document.body.innerText.match(/抖音号\s*[:：]\s*([\w\.\-_]+)/);
                if (match) {
                  dyId = match[1].trim();
                  console.log(`✅ 第 ${i + 1} 次尝试成功，提取到抖音号: ${dyId}`);
                  break;
                }
                console.log(`⏳ 第 ${i + 1} 次尝试未提取到抖音号`);
              }
              triggerMouseEvent(hoverTarget, 'mouseleave');
            }

            processedIds.add(itemId);
            item.setAttribute(PROCESSED_ATTR, 'true');
            console.log(`✅ 完成用户处理: ${nickname} | 最终提取抖音号: ${dyId || '未提取到'}`);

            const isTargetId = dyId && TARGET_DOUYIN_IDS.includes(dyId);
            const isTargetNickname = TARGET_DOUYIN_IDS.some(id => id.includes(nickname) || nickname.includes(id));
            console.log(`🔍 目标匹配检查：抖音号是否命中 ${isTargetId ? '是' : '否'} | 昵称是否命中 ${isTargetNickname ? '是' : '否'}`);

            if (isTargetId && remainingTargets.includes(dyId)) {
              console.log(`🎯 成功命中目标用户！抖音号: ${dyId} | 昵称: ${nickname}`);
              results.push({ id: dyId, nickname: nickname });
              remainingTargets = remainingTargets.filter(id => id !== dyId);
              console.log(`📊 剩余未命中目标: ${remainingTargets.join(', ')}`);
            }

            if (remainingTargets.length === 0) {
              console.log("🎉 所有目标抖音号已全部找到，提前结束遍历");
              break;
            }
            await sleep(300);
          }

          if (remainingTargets.length === 0) break;

          console.log("📥 当前页所有用户处理完毕，滚动加载下一页");
          await scrollDouyinList(container);
        }

        console.log("\n================ 🏁 遍历最终结果 ================");
        console.log(`✅ 总处理用户数: ${processedIds.size}`);
        console.log(`🎯 成功命中目标数: ${results.length}`);
        console.log(`❌ 未命中目标数: ${remainingTargets.length}`);
        if (remainingTargets.length > 0) {
          console.log(`⚠️ 未找到的目标抖音号: ${remainingTargets.join(', ')}`);
        }

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
          processedCount: processedIds.size,
          allProcessedNicknames: Array.from(processedIds)
        };

      } catch (error) {
        console.error("💥 遍历过程出错:", error);
        return {
          success: false,
          error: error.message,
          content: TARGET_DOUYIN_IDS.join('\n').trim(),
          remainingTargets: TARGET_DOUYIN_IDS,
          processedCount: processedIds.size,
          allProcessedNicknames: Array.from(processedIds)
        };
      }
    }, { CONFIG, TARGET_DOUYIN_IDS });

    // ========== 5. 结果处理 ==========
    log('info', `📝 遍历完成，共扫描处理 ${scanResult.processedCount || 0} 个用户`);
    log('info', `📋 所有已处理的用户标识: ${scanResult.allProcessedNicknames?.join(' | ') || '无'}`);
    
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
