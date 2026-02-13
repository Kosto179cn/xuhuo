/**
 * 油猴脚本数据导出工具
 * 用于在浏览器控制台中导出抖音续火花助手的所有存储数据
 * 
 * 使用方法：
 * 1. 在抖音创作者中心聊天页面打开开发者工具（F12）
 * 2. 进入 Console 标签
 * 3. 粘贴此脚本并回车
 * 4. 下载数据文件
 */

(function() {
  console.log('正在读取油猴脚本存储数据...\n');

  // 检测是否安装了油猴扩展
  if (typeof GM_getValue === 'undefined') {
    console.error('❌ 未检测到油猴扩展 API');
    console.log('请确保已安装 Tampermonkey、Violentmonkey 或 ScriptCat');
    return;
  }

  const data = {};

  // 读取所有数据
  const keys = [
    'userConfig',
    'sentUsersToday',
    'currentUserIndex',
    'fireDays',
    'lastFireDate',
    'lastSentDate',
    'historyLogs',
    'specialHitokotoSentIndexes',
    'txtApiManualSentIndexes',
    'retryCount',
    'isMaxRetryReached',
    'lastRetryResetTime',
    'lastResetDate',
    'firstSendTimeToday',
    'lastTargetUser'
  ];

  keys.forEach(key => {
    try {
      const value = GM_getValue(key);
      data[key] = value;
      console.log(`✅ ${key}:`, value);
    } catch (e) {
      console.warn(`⚠️  ${key}: 读取失败`, e);
    }
  });

  // 生成 JSON 文件
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  // 创建下载链接
  const a = document.createElement('a');
  a.href = url;
  a.download = `douyin-fire-data-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log('\n' + '='.repeat(50));
  console.log('✅ 数据已导出！');
  console.log('='.repeat(50));
  console.log('\n重点数据说明：');
  console.log('📋 targetUsernames (目标用户列表):', data.userConfig?.targetUsernames || '未设置');
  console.log('📋 sentUsersToday (今日已发送):', data.sentUsersToday || '未设置');
  console.log('🔢 fireDays (火花天数):', data.fireDays || 1);
  console.log('📅 lastFireDate (上次续火日期):', data.lastFireDate || '未设置');
  
  // 尝试复制用户列表到剪贴板
  if (data.userConfig?.targetUsernames) {
    navigator.clipboard.writeText(data.userConfig.targetUsernames).then(() => {
      console.log('\n✅ 用户列表已复制到剪贴板！');
      console.log('可以直接粘贴到 GitHub Actions 的 users.txt 文件中');
    }).catch(err => {
      console.log('\n⚠️  无法自动复制，请手动复制 targetUsernames 的值');
    });
  }
})();
