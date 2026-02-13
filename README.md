# 抖音续火花自动发送助手 - GitHub Actions 版本

将原油猴脚本移植到 GitHub Actions，实现自动化续火花功能。

## 功能特性

- ✅ 自动发送续火消息给多个目标用户
- ✅ 集成一言 API
- ✅ 支持专属一言（每天不同的文案）
- ✅ 支持手动文案库
- ✅ 自动记录火花天数
- ✅ 定时任务（每天自动运行）
- ✅ 支持手动触发
- ✅ 完整的日志记录

## 使用前准备

### 1. 获取抖音 Cookies

1. 在浏览器中登录抖音创作者中心：https://creator.douyin.com/
2. 按 F12 打开开发者工具
3. 进入 Application/存储 -> Cookies -> https://creator.douyin.com
4. 导出所有 Cookies（推荐使用 EditThisCookie 插件）
5. 将导出的 JSON 数据保存下来

**Cookies 格式示例：**
```json
[
  {"name": "sessionid", "value": "xxx", "domain": ".douyin.com"},
  {"name": "passport_csrf_token", "value": "xxx", "domain": ".douyin.com"}
]
```

### 2. 配置 GitHub Secrets

在你的 GitHub 仓库中设置以下 Secrets（Settings -> Secrets and variables -> Actions）:

| Secret 名称 | 说明 | 示例 |
|------------|------|------|
| `DOUYIN_COOKIES` | 抖音 Cookies JSON 字符串 | `[{"name":"xxx","value":"xxx",...}]` |
| `TARGET_USERS` | 目标用户列表（每行一个） | `用户1\n用户2\n用户3` |
| `TXT_MANUAL_TEXT` | 手动文案库（可选） | `早安\n晚安` |
| `SPECIAL_MONDAY` | 周一专属文案（可选） | `周一文案1\n周一文案2` |
| `SPECIAL_TUESDAY` | 周二专属文案（可选） | `周二文案1\n周二文案2` |
| `SPECIAL_WEDNESDAY` | 周三专属文案（可选） | `周三文案1\n周三文案2` |
| `SPECIAL_THURSDAY` | 周四专属文案（可选） | `周四文案1\n周四文案2` |
| `SPECIAL_FRIDAY` | 周五专属文案（可选） | `周五文案1\n周五文案2` |
| `SPECIAL_SATURDAY` | 周六专属文案（可选） | `周六文案1\n周六文案2` |
| `SPECIAL_SUNDAY` | 周日专属文案（可选） | `周日文案1\n周日文案2` |
| `MESSAGE_TEMPLATE` | 消息模板（可选） | `——续火——\n\n[TXTAPI]` |

### 3. 克隆本仓库到你的 GitHub

将本项目的文件上传到你自己的 GitHub 仓库。

## 本地测试

在推送代码到 GitHub 之前，建议先在本地测试：

```bash
# 安装依赖
npm install

# 设置环境变量（Windows PowerShell）
$env:DOUYIN_COOKIES = '[{"name":"xxx","value":"xxx"}]'
$env:TARGET_USERS = '用户1\n用户2'

# 设置环境变量（Linux/Mac）
export DOUYIN_COOKIES='[{"name":"xxx","value":"xxx"}]'
export TARGET_USERS='用户1\n用户2'

# 运行脚本
npm start
```

## 定时任务配置

默认配置为每天北京时间 00:01 运行。如需修改，编辑 `.github/workflows/douyin-auto-fire.yml` 文件中的 cron 表达式：

```yaml
schedule:
  # cron 表达式格式：分 时 日 月 周
  # 北京时间 = UTC + 8
  - cron: '1 16 * * *'  # UTC 16:01 = 北京时间 00:01
```

## 消息模板占位符

可以在消息模板中使用以下占位符：

- `[API]` - 一言内容
- `[TXTAPI]` - TXTAPI 内容
- `[专属一言]` - 专属一言内容
- `[天数]` - 火花天数

默认模板：
```
—————每日续火—————
[TXTAPI]
—————每日一言—————
[API]
—————专属一言—————
[专属一言]
```

## 手动触发任务

在 GitHub Actions 页面，点击 "Run workflow" 按钮即可手动触发任务。

## 注意事项

1. **Cookies 有效期**：抖音 Cookies 可能会过期，需要定期更新
2. **风控风险**：请合理使用，避免频繁操作导致账号风控
3. **用户列表**：确保目标用户名与抖音中显示的完全一致
4. **网络环境**：GitHub Actions 在国外服务器运行，访问抖音可能较慢

## 故障排查

### Cookies 过期
- 错误提示：`需要重新登录，请更新 Cookies`
- 解决：重新获取 Cookies 并更新到 Secrets

### 找不到用户
- 错误提示：`未找到用户: xxx`
- 解决：检查用户名是否正确（区分大小写）

### 页面加载超时
- 错误提示：`页面加载超时`
- 解决：可能是网络问题，尝试手动触发重试

## 许可证

MIT License
