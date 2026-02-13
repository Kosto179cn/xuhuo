const { chromium } = require('playwright');
const { readFileSync } = require('fs');
const axios = require('axios');

// 配置
const CONFIG = {
  // 抖音聊天页面
  url: 'https://creator.douyin.com/creator-micro/data/following/chat',
  
  // 目标用户列表（从文件读取，环境变量优先）
  targetUsers: process.env.TARGET_USERS || readUsersFromFile() || '',
  
  // 发送消息配置
  useHitokoto: true,
  useTxtApi: true,
  useSpecialHitokoto: true,
  txtApiUrl: 'https://v1.hitokoto.cn/?encode=text',
  txtApiManualText: process.env.TXT_MANUAL_TEXT || '文本1\n文本2\n文本3',
  
  // 专属一言（每天不同的文案）
  specialHitokoto: {
    monday: process.env.SPECIAL_MONDAY || '周一专属文案1\n周一专属文案2',
    tuesday: process.env.SPECIAL_TUESDAY || '周二专属文案1\n周二专属文案2',
    wednesday: process.env.SPECIAL_WEDNESDAY || '周三专属文案1\n周三专属文案2',
    thursday: process.env.SPECIAL_THURSDAY || '周四专属文案1\n周四专属文案2',
    friday: process.env.SPECIAL_FRIDAY || '周五专属文案1\n周五专属文案2',
    saturday: process.env.SPECIAL_SATURDAY || '周六专属文案1\n周六专属文案2',
    sunday: process.env.SPECIAL_SUNDAY || '周日专属文案1\n周日专属文案2'
  },
  
  // 消息模板
  messageTemplate: process.env.MESSAGE_TEMPLATE || 
    '—————每日续火—————\n\n[TXTAPI]\n\n—————每日一言—————\n\n[API]\n\n—————专属一言—————\n\n[专属一言]',
  
  // 超时设置（GitHub Actions 网络较慢，增加超时时间）
  pageTimeout: 120000,  // 页面加载超时 2 分钟
  userSearchTimeout: 30000,  // 用户查找超时 30 秒
  apiTimeout: 30000,  // API 超时 30 秒
  gotoTimeout: 120000  // 页面跳转超时 2 分钟
};

// 发送记录（内存中，每次运行重置）
const sentUsers = new Set();
let fireDays = 1;

// 日志函数
function log(level, message) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
}

// 从文件读取用户列表
function readUsersFromFile() {
  try {
    const content = readFileSync('./users.txt', 'utf-8');
    const lines = content.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
    return lines.join('\n');
  } catch (error) {
    log('warn', '未找到 users.txt 文件，使用默认配置');
    return '';
  }
}

// 获取一言内容
async function getHitokoto() {
  try {
    const response = await axios.get('https://v1.hitokoto.cn/', {
      timeout: CONFIG.apiTimeout
    });
    const data = response.data;
    return `${data.hitokoto}\n—— ${data.from}${data.from_who ? '「' + data.from_who + '」' : ''}`;
  } catch (error) {
    log('error', `一言获取失败: ${error.message}`);
    return '一言获取失败~';
  }
}

// 获取TXTAPI内容
async function getTxtApiContent() {
  try {
    const response = await axios.get(CONFIG.txtApiUrl, {
      timeout: CONFIG.apiTimeout
    });
    return response.data.trim();
  } catch (error) {
    log('error', `TXTAPI获取失败: ${error.message}`);
    return 'TXTAPI获取失败~';
  }
}

// 获取专属一言
function getSpecialHitokoto() {
  try {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    
    const currentDayKey = dayKeys[dayOfWeek];
    const dayName = dayNames[dayOfWeek];
    
    const text = CONFIG.specialHitokoto[currentDayKey] || '';
    const lines = text.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
      return `${dayName}暂无专属一言`;
    }
    
    // 随机选择一条
    const randomIndex = Math.floor(Math.random() * lines.length);
    return `${dayName}专属: ${lines[randomIndex].trim()}`;
  } catch (error) {
    log('error', `专属一言获取失败: ${error.message}`);
    return '专属一言获取失败~';
  }
}

