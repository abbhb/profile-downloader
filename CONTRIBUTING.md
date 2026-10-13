# 贡献指南

欢迎提交问题和改进。提交前请阅读 [架构](docs/architecture.md)、[兼容性](docs/compatibility.md) 和 [发布流程](docs/releasing.md)。

## 本地开发

本项目使用原生 JavaScript ES modules、HTML 和 CSS。无需前端打包即可从源码目录加载扩展。安装 Node.js 22 或更高版本，再运行：

```sh
npm test
npm run check
npm run security:check
npm run build
npm run release:check
```

在 Chrome / Edge 的扩展管理页重新加载扩展，然后关闭并重新打开目标页面的 DevTools。浏览器测试使用本地演示服务和合成请求；不得把测试指向真实业务接口。

## 提交要求

- 改动必须与公开的 DevTools API 能力一致，不使用 DevTools 内部页面注入或未公开接口。
- 保留原 GET / POST 参数、请求体、CSRF 和可设置的认证头；缺少数据时应明确拒绝，而不是构造不完整请求。
- 不增加自动重放、后台重试、统计上报或持久化敏感请求数据。
- 新功能或行为变更同步更新 README、相关 docs 和 CHANGELOG；对公开版本按 [发布流程](docs/releasing.md) 更新版本、tag 和 Release。
- 新增测试使用 `example.test`、localhost 和明确的模拟值；先验证测试不触发外部副作用。
- 不提交真实 HAR、profile HTML、下载文件、环境文件、内部截图、内网地址、个人邮箱、Cookie、令牌或密钥。

问题描述请给出浏览器版本、扩展版本、可复现步骤和脱敏后的响应类型。重现认证或请求体问题时，请使用最小合成样例，不要直接粘贴 Copy as cURL 或完整请求头。

安全问题请勿在公开 Issue 贴出秘密或可识别的业务请求；可以先用不含秘密的最小描述联系仓库维护者。
