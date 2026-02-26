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
      message: sha ? 'update: 同步抖音私信全量用户数据' : 'init: 初始化抖音私信全量用户JSON数据',
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

// 主函数
async function runSync() {
  let browser = null;
  let page = null;
  try {
    log('info', '🚀 启动抖音私信全量用户采集脚本（修复版：头像+抖音号）');
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

    // 4. 全量采集核心逻辑（修复版）
    log('info', '✅ 开始全量滚动采集');
    
    const scanResult = await page.evaluate(async (CONFIG) => {
      const allUsers = [];
      const processedIds = new Set(); // 用于去重 (优先用抖音号，没有则用昵称)
      const PROCESSED_ATTR = 'data-user-processed';
      let noNewUserCount = 0;

      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      // --- 移植自 sync_users.js 的核心辅助函数 ---
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
        // 优先查找 sem