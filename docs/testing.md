# 验证说明

验证分为 Node 逻辑、模拟浏览器面板和真实扩展运行三层。某一层通过不代表另一层已经验证，尤其不能从合成 HTML 或模拟下载推断真实后端可用。

## 本地自动检查

```sh
npm ci
npm test
npm run check -- v1.2.0
npm run security:check
npm run build
npm run release:check -- v1.2.0
```

后续版本替换命令中的 tag。`npm test` 运行 Node 内置测试器，没有真实浏览器或外部业务请求。开发环境要求 Node.js 22+。

### 1.2.0 验证结果

本版 `npm test` 43 项全部通过（原有 29 项，加响应模块 14 项），`check`、敏感材料检查、构建与 `release:check -- v1.2.0` 均通过。

使用真实 panel 资源与模拟 DevTools API 的浏览器回归完成 18 组检查，覆盖：

- 五类 JSON token 高亮、“格式化 / 原始”切换、逐字原文复制，以及大整数 / 重复键的无损格式化 JSON 复制。
- Preview 折叠、懒展开、节点 / 容器复制和 100 → 200 → 250 项分页；不安全解析数字拒绝复制。
- 无效 JSON、HTML、标量、二进制与截断状态；截断预览复制约 11 万字符的完整原文，以及超过 20 Mi 字符时明确拒绝。
- Clipboard API 成功、兼容复制成功、两级失败后可见且选中的手动文本，重试不累积复制区域。
- 并发 `getContent` 读取去重、过期读取 / 复制回调隔离，查看和复制均不重放接口。
- 明暗主题、633 / 375 像素面板与 22 px 单行密度。

另在 macOS 隔离 Chrome/133.0.6943.16、localhost 合成服务完成 5 项真实扩展检查：真实 HAR `getContent` 生成高亮，Preview 结构树可用，原文 / 格式化 JSON / 节点三类复制结果与系统剪贴板内容一致。

该真实浏览器中 `navigator.clipboard.writeText` 被拒绝，兼容 `execCommand` 复制成功；未声称已验证该环境的 Clipboard API 成功路径（此路径由模拟检查覆盖）。没有新增权限，也未验证真实业务后端或服务端采样。原始本地运行记录不随公开源码发布；tag 发布后仍需下载远端附件校验。

### 1.1.1 验证结果

本版 `npm test` 29 项全部通过，`check`、敏感材料检查、构建和 `release:check -- v1.1.1` 均通过。

浏览器测试加载真实 panel 资源并使用模拟 DevTools API、52 条合成请求，在 633 × 870 像素面板中比较结果：

| 项目 | 旧布局 | 1.1.1 |
| --- | --- | --- |
| 请求行高度 | 38 px | 22 px |
| 单屏完整请求行 | 19 | 34 |
| 表格滚动宽度 | 700 px | 633 px，无横向溢出 |

1280、633、560、441、440、375 像素宽面板均实测为 22 px 行高且无横向溢出。行悬停完整 URL、Headers URL、内部右键不自动发送、POST 明确重放与下载、键盘选择以及明暗主题均通过。新版文档截图已人工检查，全部使用 `example.test` 合成数据。

本轮是模拟 API 的 UI 回归，不表示重新执行了真实 DevTools 或真实服务端采样验证。正式 tag 发布后仍需下载远端 Release 附件校验；此前真实扩展运行的覆盖范围见下文 1.1.0 记录。

### 1.1.0 本地结果

2026-10-13 在 Node.js v24.14.1 下执行 `npm test`，29 项通过、0 失败：

| 测试组 | 数量 | 主要覆盖 |
| --- | --- | --- |
| `tests.mjs` | 14 | `profile=1`、原查询编码、GET / POST、请求头、UTF-8 body、multipart / 二进制拒绝、报告结构、文件名、取消与无重试 |
| `tests/network.test.mjs` | 8 | 接口名称、未知字段、大小/耗时显示、组合筛选、排序、去重、Waterfall 边界 |
| `scripts/tooling.test.mjs` | 7 | ZIP 确定性/完整性/路径、运行文件白名单、版本与权限、敏感材料规则和不回显秘密 |

