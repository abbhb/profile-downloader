# 验证说明

验证分为 Node 逻辑、模拟浏览器面板和真实扩展运行三层。某一层通过不代表另一层已经验证，尤其不能从合成 HTML 或模拟下载推断真实后端可用。

## 本地自动检查

```sh
npm ci
npm test
npm run check -- v1.1.0
npm run security:check
npm run build
npm run release:check -- v1.1.0
```

后续版本替换命令中的 tag。`npm test` 运行 Node 内置测试器，没有真实浏览器或外部业务请求。开发环境要求 Node.js 22+。

### 1.1.0 本地结果

2026-10-13 在 Node.js v24.14.1 下执行 `npm test`，29 项通过、0 失败：

| 测试组 | 数量 | 主要覆盖 |
| --- | --- | --- |
| `tests.mjs` | 14 | `profile=1`、原查询编码、GET / POST、请求头、UTF-8 body、multipart / 二进制拒绝、报告结构、文件名、取消与无重试 |
| `tests/network.test.mjs` | 8 | 接口名称、未知字段、大小/耗时显示、组合筛选、排序、去重、Waterfall 边界 |
| `scripts/tooling.test.mjs` | 7 | ZIP 确定性/完整性/路径、运行文件白名单、版本与权限、敏感材料规则和不回显秘密 |

同轮 `npm run check -- v1.1.0` 与 `npm run security:check` 通过。前者检查 JavaScript 语法、Manifest、版本与本地资源引用；后者是静态预检，仍需人工审阅图片、Git 历史和附件。正式发布的 ZIP / checksum 校验应在最终文件落盘后再次完成。

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

在 Chrome / Edge 扩展管理页加载最终解压包，重开本地演示页的 DevTools，至少验证以下过程：

1. Profile 面板可创建，真实 GET / POST 请求出现在列表；同步与自动记录不重复追加。
2. 名称、完整 URL、方法、状态、耗时及详情与原生 Network 中同一请求一致。
3. 右键和双击仅打开 Profile 操作；点击重放才发送一次，POST body 与可设置请求头正确。
4. 本地服务返回符合契约的 HTML 后，通过真实下载 API 保存文件；JSON、登录页和错误页被拒绝。
5. 暂停、保留日志、清空、取消、导航、主题和窄面板交互符合文档。
6. 从 GitHub Release 下载的 ZIP 与 checksum 一致，解压包的 manifest 版本与 tag 一致。

这份清单是验收要求，不代表每种浏览器和后端组合已经通过。真实服务端 Pyinstrument、登录/CSRF、跨域、Service Worker、iframe 和耗时上限需要在各自的受控环境单独验证；不能使用生产写接口作为自动化测试数据。

发布时只报告已执行的验证，标明浏览器版本、使用本地合成服务还是真实 Pyinstrument 后端，以及未覆盖的情况。
