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
  MAX_SCROLL_ATTEMPTS: 100, // 最大滚动轮次
  SCROLL_TOTAL_STEP: 800,   // 单次滚动总距离（和index.js一致）
  SCROLL_STEP: 100          // 小步滚动距离（和index.js一致）
};

// 日志函数（兼容CI环境）
const log = (level, msg, ...args) => console.log(`[${new Date().toLocaleTimeString()}] [${level.toUpperCase()}] ${msg}`, ...args);

// 主函数
async function runSync() {
  let browser = null;
  let page = null;
  try {
    log('info', '🚀 启动抖音用户同步脚本（融合index.js可用滚动+全量标记遍历）');

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

    // 解析Base64内容，过滤空行、注释
    const rawFileContent = Buffer.from(giteeRes.data.content, 'base64').toString();
    const TARGET_DOUYIN_IDS = rawFileContent.split('\n')
      .map(id => id.trim())
      .filter(id => id && !id.startsWith('#'));

    if (TARGET_DOUYIN_IDS.length === 0) {
      log('error', '❌ 从Gitee拉取的抖音号列表为空');
      process.exit(1);
    }
    log('success', `✅ 成功拉取到${TARGET_DOUYIN_IDS.length}个目标抖音号`);

    // ========== 3. 启动浏览器，注入Cookie，反爬配置 ==========
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

    // 注入反爬脚本，隐藏自动化特征
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh'] });
      window.chrome = { runtime: {} };
    });

    // 清理并注入Cookie（复用index.js的fixCookies逻辑）
    let parsedCookies;
    try {
      parsedCookies = JSON.parse(douyinCookies);
    } catch (err) {
      log('error', '❌ DOUYIN_COOKIES格式错误，必须是标准JSON字符串');
      process.exit(1);
    }
    // index.js 原版Cookie修复逻辑
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
    // 只监听致命页面错误，过滤无关的CSP/CORS警告
    page.on('pageerror', err => log('error', `页面运行错误: ${err.message}`));
    log('success', '✅ 浏览器启动完成，Cookie已注入，反爬配置生效');

    // ========== 4. 页面加载逻辑（修复超时，和index.js一致） ==========
    log('info', '🌐 正在进入抖音创作者中心私信页面，等待页面加载...');
    await page.goto(CONFIG.CREATOR_CHAT_URL, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.GOTO_TIMEOUT
    });

    // 校验登录态（和index.js一致，等待10秒基础渲染）
    await page.waitForTimeout(10000);
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('passport') || currentUrl.includes('verify')) {
      log('error', '❌ Cookie已失效/触发人机验证，请重新获取抖音创作者中心Cookie');
      process.exit(1);
    }

    // 等待核心列表元素渲染，确保页面加载完成
    await page.waitForSelector('span[class*="name"], div[class*="name"], [class*="user-item"]', {
      timeout: 60000,
      state: 'attached'
    });
    log('success', '✅ 页面加载完成，用户列表已渲染，开始全量遍历扫描');

    // ================= 【核心修复：合并参数，解决evaluate参数超限问题】 =================
    const scanResult = await page.evaluate(async (params) => {
      // 解构出两个参数，内部逻辑完全不变
      const { CONFIG, TARGET_DOUYIN_IDS } = params;
      
      // 结果存储
      const results = [];
      // 双重防重复标记：内存Set + DOM自定义属性（和原版一致）
      const processedNicknames = new Set();
      const PROCESSED_ATTR = 'data-user-processed';
      let remainingTargets = [...TARGET_DOUYIN_IDS];
      let noNewUserCount = 0; // 连续无新用户计数，判断是否到底

      // 工具函数：sleep（和原版一致）
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      // 工具函数：模拟鼠标事件（和原版一致）
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

      // 工具函数：查找“查看Ta的主页”（和原版一致）
      function findHoverTarget() {
        const elements = document.querySelectorAll('span, div');
        for (const el of elements) {
          if (el.textContent.trim() === '查看Ta的主页') {
            return el;
          }
        }
        return null;
      }

      // ✅ 核心移植：index.js 原版滚动逻辑（一字未改，仅封装成函数）
      async function scrollDouyinList() {
        const scrollContainer = document.querySelector('.ReactVirtualized__Grid, [role="grid"], .semi-list-items');
        if (!scrollContainer) {
          window.scrollBy(0, CONFIG.SCROLL_TOTAL_STEP);
          return;
        }
        // 分小步滚动：模拟物理滚轮+强制scrollTop（和index.js完全一致）
        const stepCount = CONFIG.SCROLL_TOTAL_STEP / CONFIG.SCROLL_STEP;
        for (let j = 0; j < stepCount; j++) {
          scrollContainer.dispatchEvent(new WheelEvent('wheel', {
            deltaY: CONFIG.SCROLL_STEP,
            bubbles: true,
            cancelable: true,
            composed: true
          }));
          scrollContainer.scrollTop += CONFIG.SCROLL_STEP;
          await sleep(50);
        }
      }

      // 主遍历逻辑
      try {
        console.log("✅ 列表容器已锁定，开始全量遍历（使用index.js滚动逻辑）");

        for (let attempt = 0; attempt < CONFIG.MAX_SCROLL_ATTEMPTS; attempt++) {
          console.log(`\n🔄 第 ${attempt + 1} 轮遍历 | 已处理: ${processedNicknames.size} | 剩余目标: ${remainingTargets.length}`);
          
          // 获取当前页所有可见用户昵称元素
          const allNameElements = Array.from(document.querySelectorAll('span[class*="name"], div[class*="name"]'));
          // 过滤未处理的用户
          const unprocessedElements = allNameElements.filter(el => {
            const nickname = el.textContent.trim();
            return nickname && !processedNicknames.has(nickname) && !el.hasAttribute(PROCESSED_ATTR);
          });

          // 无新用户则执行index.js滚动逻辑，直接下滑
          if (unprocessedElements.length === 0) {
            console.log("⚠️ 当前页无未处理用户，执行index.js滚动逻辑加载更多");
            noNewUserCount++;
            if (noNewUserCount >= 3) {
              console.log("🚫 连续3轮无新用户，列表已到底部，停止遍历");
              break;
            }
            await scrollDouyinList(); // 调用index.js滚动
            await sleep(1200); // 滚动后等待，和index.js一致
            continue;
          }

          // 重置无新用户计数
          noNewUserCount = 0;
          console.log(`📝 当前页找到 ${unprocessedElements.length} 个未处理用户，开始挨个查看`);

          // 挨个处理未查看用户
          for (const el of unprocessedElements) {
            const nickname = el.textContent.trim();
            // 二次校验，避免重复处理
            if (processedNicknames.has(nickname) || el.hasAttribute(PROCESSED_ATTR)) continue;

            console.log(`👤 正在查看用户: ${nickname}`);
            // 1. 点击用户（和原版一致）
            el.scrollIntoView({ block: "center", behavior: "auto" });
            await sleep(100);
            el.click({ force: true });
            await sleep(1500);

            // 2. 查找悬停目标，提取抖音号（和原版一致）
            const hoverTarget = findHoverTarget();
            let dyId = null;
            if (hoverTarget) {
              hoverTarget.scrollIntoView({ block: "center" });
              triggerMouseEvent(hoverTarget, 'mousemove');
              await sleep(50);
              triggerMouseEvent(hoverTarget, 'mouseenter');
              triggerMouseEvent(hoverTarget, 'mouseover');

              // 20次循环提取抖音号
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

            // 3. 标记为已查看（核心，无论是否匹配都标记）
            processedNicknames.add(nickname);
            el.setAttribute(PROCESSED_ATTR, 'true');
            console.log(`✅ 已标记用户: ${nickname} | 提取抖音号: ${dyId || '未提取到'}`);

            // 4. 目标匹配，更新结果（和原版一致）
            if (dyId && TARGET_DOUYIN_IDS.includes(dyId) && remainingTargets.includes(dyId)) {
              console.log(`%c🎯 命中目标: ${dyId} | 昵称: ${nickname}`, "color: #4CAF50; font-weight: bold;");
              results.push({ id: dyId, nickname: nickname });
              remainingTargets = remainingTargets.filter(id => id !== dyId);
            }

            // 所有目标找到，提前终止
            if (remainingTargets.length === 0) {
              console.log("🎉 所有目标抖音号已找到，提前结束遍历");
              break;
            }
            await sleep(300); // 操作间隔，防反爬
          }

          // 所有目标找到，跳出外层循环
          if (remainingTargets.length === 0) break;

          // 当前页处理完毕，执行index.js滚动加载下一页
          console.log("📥 当前页处理完毕，执行index.js滚动加载更多");
          await scrollDouyinList(); // 调用index.js滚动
          await sleep(1200); // 滚动后等待，和index.js一致

          // 检查是否滚动到底部（和index.js逻辑一致）
          const scrollContainer = document.querySelector('.ReactVirtualized__Grid, [role="grid"], .semi-list-items') || document.scrollingElement;
          const isBottom = Math.abs(scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight) < 50;
          if (isBottom) {
            console.log("🚫 已滚动到列表最底部，停止遍历");
            break;
          }
        }

        // 结果处理（按原Gitee顺序生成内容）
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
    // 核心修复：把两个参数合并成一个对象传入
    }, { CONFIG, TARGET_DOUYIN_IDS });

    // ========== 5. 结果处理与文件写入 ==========
    log('info', `📝 遍历完成，共扫描处理 ${scanResult.processedCount || 0} 个用户`);
    if (!scanResult.success && scanResult.error) {
      log('warn', `⚠️ 遍历过程出现异常: ${scanResult.error}`);
    }

    // 写入本地users.txt
    fs.writeFileSync(CONFIG.LOCAL_USERS_FILE, scanResult.content, 'utf8');
    log('success', `✅ ${CONFIG.LOCAL_USERS_FILE} 文件已成功生成/更新`);
    log('info', `🏁 任务全部完成，成功匹配 ${scanResult.results?.length || 0}/${TARGET_DOUYIN_IDS.length} 个目标抖音号`);

    // 输出未找到的目标
    if (scanResult.remainingTargets?.length > 0) {
      log('warn', `⚠️ 未找到的目标抖音号: ${scanResult.remainingTargets.join(', ')}`);
    }

  } catch (err) {
    // 全链路错误捕获
    log('error', `🚨 任务执行失败: ${err.message}`);
    log('error', '错误详情:', err.stack);
    process.exit(1);
  } finally {
    // 确保浏览器关闭
    if (browser) {
      await browser.close();
      log('info', '✅ 浏览器已关闭，脚本执行完毕');
    }
  }
}

// 执行主函数
runSync();
