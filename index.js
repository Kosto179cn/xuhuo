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
  
  // 超时设置
  pageTimeout: 30000,
  userSearchTimeout: 10000,
  apiTimeout: 10000
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

// 查找并点击用户
async function findAndClickUser(page, username) {
  log('info', `正在查找用户: ${username}`);
  
  try {
    // 等待聊天列表加载
    await page.waitForSelector('[class*="item-header-name-"]', { timeout: CONFIG.userSearchTimeout });
    
    // 获取所有用户元素
    const userElements = await page.$$('[class*="item-header-name-"]');
    
    // 查找目标用户
    for (const element of userElements) {
      const text = await element.textContent();
      if (text && text.trim() === username) {
        log('success', `找到目标用户: ${username}`);
        await element.click();
        return true;
      }
    }
    
    log('warn', `未找到用户: ${username}`);
    return false;
  } catch (error) {
    log('error', `查找用户时出错: ${error.message}`);
    return false;
  }
}

// 滚动查找用户
async function scrollAndFindUser(page, username) {
  log('info', `开始滚动查找用户: ${username}`);
  
  const maxScrolls = 20;
  let scrollCount = 0;
  
  while (scrollCount < maxScrolls) {
    // 先尝试查找
    const found = await findAndClickUser(page, username);
    if (found) {
      return true;
    }
    
    // 滚动聊天列表
    try {
      const chatContainer = await page.$('.ReactVirtualized__Grid') || 
                           await page.$('[class*="list-container"]') ||
                           await page.$('.semi-list-content');
      
      if (chatContainer) {
        await chatContainer.evaluate(el => el.scrollTop += 400);
      }
      
      // 等待页面更新
      await page.waitForTimeout(500);
    } catch (error) {
      log('warn', `滚动时出错: ${error.message}`);
    }
    
    scrollCount++;
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
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  // 注入 Cookies
  await context.addCookies(cookies);
  
  const page = await context.newPage();
  
  try {
    // 访问抖音创作者中心
    log('info', `正在访问 ${CONFIG.url}`);
    await page.goto(CONFIG.url, { waitUntil: 'networkidle', timeout: CONFIG.pageTimeout });
    
    // 等待页面加载
    await page.waitForTimeout(2000);
    
    // 检查是否需要重新登录
    const pageTitle = await page.title();
    if (pageTitle.includes('登录') || page.url().includes('login')) {
      log('error', '需要重新登录，请更新 Cookies');
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
