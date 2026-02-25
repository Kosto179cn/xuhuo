const { chromium } = require('playwright');
const pLimit = require('p-limit');
const fs = require('fs').promises;
const path = require('path');

// 配置区
const CONFIG = {
  CONCURRENCY: 5, // 并发数，可根据服务器性能调整
  TIMEOUT: 30000, // 单用户处理超时时间（毫秒）
  RETRY_TIMES: 2, // 失败重试次数
  USERS_FILE: path.join(__dirname, 'users.txt'),
  GITEE_REPO: '你的Gitee仓库地址',
  SELECTORS: {
    userItem: '[data-testid="user-item"]', // 抖音私信页用户项选择器
    userName: '[data-testid="user-name"]', // 用户名选择器
    userId: '[data-testid="user-id"]', // 用户ID选择器
  }
};

// 并发控制
const limit = pLimit(CONFIG.CONCURRENCY);

// 带重试的异步函数包装
const withRetry = async (fn, retries = CONFIG.RETRY_TIMES) => {
  try {
    return await fn();
  } catch (error) {
    if (retries > 0) {
      console.log(`重试中 (剩余 ${retries} 次):`, error.message);
      return withRetry(fn, retries - 1);
    }
    throw error;
  }
};

// 带超时的异步函数包装
const withTimeout = (fn, timeout = CONFIG.TIMEOUT) => {
  return Promise.race([
    fn(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('操作超时')), timeout)
    )
  ]);
};

// 从Gitee拉取目标抖音号列表
const fetchTargetAccounts = async () => {
  console.log('正在从Gitee拉取目标抖音号列表...');
  // 这里替换为你的Gitee API调用逻辑
  const targetAccounts = [
    // 示例: { id: '123456', name: '测试账号' }
  ];
  console.log(`成功拉取到 ${targetAccounts.length} 个目标抖音号`);
  return targetAccounts;
};

// 处理单个用户
const processUser = async (page, userItem) => {
  return withTimeout(async () => {
    // 点击用户项进入详情页
    await userItem.click();
    await page.waitForSelector(CONFIG.SELECTORS.userName, { state: 'visible' });
    
    // 提取用户信息
    const userName = await page.$eval(CONFIG.SELECTORS.userName, el => el.textContent.trim());
    const userId = await page.$eval(CONFIG.SELECTORS.userId, el => el.textContent.trim());
    
    // 返回用户信息
    return { id: userId, name: userName };
  });
};

// 全量遍历用户列表
const traverseUsers = async (page) => {
  console.log('开始全量遍历用户列表...');
  const users = [];
  let processedCount = 0;
  
  while (true) {
    // 获取当前可见的用户项
    const userItems = await page.$$(CONFIG.SELECTORS.userItem);
    
    if (userItems.length === 0) {
      console.log('没有更多用户可处理');
      break;
    }
    
    // 并发处理当前页用户
    const tasks = userItems.map(item => 
      limit(() => withRetry(() => processUser(page, item)))
    );
    
    const results = await Promise.allSettled(tasks);
    
    // 处理结果
    for (const result of results) {
      if (result.status === 'fulfilled') {
        users.push(result.value);
        processedCount++;
        console.log(`已处理 ${processedCount} 个用户:`, result.value);
      } else {
        console.error('处理用户失败:', result.reason);
      }
    }
    
    // 滚动加载更多用户
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(1000); // 等待加载
  }
  
  console.log(`全量遍历完成，累计处理 ${processedCount} 个用户`);
  return users;
};

// 主函数
const main = async () => {
  console.log('🚀 启动抖音用户全量同步脚本');
  
  // 读取环境变量
  const { GITEE_TOKEN, DOUYIN_COOKIES, DEBUG } = process.env;
  if (!GITEE_TOKEN || !DOUYIN_COOKIES) {
    throw new Error('缺少必要的环境变量 GITEE_TOKEN 或 DOUYIN_COOKIES');
  }
  console.log('✅ 环境变量读取完成，Gitee Token长度:', GITEE_TOKEN.length);
  
  // 拉取目标账号
  const targetAccounts = await fetchTargetAccounts();
  
  // 启动无头浏览器
  console.log('🌐 正在启动无头浏览器...');
  const browser = await chromium.launch({
    headless: 'new', // 使用新版无头模式
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  // 注入Cookie
  const cookies = JSON.parse(DOUYIN_COOKIES);
  await context.addCookies(cookies);
  
  const page = await context.newPage();
  console.log('✅ 浏览器启动完成，Cookie已注入');
  
  try {
    // 进入抖音创作者中心私信页面
    console.log('🌐 正在进入抖音创作者中心私信页面，等待页面加载...');
    await page.goto('https://creator.douyin.com/message/chat', { waitUntil: 'networkidle' });
    await page.waitForSelector(CONFIG.SELECTORS.userItem, { state: 'visible' });
    console.log('✅ 页面加载完成，用户列表已渲染，开始全量遍历');
    
    // 全量遍历用户
    const users = await traverseUsers(page);
    
    // 写入文件
    const content = users.map(u => `${u.id}:${u.name}`).join('\n');
    await fs.writeFile(CONFIG.USERS_FILE, content, 'utf8');
    console.log('✅ users.txt 文件已成功生成/更新');
    
  } catch (error) {
    console.error('❌ 脚本执行失败:', error);
    throw error;
  } finally {
    await browser.close();
  }
};

// 执行主函数
main().catch(err => {
  console.error('❌ 脚本异常退出:', err);
  process.exit(1);
});
