const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');

// 固定配置
const CONFIG = {
  GITEE_API_URL: 'https://gitee.com/api/v5/repos/Kosto179/kosto-battle-clicker-new/contents/douyinh.txt',
  LOCAL_USERS_FILE: 'users.txt',
  CREATOR_CHAT_URL: 'https://creator.douyin.com/creator-micro/data/following/chat',
  GOTO_TIMEOUT: 120000,
  // 单次滚动步长（适配相邻用户滚动，正反向通用）
  SCROLL_STEP: 200,
  // 滚动到底部/顶部的最大重试次数
  MAX_SCROLL_RETRY: 6
};

// 日志函数
const log = (level, msg, ...args) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`, ...args);

// 主函数
async function runSync() {
  let browser = null;
  let page = null;
  try {
    log('info', '🚀 启动抖音用户同步脚本（正反向全量滚动版）');

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

    // Cookie处理（复用index.js修复逻辑）
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

    // 等待页面渲染+登录态校验
    await page.waitForTimeout(10000);
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('passport') || currentUrl.includes('verify')) {
      log('error', '❌ Cookie已失效/触发人机验证，请重新获取Cookie');
      process.exit(1);
    }

    // 等待用户列表渲染完成
    await page.waitForSelector('span[class*="name"], div[class*="name"]', {
      timeout: 60000,
      state: 'attached'
    });
    log('success', '✅ 页面加载完成，用户列表已渲染，开始顺序遍历');

    // ================= 【核心：正反向全量遍历+上下滑完全匹配】 =================
    const scanResult = await page.evaluate(async (params) => {
      const { CONFIG, TARGET_DOUYIN_IDS } = params;
      
      // 结果存储
      const results = [];
      // 已处理用户标记（防重复）
      const processedNicknames = new Set();
      // 剩余待匹配的目标抖音号
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

      // 查找“查看Ta的主页”元素
      function findHoverTarget() {
        const elements = document.querySelectorAll('span, div');
        for (const el of elements) {
          if (el.textContent.trim() === '查看Ta的主页') {
            return el;
          }
        }
        return null;
      }

      // 查找滚动容器
      function findScrollContainer() {
        let container = document.querySelector('.ReactVirtualized__Grid, [role="grid"], .semi-list-items');
        if (container) return container;
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
          const style = window.getComputedStyle(div);
          const isScrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
          const isTall = div.clientHeight > window.innerHeight * 0.6;
          const hasUserItems = div.querySelector('[class*="name"], [class*="user"]');
          if (isScrollable && isTall && hasUserItems) return div;
        }
        return document.scrollingElement || document.documentElement;
      }

      // 滚动到指定元素，确保在视图内
      function scrollToElement(el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return sleep(300);
      }

      // 获取当前页面所有可见的用户昵称元素
      function getAllUserElements() {
        return Array.from(document.querySelectorAll('span[class*="name"], div[class*="name"]'))
          .filter(el => {
            const text = el.textContent.trim();
            return text && text.length > 1;
          });
      }

      // ✅ 【核心：通用滚动函数，正反向完全匹配】
      // direction: down=向下滑（正序），up=向上滑（反向）
      async function scrollList(direction = 'down') {
        const container = findScrollContainer();
        const step = direction === 'down' ? CONFIG.SCROLL_STEP : -CONFIG.SCROLL_STEP;
        const beforeScrollTop = container.scrollTop;
        console.log(`📜 执行${direction === 'down' ? '向下' : '向上'}滚动，当前位置: ${beforeScrollTop}`);

        // 方式1：模拟物理滚轮（核心，触发React虚拟列表渲染）
        const stepCount = CONFIG.SCROLL_STEP / 100;
        for (let j = 0; j < stepCount; j++) {
          container.dispatchEvent(new WheelEvent('wheel', {
            deltaY: direction === 'down' ? 100 : -100, // 负数=向上滚
            bubbles: true,
            cancelable: true,
            composed: true
          }));
          container.scrollTop += direction === 'down' ? 100 : -100;
          await sleep(50);
        }

        // 方式2：强制scrollTo兜底
        container.scrollTo({ top: container.scrollTop + step, behavior: 'smooth' });

        // 方式3：键盘事件兜底
        container.dispatchEvent(new KeyboardEvent('keydown', {
          key: direction === 'down' ? 'PageDown' : 'PageUp',
          code: direction === 'down' ? 'PageDown' : 'PageUp',
          keyCode: direction === 'down' ? 34 : 33,
          which: direction === 'down' ? 34 : 33,
          bubbles: true
        }));

        await sleep(2000); // 固定等待，给React足够渲染时间
        const afterScrollTop = container.scrollTop;
        const scrollDistance = Math.abs(afterScrollTop - beforeScrollTop);
        console.log(`📜 ${direction === 'down' ? '向下' : '向上'}滚动完成，新位置: ${afterScrollTop}，滚动距离: ${scrollDistance}`);
        
        // 返回是否真的滚动了
        return scrollDistance > 20;
      }

      // 核心：处理单个用户（点击→提取抖音号→匹配→标记）
      async function processUser(el) {
        const nickname = el.textContent.trim();
        // 已处理过的直接跳过
        if (processedNicknames.has(nickname)) {
          return { skip: true, dyId: null };
        }

        console.log(`👤 正在处理用户: ${nickname}`);
        // 1. 滚动到用户并点击
        await scrollToElement(el);
        el.click({ force: true });
        await sleep(1500);

        // 2. 查找悬停目标，提取抖音号
        const hoverTarget = findHoverTarget();
        let dyId = null;
        if (hoverTarget) {
          hoverTarget.scrollIntoView({ block: 'center' });
          triggerMouseEvent(hoverTarget, 'mousemove');
          await sleep(50);
          triggerMouseEvent(hoverTarget, 'mouseenter');
          triggerMouseEvent(hoverTarget, 'mouseover');

          // 20次循环重试提取抖音号
          for (let i = 0; i < 20; i++) {
            await sleep(100);
            const match = document.body.innerText.match(/抖音号\s*[:：]\s*([\w\.\-_]+)/);
            if (match) {
              dyId = match[1].trim();
              break;
            }
          }
          triggerMouseEvent(hoverTarget, 'mouseleave');
        }

        // 3. 标记为已处理
        processedNicknames.add(nickname);
        console.log(`✅ 处理完成: ${nickname} | 提取抖音号: ${dyId || '未提取到'}`);

        // 4. 匹配目标抖音号
        if (dyId && TARGET_DOUYIN_IDS.includes(dyId) && remainingTargets.includes(dyId)) {
          console.log(`%c🎯 命中目标: ${dyId} | 昵称: ${nickname}`, "color: #4CAF50; font-weight: bold;");
          results.push({ id: dyId, nickname: nickname });
          remainingTargets = remainingTargets.filter(id => id !== dyId);
        }

        await sleep(300);
        return { skip: false, dyId };
      }

      // ================= 第一遍：从上到下正序遍历（往下滑列表） =================
      async function runForwardScan() {
        console.log("\n==================== 开始正序遍历（从上到下） ====================");
        let retryCount = 0;

        while (retryCount < CONFIG.MAX_SCROLL_RETRY) {
          // 所有目标已找到，提前结束
          if (remainingTargets.length === 0) {
            console.log("🎉 所有目标已找到，提前结束正序遍历");
            break;
          }

          // 获取当前所有可见用户
          const userElements = getAllUserElements();
          if (userElements.length === 0) {
            console.warn("⚠️ 未找到用户元素，尝试向下滚动");
            await scrollList('down');
            retryCount++;
            continue;
          }

          // 找到下一个要处理的用户（从上到下，跳过已处理的）
          let nextUserEl = null;
          for (let i = 0; i < userElements.length; i++) {
            const nickname = userElements[i].textContent.trim();
            if (!processedNicknames.has(nickname)) {
              nextUserEl = userElements[i];
              break;
            }
          }

          // 没有找到未处理的用户，尝试向下滚动加载更多
          if (!nextUserEl) {
            console.log("⚠️ 当前页无未处理用户，向下滚动加载更多");
            const isScrolled = await scrollList('down');
            // 滚动距离过小，说明已经到底部
            if (!isScrolled) {
              retryCount++;
            } else {
              retryCount = 0;
            }
            continue;
          }

          // 重置重试计数
          retryCount = 0;
          // 处理当前用户
          await processUser(nextUserEl);
        }

        console.log("==================== 正序遍历完成 ====================");
        console.log(`📊 正序遍历共处理 ${processedNicknames.size} 个用户，剩余目标 ${remainingTargets.length} 个`);
      }

      // ================= 第二遍：从下到上反向遍历（往上滑列表，完全匹配你的需求） =================
      async function runBackwardScan() {
        // 所有目标已找到，不用反向遍历
        if (remainingTargets.length === 0) {
          console.log("\n🎉 所有目标已找到，无需反向遍历");
          return;
        }

        console.log("\n==================== 开始反向遍历（从下到上） ====================");
        const container = findScrollContainer();
        let retryCount = 0;

        // 第一步：先滚动到列表最底部，作为反向遍历的起点
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
        console.log("✅ 已滚动到列表最底部，开始从下往上遍历+往上滑列表");
        retryCount = 0;

        while (retryCount < CONFIG.MAX_SCROLL_RETRY) {
          // 所有目标已找到，提前结束
          if (remainingTargets.length === 0) {
            console.log("🎉 所有目标已找到，提前结束反向遍历");
            break;
          }

          // 获取当前所有可见用户
          const userElements = getAllUserElements();
          if (userElements.length === 0) {
            console.warn("⚠️ 未找到用户元素，尝试向上滚动");
            await scrollList('up'); // 往上滑列表
            retryCount++;
            continue;
          }

          // 找到下一个要处理的用户（从下到上，跳过已处理的）
          let nextUserEl = null;
          for (let i = userElements.length - 1; i >= 0; i--) {
            const nickname = userElements[i].textContent.trim();
            if (!processedNicknames.has(nickname)) {
              nextUserEl = userElements[i];
              break;
            }
          }

          // 没有找到未处理的用户，尝试向上滚动加载更多（往上滑列表）
          if (!nextUserEl) {
            console.log("⚠️ 当前页无未处理用户，向上滚动列表加载更多");
            const isScrolled = await scrollList('up'); // 往上滑列表
            // 滚动距离过小，说明已经到顶部
            if (!isScrolled) {
              retryCount++;
            } else {
              retryCount = 0;
            }
            continue;
          }

          // 重置重试计数
          retryCount = 0;
          // 处理当前用户
          await processUser(nextUserEl);
        }

        console.log("==================== 反向遍历完成 ====================");
        console.log(`📊 反向遍历后共处理 ${processedNicknames.size} 个用户，剩余目标 ${remainingTargets.length} 个`);
      }

      // 主执行流程
      try {
        // 第一步：先滚动到列表最顶部，确保从第一个用户开始
        console.log("📜 先滚动到列表最顶部，从第一个用户开始");
        const container = findScrollContainer();
        container.scrollTo({ top: 0, behavior: 'smooth' });
        await sleep(2000);

        // 第二步：正序遍历（从上到下，往下滑列表）
        await runForwardScan();

        // 第三步：反向遍历（从下到上，往上滑列表，完全匹配你的需求）
        await runBackwardScan();

        // 结果处理
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

    // ========== 5. 结果处理与文件写入 ==========
    log('info', `📝 遍历完成，共扫描处理 ${scanResult.processedCount || 0} 个用户`);
    if (!scanResult.success && scanResult.error) {
      log('warn', `⚠️ 遍历过程出现异常: ${scanResult.error}`);
    }

    fs.writeFileSync(CONFIG.LOCAL_USERS_FILE, scanResult.content, 'utf8');
    log('success', `✅ ${CONFIG.LOCAL_USERS_FILE} 文件已成功生成/更新`);
    log('info', `🏁 任务全部完成，成功匹配 ${scanResult.results?.length || 0}/${TARGET_DOUYIN_IDS.length} 个目标抖音号`);

    if (scanResult.remainingTargets?.length > 0) {
      log('warn', `⚠️ 一个来回遍历后仍未找到的目标抖音号: ${scanResult.remainingTargets.join(', ')}`);
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