同轮 `npm run check -- v1.1.0` 与 `npm run security:check` 通过。前者检查 JavaScript 语法、Manifest、版本与本地资源引用；后者是静态预检，仍需人工审阅图片、Git 历史和附件。首次 GitHub CI 的 Ubuntu / Node.js 22、Ubuntu / Node.js 24、macOS / Node.js 22 三个矩阵均通过。

正式发布的 ZIP / checksum 应在最终文件落盘后重新构建，并下载远端 Release 附件验证；本地检查和 CI 成功不能代替这一步。

## 模拟浏览器面板

本地预览可以注入模拟 `chrome.devtools`、网络记录、`inspectedWindow.eval`、`fetch` 和 `downloads`，再加载真实 `panel.html` / `panel.mjs`，检查表格、筛选、排序、详情、右键、键盘和主题。

1.1.0 已在本地浏览器 smoke 检查中通过以下交互：

- 行右键只打开操作，不重放；确认按钮后 POST 保留完整 body，GET 保留原查询参数。
- Payload、Response、Timing 详情、GET 与组合查询筛选、筛选后键盘焦点和 Time 数值排序。
- 取消后无自动重试或下载，导航时保留/清理日志，清空后忽略已经过期的 HAR 同步回调。
- 暂停录制、300 条列表上限、明暗主题，以及 740 / 375 像素宽面板。

README 图片来自这类预览，所有请求使用 `example.test` 合成数据。图片可说明布局，不证明真实 DevTools API、认证、CORS 或下载权限已经运行成功。模拟 replay 返回的是用于格式校验的合成 HTML，不是服务端采样结果。

当前 `npm test` 不包含整套浏览器端到端运行。浏览器交互验证需另外执行，并明确记录使用模拟 API 还是真实扩展环境。

## 真实扩展验收

1.1.0 已在 macOS 的隔离 Chrome/133.0.6943.16 中完成真实扩展运行验证，本地合成服务的 10 项检查全部通过：

- 真实 `chrome.devtools.network.getHAR` 捕获 GET / POST，请求出现在真实 DevTools 面板中。
- 右键并选择 Profile 不发送请求；点击明确的重放按钮后，GET / POST 分别只发送一次。
- GET 保留原查询参数并追加 `profile=1`；两次重放使用当前模拟 Cookie，POST 保留模拟 CSRF 头与完整 JSON body。
- 真实 `inspectedWindow.eval → fetch → 报告结构检查 → chrome.downloads` 链路保存两份 HTML 文件。

该验证通过 CDP 的下载行为覆盖将文件保存到隔离目录，绕过了 `saveAs` 原生文件选择器；**原生文件选择器交互未验证**。服务仅运行于 localhost，返回合成 Pyinstrument renderer HTML，**没有验证真实 Pyinstrument 采样、业务后端或 Django 集成**。原始本地运行记录不随公开源码发布。

在 Chrome / Edge 扩展管理页加载最终解压包，重开本地演示页的 DevTools，至少验证以下过程：

1. Profile 面板可创建，真实 GET / POST 请求出现在列表；同步与自动记录不重复追加。
2. 名称、完整 URL、方法、状态、耗时及详情与原生 Network 中同一请求一致。
3. 右键和双击仅打开 Profile 操作；点击重放才发送一次，POST body 与可设置请求头正确。
4. 本地服务返回符合契约的 HTML 后，通过真实下载 API 保存文件；JSON、登录页和错误页被拒绝。
5. 暂停、保留日志、清空、取消、导航、主题和窄面板交互符合文档。
6. 从 GitHub Release 下载的 ZIP 与 checksum 一致，解压包的 manifest 版本与 tag 一致。

这份清单是验收要求，不代表每种浏览器和后端组合已经通过。真实服务端 Pyinstrument、登录/CSRF、跨域、Service Worker、iframe 和耗时上限需要在各自的受控环境单独验证；不能使用生产写接口作为自动化测试数据。

发布时只报告已执行的验证，标明浏览器版本、使用本地合成服务还是真实 Pyinstrument 后端，以及未覆盖的情况。
