/**
 * 辅助脚本：自动抓取抖音聊天列表中的用户并生成 users.txt
 *
 * 使用方法：
 * 1. 在浏览器中登录 https://creator.douyin.com/creator-micro/data/following/chat
 * 2. 按 F12 打开开发者工具，进入 Console 标签
 * 3. 滚动聊天列表，确保所有需要的好友都已加载
 * 4. 将此脚本的全部内容复制粘贴到控制台中并回车
 * 5. 将输出的内容复制到 users.txt 文件中
 */

(function() {
  console.log('正在提取聊天用户列表...\n');

  // 查找所有用户名元素
  const userElements = document.querySelectorAll('[class*="item-header-name-"]');

  if (userElements.length === 0) {
    console.log('⚠️ 未找到用户元素，请确保：');
    console.log('  1. 已在正确的页面（抖音创作者中心聊天页面）');
    console.log('  2. 聊天列表已加载完成');
    console.log('  3. 滚动列表确保所有用户都已加载');
    return;
  }

  // 提取用户名
  const users = [];
  const seen = new Set();

  userElements.forEach(element => {
    const username = element.textContent.trim();
    if (username && !seen.has(username)) {
      seen.add(username);
      users.push(username);
    }
  });

  // 生成 users.txt 格式
  let output = `# 目标用户列表\n`;
  output += `# 共 ${users.length} 个用户\n`;
  output += `# 生成时间: ${new Date().toLocaleString()}\n`;
  output += `# 每行一个用户名，前面带 # 的为注释行\n`;
  output += `# 空行会被忽略\n\n`;

  users.forEach(user => {
    output += `${user}\n`;
  });

  console.log('='.repeat(50));
  console.log(`✅ 成功提取 ${users.length} 个用户`);
  console.log('='.repeat(50));
  console.log('\n用户列表：');
  console.log(users.map((u, i) => `${i + 1}. ${u}`).join('\n'));
  console.log('\n' + '='.repeat(50));
  console.log('以下内容可直接复制到 users.txt 文件中：');
  console.log('='.repeat(50) + '\n');
  console.log(output);

  // 尝试复制到剪贴板
  navigator.clipboard.writeText(output).then(() => {
    console.log('\n✅ 内容已复制到剪贴板！');
    console.log('现在你可以：');
    console.log('  1. 在本地创建 users.txt 文件');
    console.log('  2. 粘贴刚才复制的内容');
    console.log('  3. 提交到 GitHub 仓库');
  }).catch(err => {
    console.log('\n⚠️ 无法自动复制，请手动复制上面的内容');
  });

  // 可选：下载文件
  const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'users.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log('📥 文件已自动下载：users.txt');
})();
