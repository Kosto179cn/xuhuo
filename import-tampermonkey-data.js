/**
 * 油猴脚本数据导入工具
 * 用于将导出的数据导入到油猴脚本中
 * 
 * 使用方法：
 * 1. 打开抖音创作者中心聊天页面
 * 2. 按 F12 打开开发者工具，进入 Console 标签
 * 3. 粘贴此脚本并回车
 * 4. 按提示操作
 */

(function() {
  console.log('油猴脚本数据导入工具\n');
  
  // 检测 API
  if (typeof GM_setValue === 'undefined') {
    console.error('❌ 未检测到油猴扩展 API');
    return;
  }

  // 创建文件选择器
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';

  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        console.log('读取到的数据:', Object.keys(data));

        let successCount = 0;
        let failCount = 0;

        // 导入每个键值对
        for (const [key, value] of Object.entries(data)) {
          try {
            GM_setValue(key, value);
            successCount++;
            console.log(`✅ ${key}`);
          } catch (e) {
            failCount++;
            console.warn(`⚠️  ${key}: 导入失败`, e);
          }
        }

        console.log('\n' + '='.repeat(50));
        console.log(`✅ 导入完成！成功: ${successCount}, 失败: ${failCount}`);
        console.log('='.repeat(50));
        console.log('\n刷新页面以使更改生效');

      } catch (e) {
        console.error('❌ 解析 JSON 文件失败:', e);
      }
    };

    reader.readAsText(file);
  };

  // 触发文件选择
  input.click();
})();
