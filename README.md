# Profile Downloader

一款 Chrome / Edge DevTools 扩展：为捕获的 **GET 或 POST** 请求添加 `profile` 参数后重放，下载后端返回的 **Pyinstrument HTML 报告**。

在熟悉的 Network 风格表格里找到接口，查看请求详情，右键进入 Profile 操作并下载调用耗时报告。扩展使用原请求参数和当前页面的登录状态；后端需要事先支持 Pyinstrument 报告响应。

![使用合成请求展示的 Profile 面板](docs/images/network-panel.png)

预览仅使用 `example.test` 合成演示数据。

## 安装

1. 从[版本发布页](https://github.com/abbhb/profile-downloader/releases)下载 ZIP 并解压。
2. 打开 `chrome://extensions` 或 `edge://extensions`，启用“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择含 `manifest.json` 的解压目录。
4. 重新打开目标页面的 DevTools，选择 **Profile**；该标签可能收在 `»` 中。

也可以直接克隆本仓库，将包含 `manifest.json` 的项目目录作为已解压扩展加载，无需构建。本项目通过 ZIP 分发已解压扩展，不通过浏览器扩展商店发布。

## 使用

1. 在被检查页面触发请求，或同步 DevTools 已记录的请求。
2. 通过默认 22 px 单行列表、排序和筛选找到接口。悬停请求行或打开 Headers 可查看完整 URL；窄列表会自适应调整可见列。
3. 选择请求，查看 Headers、Payload、Response、Preview 和 Timing。JSON 响应支持语法高亮和可折叠结构树，可一键复制原文、格式化 JSON 或节点值。
4. 在 **Profile 面板内部**右键请求，进入 Profile 操作，再点击重放按钮，发送一次请求并保存 HTML 报告。

**POST 重放会再次执行业务操作。** 取消会尽可能中止浏览器请求，无法回滚服务器已经执行的操作。

响应预览保留前 102,400 个字符。Response 排版保留 JSON 的原始写法；Preview 使用 JavaScript 解析，大整数精度和重复键的精确内容应以 Response 为准。全文复制按需读取已记录的响应，最多允许 20 × 1024 × 1024 个字符；剪贴板写入失败会明确提示。详见[响应查看与复制](docs/usage.md#查看与复制响应)。

Chrome 公开扩展 API 不支持给原生 Network 请求行添加右键菜单，也不能读取其当前选中项。因此本项目提供独立的 Profile DevTools 面板，并在该面板内提供 Network 风格列表和右键操作。详见 [API 边界](docs/compatibility.md)。

## 适用技术栈

| 层次 | 支持范围 |
| --- | --- |
| 浏览器 | 支持 Manifest V3 DevTools API 的桌面 Chrome 和基于 Chromium 的 Microsoft Edge |
| 扩展 | 原生 JavaScript ES modules、HTML、CSS；不依赖前端框架或运行时第三方包 |
| 请求 | 可查看 HTTP(S) 请求；可重放具有完整 UTF-8 JSON、URL 编码表单或文本请求体的 GET / POST |
| 后端 | 收到 `profile` 查询参数时，能够返回成功的 Pyinstrument HTML 响应的 Python 应用 |
| 开发工具 | Node.js 22+ 用于本地检查、测试和打包；Git 与 GitHub CLI 用于发布 |

Django 可以使用 Pyinstrument 的 `ProfilerMiddleware`；Flask、FastAPI 等应用需要自行提供兼容集成。`BKAPP_OPEN_PYINSTRUMENT` 是部分应用封装的配置，**不是 Pyinstrument 或本扩展的通用开关**。扩展不会安装服务端性能分析器，也不能自动分析任意后端。详见[后端接入](docs/compatibility.md#后端契约)。

不支持重放 multipart、文件上传、二进制或非 UTF-8 请求体、请求体缺失的 POST，以及 GET / POST 之外的方法。重放在被检查页面的顶层上下文执行，仍受 CORS、CSP、认证和 CSRF 校验限制。详见[使用说明与限制](docs/usage.md)。

## 隐私

扩展仅申请 `downloads` 权限，没有统计上报、远程扩展服务或持久化请求存储。请求数据保留在面板内存；用户主动重放时，向原始目标发送添加了 `profile` 的请求，报告通过浏览器下载流程保存。请求头、请求体和报告可能包含敏感信息，请勿将真实抓包或报告上传到公开仓库。详见[数据流与隐私](docs/privacy.md)。

## 开发

```sh
npm test
npm run check
npm run security:check
npm run build
npm run release:check
```

测试使用合成数据和本地测试样例。构建生成 `dist/profile-downloader-<version>.zip` 及 SHA-256 校验文件。另见[验证范围](docs/testing.md)、[架构](docs/architecture.md)、[贡献指南](CONTRIBUTING.md)、[发布流程](docs/releasing.md)和[项目指引](AGENTS.md)。

本项目采用 [MIT 许可证](LICENSE)。Pyinstrument 与各浏览器均为独立项目，本扩展与其没有隶属关系。