// 获取完整消息内容
async function getMessageContent() {
  let message = CONFIG.messageTemplate;
  
  // 获取一言
  let hitokotoContent = '';
  if (CONFIG.useHitokoto) {
    log('info', '正在获取一言内容...');
    hitokotoContent = await getHitokoto();
    log('success', '一言内容获取成功');
  }
  
  // 获取TXTAPI
  let txtApiContent = '';
  if (CONFIG.useTxtApi) {
    log('info', '正在获取TXTAPI内容...');
    txtApiContent = await getTxtApiContent();
    log('success', 'TXTAPI内容获取成功');
  }
  
  // 获取专属一言
  let specialHitokotoContent = '';
  if (CONFIG.useSpecialHitokoto) {
    log('info', '正在获取专属一言内容...');
    specialHitokotoContent = getSpecialHitokoto();
    log('success', '专属一言内容获取成功');
  }
  
  // 替换占位符
  message = message.replace('[API]', hitokotoContent);
  message = message.replace('[TXTAPI]', txtApiContent);
  message = message.replace('[专属一言]', specialHitokotoContent);
  message = message.replace('[天数]', fireDays);
  
  return message;
}

// 查找并点击用户 (精准匹配版)
async function findAndClickUser(page, username) {
  try {
    // 使用 XPath 寻找：类名包含 name 且文本完全匹配
    // normalize-space 可以自动处理文本前后的换行或空格
    const xpath = `//span[contains(@class, 'name') and normalize-space(text())='${username}']`;
    const user = page.locator(xpath).first();

    if (await user.isVisible()) {
      log('success', `找到用户 ${username}，正在点击...`);
      // 强制点击，因为外面可能有透明层
      await user.click({ force: true });
      // 等待 2 秒让聊天框加载
      await page.waitForTimeout(2000);
      return true;
    }

    // 调试日志：打印当前所有可见的名字
    const visibleNames = await page.$$eval('[class*="name"]', elements =>
      elements.map(el => el.textContent.trim())
    );

    if (global.debugLogCounter === 0) {
       log('info', `当前列表内包含: ${visibleNames.join(' | ')}`);
       global.debugLogCounter++;
    }

    return false;
  } catch (e) {
    return false;
  }
}

// 滚动查找用户 (暴力兼容版)
async function scrollAndFindUser(page, username) {
  log('info', `开始滚动查找用户: ${username}`);

  // 1. 尝试多种定位方式找到滚动容器
  const selectors = [
    'div[role="grid"]',
    '.ReactVirtualized__Grid',
    '.ReactVirtualized__List',
    '.list-UuDnnd div[style*="overflow: auto"]' // 针对你 HTML 特征的定位
  ];

  let gridLocator = null;
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if (await loc.count() > 0) {
      gridLocator = loc;
      log('info', `成功锁定容器选择器: ${selector}`);
      break;
    }
  }

  // 2. 如果还是没找到明确容器，我们就对着页面中心"盲滚"
  const maxScrolls = 40;
  for (let i = 0; i < maxScrolls; i++) {
    const found = await findAndClickUser(page, username);
    if (found) return true;

    if (gridLocator) {
      // 方式 A：直接操作 DOM 滚动（最稳）
      await gridLocator.evaluate(el => el.scrollTop += 800);
    } else {
      // 方式 B：模拟鼠标在页面中心滚动
      await page.mouse.wheel(0, 800);
    }

    // 给 React 留出渲染新列表项的时间
    await page.waitForTimeout(1200);
  }
  return false;
}

// 发送消息给指定用户
async function sendToUser(page, username) {
  log('info', `开始处理用户: ${username}`);
  
  // 查找并点击用户
  const found = await scrollAndFindUser(page, username);
  if (!found) {
    log('error', `无法找到用户: ${username}`);
    return false;
  }
  
  // 等待聊天界面加载
  await page.waitForTimeout(1000);
  
  // 查找输入框
  const inputSelector = '.chat-input-dccKiL';
  await page.waitForSelector(inputSelector, { timeout: CONFIG.pageTimeout });
  log('success', '找到聊天输入框');
  
  // 获取消息内容
  const message = await getMessageContent();
  log('info', '消息内容准备完成');
  
  // 输入消息
  await page.fill(inputSelector, message);
  await page.keyboard.press('Enter');
  log('success', '消息已发送');
  
  return true;
}

