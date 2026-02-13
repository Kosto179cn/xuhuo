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

// 查找并点击用户 (优化版：增加调试日志和精准定位)
async function findAndClickUser(page, username) {
  // log('info', `正在查找用户: ${username}`); // 减少刷屏

  try {
    // 1. 尝试直接使用 Playwright 的文本定位器 (最准确，忽略 class 变化)
    // 使用 exact: true 确保完全匹配，防止"张三"匹配到"张三丰"
    const userLocator = page.getByText(username, { exact: true });

    // 检查是否可见
    if (await userLocator.isVisible()) {
        log('success', `通过文本定位找到用户: ${username}`);
        await userLocator.click();
        return true;
    }

    // 2. 如果上面的没找到，打印当前屏幕上看到了谁 (用于调试)
    // 这一步非常重要，能帮你确认是因为名字写错了，还是真的没加载出来
    const visibleNames = await page.$$eval('[class*="item-header-name-"]', elements =>
      elements.map(el => el.textContent.trim())
    );
    // 只在第一次滚动时打印，避免日志太长
    if (global.debugLogCounter === undefined || global.debugLogCounter < 1) {
       log('info', `当前屏幕可见用户: ${visibleNames.join(', ')}`);
       global.debugLogCounter = (global.debugLogCounter || 0) + 1;
    }

    return false;
  } catch (error) {
    // 忽略定位超时的错误，继续滚动
    return false;
  }
}

// 滚动查找用户 (优化版：使用鼠标滚轮触发虚拟列表加载)
async function scrollAndFindUser(page, username) {
  log('info', `开始滚动查找用户: ${username}`);

  // 重置调试计数器
  global.debugLogCounter = 0;

  const maxScrolls = 50; // 增加滚动次数，虚拟列表可能很长
  let scrollCount = 0;

  // 定位滚动容器 (根据你的 HTML 结构)
  const gridSelector = '.ReactVirtualized__Grid';

  // 确保容器存在
  try {
    await page.waitForSelector(gridSelector, { timeout: 5000 });
  } catch (e) {
    log('error', '未找到聊天列表容器，无法滚动');
    return false;
  }

  while (scrollCount < maxScrolls) {
    // 1. 先尝试查找并点击
    const found = await findAndClickUser(page, username);
    if (found) {
      return true;
    }

    // 2. 执行滚动 (关键修改：使用鼠标滚轮)
    try {
      // 获取列表容器的位置
      const box = await page.locator(gridSelector).boundingBox();
      if (box) {
        // 将鼠标移动到列表中心
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        // 模拟鼠标滚轮向下滚动 (X, Y)
        await page.mouse.wheel(0, 600);

        // 3. 等待 React 渲染新行 (虚拟列表需要时间加载 DOM)
        // 如果网速慢或电脑卡，可以适当增加这个时间
        await page.waitForTimeout(1000);
      } else {
        log('warn', '无法获取列表位置，尝试使用键盘翻页');
        await page.keyboard.press('PageDown');
        await page.waitForTimeout(1000);
      }
    } catch (error) {
      log('warn', `滚动时出错: ${error.message}`);
    }

    scrollCount++;
  }

  log('warn', `已滚动到底或达到最大次数，仍未找到用户: ${username}`);
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
    const hasContent = await page.$('[class*="item-header-name-"]');
    if (!hasContent) {
      log('warn', '页面未检测到聊天列表，可能需要滚动等待');
      await page.waitForTimeout(5000);
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
