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
  PRE_SCRIPT_WAIT: 30000,
  // 新增：等待聊天详情加载的时间（毫秒）
  CHAT_PANE_WAIT: 1500,
};

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  // 设置你的 Cookie
  await context.addCookies([
    {
      name: 's_v_web_id',
      value: 'your_s_v_web_id',
      domain: '.douyin.com',
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'None',
    },
  ]);

  const page = await context.newPage();
  await page.goto(CONFIG.CREATOR_CHAT_URL, { timeout: CONFIG.GOTO_TIMEOUT });

  console.log('等待页面加载...');
  await page.waitForTimeout(5000);

  // 存储用户数据
  const allUsers = [];

  // 获取已有的用户数据
  let existingUsers = {};
  try {
    const data = fs.readFileSync(CONFIG.LOCAL_USERS_JSON, 'utf8');
    existingUsers = JSON.parse(data);
  } catch (err) {
    console.log('没有找到本地用户数据文件，将创建新文件。');
  }

  // 滚动加载更多用户
  let scrollAttempts = 0;
  let lastUserCount = 0;
  let noNewUserCount = 0;

  while (scrollAttempts < CONFIG.MAX_SCROLL_ATTEMPTS) {
    // 获取当前可见的用户列表
    const users = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.chat-item')); // 根据截图，这是列表项的类名
      return items.map(item => {
        // 提取昵称
        const nicknameEl = item.querySelector('.nickname'); // 假设昵称类名是 nickname
        const nickname = nicknameEl ? nicknameEl.innerText.trim() : '未知昵称';

        // 提取头像
        const avatarEl = item.querySelector('.avatar');
        const avatar = avatarEl ? avatarEl.src : '';

        // 提取聊天时间（根据截图，时间在昵称右侧）
        const timeEl = item.querySelector('.chat-time'); // 假设时间类名是 chat-time
        const lastChatTime = timeEl ? timeEl.innerText.trim() : '未知时间';

        return {
          nickname,
          avatar,
          lastChatTime, // 新增的时间字段
        };
      });
    });

    if (users.length === 0) {
      console.log('未找到用户列表元素，尝试滚动...');
      await page.evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
      await page.waitForTimeout(1000);
      scrollAttempts++;
      continue;
    }

    // 去重并添加新用户
    let newUserCount = 0;
    for (const user of users) {
      const key = user.nickname; // 用昵称作为唯一标识
      if (!existingUsers[key]) {
        existingUsers[key] = user;
        allUsers.push(user);
        newUserCount++;
      }
    }

    if (newUserCount === 0) {
      noNewUserCount++;
      if (noNewUserCount >= CONFIG.MAX_NO_NEW_USER_COUNT) {
        console.log('连续多次未发现新用户，停止滚动。');
        break;
      }
    } else {
      noNewUserCount = 0;
    }

    console.log(`找到 ${users.length} 个用户，新增 ${newUserCount} 个。`);
    lastUserCount = users.length;

    // 滚动到底部
    await page.evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
    await page.waitForTimeout(2000);
    scrollAttempts++;
  }

  // 保存数据到本地
  fs.writeFileSync(CONFIG.LOCAL_USERS_JSON, JSON.stringify(existingUsers, null, 2));
  console.log(`成功提取 ${allUsers.length} 个新用户数据。`);

  // 上传到 Gitee
  try {
    const giteeToken = process.env.GITEE_TOKEN || 'your_gitee_token';
    const giteeRepo = 'Kosto179/kosto-battle-clicker-new';
    const giteePath = 'douyin_all_users.json';

    const giteeResponse = await axios.get(CONFIG.GITEE_JSON_URL, {
      headers: {
        Authorization: `token ${giteeToken}`,
      },
    });

    const sha = giteeResponse.data.sha;

    await axios.put(`https://gitee.com/api/v5/repos/${giteeRepo}/contents/${giteePath}`, {
      message: '更新用户数据',
      content: Buffer.from(JSON.stringify(existingUsers, null, 2)).toString('base64'),
      sha,
    }, {
      headers: {
        Authorization: `token ${giteeToken}`,
      },
    });

    console.log('用户数据已成功上传到 Gitee。');
  } catch (err) {
    console.error('上传到 Gitee 失败：', err);
  }

  await browser.close();
}

main().catch(err => console.error(err));