// 主函数
async function main() {
  log('info', '抖音续火花自动发送助手启动');
  
  // 解析目标用户列表
  const targetUsers = CONFIG.targetUsers.split('\n')
    .map(u => u.trim())
    .filter(u => u.length > 0);
  
  if (targetUsers.length === 0) {
    log('error', '没有配置目标用户');
    return;
  }
  
  log('info', `共 ${targetUsers.length} 个目标用户: ${targetUsers.join(', ')}`);
  
  // 解析 Cookies
  let cookies = [];
  if (process.env.DOUYIN_COOKIES) {
    try {
      cookies = JSON.parse(process.env.DOUYIN_COOKIES);
      log('info', `已加载 ${cookies.length} 个 Cookies`);
    } catch (error) {
      log('error', `Cookies 解析失败: ${error.message}`);
      return;
    }
  } else {
    log('error', '未设置 DOUYIN_COOKIES 环境变量');
    return;
  }
  
  // 启动浏览器
  log('info', '正在启动无头浏览器...');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',  // 解决 /dev/shm 过小的问题
      '--disable-gpu',
      '--no-zygote',
      '--single-process',  // 单进程模式，减少内存使用
      '--disable-blink-features=AutomationControlled'  // 隐藏自动化特征
    ]
  });
  
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, // 必须设置足够大的视口
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  // 注入 Cookies
  await context.addCookies(cookies);
  
  const page = await context.newPage();
  
  try {
    // 访问抖音创作者中心
    log('info', `正在访问 ${CONFIG.url}`);
    
    // 设置页面监听
    page.on('response', response => {
      if (response.status() >= 400) {
        log('warn', `请求失败: ${response.url()} - ${response.status()}`);
      }
    });
    
    await page.goto(CONFIG.url, { 
      waitUntil: 'domcontentloaded',  // 改用更宽松的等待条件
      timeout: CONFIG.gotoTimeout || 120000 
    });
    
    // 额外等待一段时间，确保页面完全加载
    log('info', '等待页面渲染...');
    await page.waitForTimeout(8000);
    
    // 检查是否需要重新登录
    const pageTitle = await page.title();
    const currentUrl = page.url();
    log('info', `当前页面: ${currentUrl}`);
    
    if (pageTitle.includes('登录') || currentUrl.includes('login')) {
      log('error', '需要重新登录，请更新 Cookies');
      return;
    }
    
    // 检查页面是否有内容
    const hasContent = await page.$('[class*="name"]');
    if (!hasContent) {
      log('warn', '页面未检测到聊天列表，等待加载...');
      // 增加等待时间，抖音的 semi-spin 加载有时很慢
      await page.waitForTimeout(15000);
    }

    // 检查是否有加载动画
    const hasSpinner = await page.$('.semi-spin');
    if (hasSpinner) {
      log('warn', '检测到加载动画，继续等待...');
      await page.waitForSelector('.semi-spin', { state: 'hidden', timeout: 30000 }).catch(() => {});
    }

    // 最终检查
    const finalCheck = await page.$('[class*="name"]');
    if (!finalCheck) {
      log('error', '页面长时间未加载聊天列表，可能需要重新登录');
      return;
    }

    log('success', '页面加载成功');
    
    // 遍历所有目标用户
    for (const username of targetUsers) {
      if (sentUsers.has(username)) {
        log('info', `用户 ${username} 已处理过，跳过`);
        continue;
      }
      
      const success = await sendToUser(page, username);
      if (success) {
        sentUsers.add(username);
        log('success', `用户 ${username} 处理完成`);
      } else {
        log('error', `用户 ${username} 处理失败`);
      }
      
      // 等待一段时间再处理下一个用户
      await page.waitForTimeout(2000);
    }
    
    log('success', `所有任务完成，成功发送 ${sentUsers.size}/${targetUsers.length} 个用户`);
    
  } catch (error) {
    log('error', `执行出错: ${error.message}`);
    console.error(error);
  } finally {
    await browser.close();
    log('info', '浏览器已关闭');
  }
}

// 运行主函数
main().catch(error => {
  log('error', `程序异常退出: ${error.message}`);
  console.error(error);
  process.exit(1);
});
