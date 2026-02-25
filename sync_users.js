const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');

// 固定配置
const CONFIG = {
  GITEE_API_URL: 'https://gitee.com/api/v5/repos/Kosto179/kosto-battle-clicker-new/contents/douyinh.txt',
  LOCAL_USERS_FILE: 'users.txt',
  CREATOR_CHAT_URL: 'https://creator.douyin.com/creator-micro/data/following/chat',
  GOTO_TIMEOUT: 120000,
  // 一屏滚动高度（适配屏幕，不会跳用户）
  SCROLL_STEP: 600,
  // 滚动到底部/顶部的最大重试次数
  MAX_SCROLL_RETRY: 8,
  // 每屏渲染等待时间（给React足够时间渲染全量用户）
  RENDER_WAIT_TIME: 2500
};

// 日志函数
const log = (level, msg, ...args) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`, ...args);

// 主函数
async function runSync() {
  let browser = null;
  let page = null;
  try {
    log('info', '🚀 启动抖音用户全量同步脚本（不漏扫最终版）');

    // ========== 1. 环境变量校验 ==========
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
    log('info', '📥 正在从Gitee拉取目标抖音号列表');
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

    // ========== 3. 启动浏览器，注入Cookie ==========
    log('info', '🌐 正在启动无头浏览器');
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

    // 反爬配置
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh'] });
      window.chrome = { runtime: {} };
    });

    // Cookie处理（复用index.js稳定逻辑）
    let parsedCookies;
    try {
      parsedCookies = JSON.parse(douyinCookies);
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

    page = await context.newPage();
    page.on('pageerror', err => log('error', `页面运行错误: ${err.message}`));
    log('success', '✅ 浏览器启动完成，Cookie已注入');

    // ========== 4. 页面加载 ==========
    log('info', '🌐 正在进入抖音创作者中心私信页面，等待页面加载...');
    await page.goto(CONFIG.CREATOR_CHAT_URL, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.GOTO_TIMEOUT
    });

    // 等待页面全量渲染+登录态校验
    await page.waitForTimeout(10000);
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('passport') || currentUrl.includes('verify')) {
      log('error', '❌ Cookie已失效/触发人机验证，请重新获取Cookie');
      process.exit(1);
    }

    // 等待用户列表核心容器渲染完成
    await page.waitForSelector('.ReactVirtualized__Grid, [role="grid"], [class*="user-list"], [class*="message-list"]', {
      timeout: 60000,
      state: 'attached'
    });
    log('success', '✅ 页面加载完成，用户列表已渲染，开始全量遍历');

    // ================= 【核心：全量不漏扫遍历逻辑】 =================
    const scanResult = await page.evaluate(async (params) => {
      const { CONFIG, TARGET_DOUYIN_IDS } = params;
      
      // 结果存储
      const results = [];
      // 已处理用户标记（双重防重复）
      const processedNicknames = new Set();
      const PROCESSED_ATTR = 'data-user-processed';
      // 剩余待匹配目标
      let remainingTargets = [...TARGET_DOUYIN_IDS];

      // 工具函数
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      
      // 模拟鼠标事件
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

      // 查找“查看Ta的主页”元素（全量兼容）
      function findHoverTarget() {
        const elements = document.querySelectorAll('span, div, a');
        for (const el of elements) {
          const text = el.textContent.trim();
          if (text.includes('查看Ta的主页') || text === '查看主页') {
            return el;
          }
        }
        return null;
      }

      // ✅ 【核心修复1：精准锁定私信列表滚动容器，绝对不滚错】
      function findScrollContainer() {
        // 优先级1：React虚拟列表标准容器（99%匹配）
        let container = document.querySelector('.ReactVirtualized__Grid, [role="grid"], [data-testid="message-list"], [class*="chat-list"]');
        if (container) {
          console.log("✅ 锁定标准私信列表容器");
          return container;
        }

        // 优先级2：精准匹配左侧私信列表（排除聊天窗口滚动条）
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
          const style = window.getComputedStyle(div);
          const rect = div.getBoundingClientRect();
          // 核心判断：左侧列表、可滚动、高度足够、包含用户元素、宽度不超过屏幕一半
          const isLeftList = rect.left < window.innerWidth * 0.4;
          const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
          const isTall = rect.height > window.innerHeight * 0.6;
          const hasUserItems = div.querySelector('[class*="name"], [class*="user-item"], [class*="avatar"]');
          const isLongList = div.scrollHeight > div.clientHeight + 200;

          if (isLeftList && isScrollable && isTall && hasUserItems && isLongList) {
            console.log("✅ 锁定左侧私信列表容器");
            return div;
          }
        }

        // 兜底：页面根滚动
        console.warn("⚠️ 使用页面根滚动容器");
        return document.scrollingElement || document.documentElement;
      }

      // ✅ 【核心修复2：全量昵称元素抓取，不漏任何一个用户】
      function getAllUserElements() {
        // 全量匹配所有可能的昵称元素，排除页面其他无关元素
        return Array.from(document.querySelectorAll(
          'span, div, p'
        )).filter(el => {
          const text = el.textContent.trim();
          const rect = el.getBoundingClientRect();
          // 过滤规则：非空、长度合理、在左侧列表内、不是按钮/标题/抖音号文本
          const isValidText = text && text.length > 1 && text.length < 30;
          const isInLeftList = rect.left < window.innerWidth * 0.4;
          const isInViewport = rect.top > 0 && rect.bottom < window.innerHeight;
          const isNotInvalidText = !text.includes('抖音号') && !text.includes('私信') && !text.includes('已读') && !text.includes('今天');
          
          return isValidText && isInLeftList && isInViewport && isNotInvalidText;
        });
      }

      // ✅ 【核心修复3：正反向通用滚动逻辑，100%触发React渲染】
      async function scrollList(direction = 'down') {
        const container = findScrollContainer();
        const step = direction === 'down' ? CONFIG.SCROLL_STEP : -CONFIG.SCROLL_STEP;
        const beforeScrollTop = container.scrollTop;
        console.log(`📜 执行${direction === 'down' ? '向下' : '向上'}滚动，当前位置: ${beforeScrollTop}, 容器总高度: ${container.scrollHeight}`);

        // 三重触发滚动，确保React虚拟列表加载新内容
        // 1. 模拟真人滚轮（核心，触发React onWheel事件）
        const stepCount = Math.abs(step) / 100;
        for (let j = 0; j < stepCount; j++) {
          container.dispatchEvent(new WheelEvent('wheel', {
            deltaY: direction === 'down' ? 100 : -100,
            bubbles: true,
            cancelable: true,
            composed: true
          }));
          container.scrollTop += direction === 'down' ? 100 : -100;
          await sleep(50);
        }

        // 2. 强制scrollTo兜底
        container.scrollTo({ top: container.scrollTop + step, behavior: 'smooth' });

        // 3. 键盘事件兜底
        container.dispatchEvent(new KeyboardEvent('keydown', {
          key: direction === 'down' ? 'PageDown' : 'PageUp',
          code: direction === 'down' ? 'PageDown' : 'PageUp',
          keyCode: direction === 'down' ? 34 : 33,
          which: direction === 'down' ? 34 : 33,
          bubbles: true
        }));

        // 固定等待，确保React全量渲染新用户
        await sleep(CONFIG.RENDER_WAIT_TIME);
        const afterScrollTop = container.scrollTop;
        const scrollDistance = Math.abs(afterScrollTop - beforeScrollTop);
        console.log(`📜 滚动完成，新位置: ${afterScrollTop}，有效滚动距离: ${scrollDistance}`);
        
        return {
          isScrolled: scrollDistance > 50,
          isEnd: direction === 'down' 
            ? Math.abs(container.scrollHeight - container.scrollTop - container.clientHeight) < 100
            : container.scrollTop < 100
        };
      }

      // ✅ 【核心修复4：单个用户全流程处理，稳定提取抖音号】
      async function processUser(el) {
        const nickname = el.textContent.trim();
        // 已处理过的直接跳过
        if (processedNicknames.has(nickname) || el.hasAttribute(PROCESSED_ATTR)) {
          return { skip: true, dyId: null };
        }

        console.log(`👤 正在处理用户: ${nickname}`);
        try {
          // 1. 滚动到用户并强制点击，避免遮挡
          el.scrollIntoView({ block: 'center', behavior: 'auto' });
          await sleep(200);
          el.click({ force: true });
          await sleep(2000); // 等待聊天窗口完全加载

          // 2. 查找主页入口，提取抖音号
          const hoverTarget = findHoverTarget();
          let dyId = null;
          if (hoverTarget) {
            hoverTarget.scrollIntoView({ block: 'center' });
            triggerMouseEvent(hoverTarget, 'mousemove');
            await sleep(100);
            triggerMouseEvent(hoverTarget, 'mouseenter');
            triggerMouseEvent(hoverTarget, 'mouseover');

            // 30次循环重试，确保提取到抖音号
            for (let i = 0; i < 30; i++) {
              await sleep(100);
              const match = document.body.innerText.match(/抖音号\s*[:：]\s*([\w\.\-_]+)/i);
              if (match) {
                dyId = match[1].trim();
                break;
              }
            }
            triggerMouseEvent(hoverTarget, 'mouseleave');
          }

          // 3. 双重标记为已处理，永久跳过
          processedNicknames.add(nickname);
          el.setAttribute(PROCESSED_ATTR, 'true');
          console.log(`✅ 处理完成: ${nickname} | 提取抖音号: ${dyId || '未提取到'}`);

          // 4. 匹配目标抖音号
          if (dyId && TARGET_DOUYIN_IDS.includes(dyId) && remainingTargets.includes(dyId)) {
            console.log(`%c🎯 命中目标: ${dyId} | 昵称: ${nickname}`, "color: #4CAF50; font-weight: bold;");
            results.push({ id: dyId, nickname: nickname });
            remainingTargets = remainingTargets.filter(id => id !== dyId);
          }

          await sleep(400); // 操作间隔，防反爬
          return { skip: false, dyId };
        } catch (e) {
          // 出错也标记为已处理，避免卡死循环
          processedNicknames.add(nickname);
          el.setAttribute(PROCESSED_ATTR, 'true');
          console.warn(`⚠️ 用户 ${nickname} 处理失败，已标记跳过`, e.message);
          return { skip: true, dyId: null };
        }
      }

      // ✅ 【核心修复5：整屏扫完再滚动，绝对不漏当前屏用户】
      // 正序遍历：从上到下
      async function runForwardScan() {
        console.log("\n==================== 开始正序全量遍历（从上到下） ====================");
        let retryCount = 0;

        while (retryCount < CONFIG.MAX_SCROLL_RETRY) {
          // 所有目标已找到，提前结束
          if (remainingTargets.length === 0) {
            console.log("🎉 所有目标已找到，提前结束正序遍历");
            break;
          }

          // 1. 获取当前屏所有可见用户
          const userElements = getAllUserElements();
          console.log(`📝 当前屏获取到 ${userElements.length} 个用户`);
          
          if (userElements.length === 0) {
            console.warn("⚠️ 当前屏未找到用户，尝试向下滚动");
            const scrollRes = await scrollList('down');
            if (scrollRes.isEnd) retryCount++;
            continue;
          }

          // 2. 处理当前屏所有未处理的用户（一个不漏）
          let processedCount = 0;
          for (const el of userElements) {
            const res = await processUser(el);
            if (!res.skip) processedCount++;
            // 所有目标已找到，提前退出
            if (remainingTargets.length === 0) break;
          }
          console.log(`📊 当前屏处理完成，新处理 ${processedCount} 个用户，累计处理 ${processedNicknames.size} 个`);

          // 3. 当前屏所有用户都处理完了，滚动到下一屏
          const scrollRes = await scrollList('down');
          // 已经到底部，且没有新用户，增加重试计数
          if (scrollRes.isEnd && processedCount === 0) {
            retryCount++;
          } else {
            retryCount = 0;
          }
        }

        console.log("==================== 正序遍历完成 ====================");
        console.log(`📊 正序累计处理 ${processedNicknames.size} 个用户，剩余目标 ${remainingTargets.length} 个`);
      }

      // ✅ 反向遍历：从下到上，往上滑列表
      async function runBackwardScan() {
        if (remainingTargets.length === 0) {
          console.log("\n🎉 所有目标已找到，无需反向遍历");
          return;
        }

        console.log("\n==================== 开始反向全量遍历（从下到上） ====================");
        const container = findScrollContainer();
        let retryCount = 0;

        // 先滚动到列表最底部，作为反向遍历起点
        console.log("📜 先滚动到列表最底部，准备反向遍历");
        let bottomRetry = 0;
        while (bottomRetry < CONFIG.MAX_SCROLL_RETRY) {
          const beforeScroll = container.scrollTop;
          container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
          await sleep(1500);
          if (Math.abs(container.scrollTop - beforeScroll) < 20) {
            bottomRetry++;
          } else {
            bottomRetry = 0;
          }
        }
        console.log("✅ 已滚动到列表最底部，开始从下往上遍历");
        await sleep(CONFIG.RENDER_WAIT_TIME);

        // 反向遍历核心逻辑
        while (retryCount < CONFIG.MAX_SCROLL_RETRY) {
          if (remainingTargets.length === 0) {
            console.log("🎉 所有目标已找到，提前结束反向遍历");
            break;
          }

          // 1. 获取当前屏所有可见用户
          const userElements = getAllUserElements();
          console.log(`📝 当前屏获取到 ${userElements.length} 个用户`);
          
          if (userElements.length === 0) {
            console.warn("⚠️ 当前屏未找到用户，尝试向上滚动");
            const scrollRes = await scrollList('up');
            if (scrollRes.isEnd) retryCount++;
            continue;
          }

          // 2. 从下到上处理当前屏所有未处理的用户
          let processedCount = 0;
          for (let i = userElements.length - 1; i >= 0; i--) {
            const res = await processUser(userElements[i]);
            if (!res.skip) processedCount++;
            if (remainingTargets.length === 0) break;
          }
          console.log(`📊 当前屏处理完成，新处理 ${processedCount} 个用户，累计处理 ${processedNicknames.size} 个`);

          // 3. 当前屏处理完，往上滑一屏
          const scrollRes = await scrollList('up');
          // 已经到顶部，且没有新用户，增加重试计数
          if (scrollRes.isEnd && processedCount === 0) {
            retryCount++;
          } else {
            retryCount = 0;
          }
        }

        console.log("==================== 反向遍历完成 ====================");
        console.log(`📊 反向累计处理 ${processedNicknames.size} 个用户，剩余目标 ${remainingTargets.length} 个`);
      }

      // ✅ 兜底精准查找：针对剩余目标，单独循环查找（最后兜底）
      async function runFinalSearch() {
        if (remainingTargets.length === 0) return;
        console.log(`\n==================== 开始最终兜底查找，剩余 ${remainingTargets.length} 个目标 ====================`);
        
        const container = findScrollContainer();
        // 先滚回顶部
        container.scrollTo({ top: 0, behavior: 'smooth' });
        await sleep(2000);

        // 循环滚动查找剩余目标
        for (let targetId of remainingTargets) {
          console.log(`🔍 正在兜底查找: ${targetId}`);
          let found = false;
          let retry = 0;

          while (retry < CONFIG.MAX_SCROLL_RETRY * 2 && !found) {
            // 查找当前页是否有匹配的抖音号
            const match = document.body.innerText.match(new RegExp(`抖音号\\s*[:：]\\s*${targetId}`, 'i'));
            if (match) {
              console.log(`✅ 兜底找到目标: ${targetId}`);
              found = true;
              break;
            }

            // 没找到就继续滚动
            const scrollRes = await scrollList('down');
            if (scrollRes.isEnd) retry++;
          }

          if (!found) {
            console.log(`❌ 兜底未找到目标: ${targetId}`);
          }
        }
      }

      // 主执行流程
      try {
        // 第一步：滚回顶部，从第一个用户开始
        console.log("📜 初始化：滚动到列表最顶部");
        const container = findScrollContainer();
        container.scrollTo({ top: 0, behavior: 'smooth' });
        await sleep(2000);

        // 第二步：正序全量遍历（从上到下）
        await runForwardScan();

        // 第三步：反向全量遍历（从下到上，往上滑列表）
        await runBackwardScan();

        // 第四步：最终兜底查找
        await runFinalSearch();

        // 结果处理（按原Gitee顺序生成）
        console.log("\n================ 🏁 全量遍历最终结果 ================");
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

    // ========== 5. 结果处理与文件写入 ==========
    log('info', `📝 全量遍历完成，累计扫描处理 ${scanResult.processedCount || 0} 个用户`);
    if (!scanResult.success && scanResult.error) {
      log('warn', `⚠️ 遍历过程出现异常: ${scanResult.error}`);
    }

    fs.writeFileSync(CONFIG.LOCAL_USERS_FILE, scanResult.content, 'utf8');
    log('success', `✅ ${CONFIG.LOCAL_USERS_FILE} 文件已成功生成/更新`);
    log('info', `🏁 任务全部完成，成功匹配 ${scanResult.results?.length || 0}/${TARGET_DOUYIN_IDS.length} 个目标抖音号`);

    if (scanResult.remainingTargets?.length > 0) {
      log('warn', `⚠️ 全量遍历后仍未找到的目标抖音号: ${scanResult.remainingTargets.join(', ')}`);
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

// 执行主函数
runSync();
