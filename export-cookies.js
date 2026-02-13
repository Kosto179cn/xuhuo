/**
 * 本地辅助脚本：用于在浏览器控制台中导出抖音 Cookies
 * 
 * 使用方法：
 * 1. 在浏览器中登录 https://creator.douyin.com/
 * 2. 按 F12 打开开发者工具，进入 Console 标签
 * 3. 将此脚本的全部内容复制粘贴到控制台中并回车
 * 4. 复制输出的 JSON 字符串，保存到 GitHub Secrets 中
 */

(function() {
  console.log('正在提取 Cookies...');
  
  // 获取当前域名的所有 Cookies
  const cookies = [];
  
  // 获取文档中的 Cookies
  if (document.cookie) {
    const cookiePairs = document.cookie.split(';');
    cookiePairs.forEach(pair => {
      const [name, value] = pair.trim().split('=');
      cookies.push({
        name: name,
        value: value,
        domain: window.location.hostname,
        path: '/',
        httpOnly: false,
        secure: window.location.protocol === 'https:',
        sameSite: 'Lax'
      });
    });
  }
  
  // 输出结果
  console.log('提取到的 Cookies:');
  console.log(JSON.stringify(cookies, null, 2));
  
  // 复制到剪贴板
  const jsonString = JSON.stringify(cookies);
  navigator.clipboard.writeText(jsonString).then(() => {
    console.log('\n✅ Cookies JSON 已复制到剪贴板！');
    console.log('现在你可以将其粘贴到 GitHub Secrets 中，Secret 名称：DOUYIN_COOKIES');
  }).catch(err => {
    console.log('\n⚠️ 无法自动复制，请手动复制上面的 JSON 字符串');
  });
  
  console.log('\n使用方法：');
  console.log('1. 将上面的 JSON 字符串复制');
  console.log('2. 进入 GitHub 仓库 Settings -> Secrets and variables -> Actions');
  console.log('3. 点击 "New repository secret"');
  console.log('4. Name: DOUYIN_COOKIES');
  console.log('5. Secret: 粘贴刚才复制的 JSON 字符串');
})();
