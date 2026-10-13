# 架构

Profile Downloader 没有扩展后台服务、业务服务器或前端框架。DevTools 为每个被检查页面创建独立的 Profile 面板；重放在该页面上下文执行。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `manifest.json` | Manifest V3 扩展入口、版本和 `downloads` 权限 |
| `devtools.html` / `devtools.js` | 创建 Profile DevTools 面板 |
| `panel.html` / `panel.css` | 紧凑请求表格、详情页签、主题与交互样式 |
| `panel.mjs` | DevTools 事件、录制/同步、选择、详情、右键菜单、重放和下载编排 |
| `network.mjs` | 请求记录展示、筛选、排序和 Network 风格数据转换 |
| `response.mjs` | 安全 JSON 高亮、按需展开的 Preview 树和节点复制视图 |
| `core.mjs` | 重放参数准备、请求执行、报告识别、下载文件名 |
| `tests.mjs` 与测试文件 | 纯函数及合成请求的验证；不依赖真实业务环境 |
| `scripts/` | 本地检查、敏感材料检查和发布打包 |

## 请求记录

`devtools.network.getHAR` 导入已记录的请求，`onRequestFinished` 接收新完成的请求。列表记录保存在面板内存中，去重并限制为 300 条；自身带 `profile` 的请求不进入列表。页面导航时按“保留日志”状态清理或保留记录。请求详情来自 HAR；响应正文仅在打开 Response / Preview 页签或用户主动复制时按需读取。

这是一份 DevTools 网络记录的视图，不是全浏览器后台抓包。原始 Network 当前选中哪一行不会传递到扩展，扩展不能给原生行菜单注入动作。

## 响应展示与复制

面板缓存正文前 102,400 个字符，记录编码和是否截断，并复用并发读取。完整、有效的 JSON 可由 `response.mjs` 渲染为彩色文本和对象 / 数组树；树按需创建子节点，每组 100 项。Response 排版和“复制 JSON”在 token 层工作，保留大整数、重复键和转义的原始写法。Preview / 节点复制使用标准 JavaScript `JSON.parse` 结果，可能有数字精度和重复键语义差异；原始 Response 是精确内容依据。Preview 拒绝复制不安全整数、非有限数字及包含它们的容器。

键和值都通过文本节点输出，不能将响应内容拼入 HTML 执行。截断、无效 JSON 和二进制编码保留明确的状态提示，不构造误导性的完整 JSON 树；二进制复制操作明确标为 Base64 文本。

复制原文或格式化 JSON 时，面板确认目标请求和正文完整性；预览不足则重新读取 DevTools 的原响应，并隔离过期的读取 / 复制回调。复制上限按字符数计算，为 20 × 1024 × 1024；格式化和节点序列化另有 200 层嵌套限制。完整正文不进入持久缓存，复制不重放接口。剪贴板 API 被拒绝时尝试浏览器兼容复制；两种方式都失败则显示已选中的手动复制文本，不能静默报告成功。

## 重放与下载

```mermaid
sequenceDiagram
    participant U as 用户
    participant P as Profile 面板
    participant W as 被检查页面
    participant S as 原请求服务端
    participant D as 浏览器下载
    U->>P: 选择请求，打开 Profile 详情
    U->>P: 点击重放并下载
    P->>P: 校验方法、URL、请求体，准备 profile 参数
    P->>W: inspectedWindow.eval 启动 fetch
    W->>S: 原方法与参数 + profile + 当前登录态
    S-->>W: Pyinstrument HTML 或错误响应
    P->>W: 轮询任务状态
    W-->>P: 状态与响应文本
    P->>P: 检查成功状态和报告标记
    P->>D: downloads.download，选择保存位置
```

`prepare` 只接受 GET / POST 和 HTTP(S)，保留其他查询参数的原编码并添加 `profile=1`，过滤浏览器不允许手动设置的请求头，保留其他头与完整 UTF-8 文本 body，拒绝不完整、非文本、非 UTF-8 或 multipart 请求。`startReplay` 创建独立 `AbortController`，通过 `fetch` 发送一次，设置超时并禁止重定向。面板轮询这一任务，完成后检查成功状态与预期 Pyinstrument HTML 结构、构造本地 Blob 并调用浏览器下载 API。

重放不会执行原页面的按钮、表单逻辑或重新生成令牌，因此它不保证与最初请求完全等价。页面 Service Worker、当前 Cookie、跨域策略及服务端状态都可能影响结果。取消和导航不能保证服务器回滚。

## 维护边界

保持展示代码与重放纯函数清晰分离。请求详情用文本节点渲染；不把请求字段或服务端响应拼进 `innerHTML`，也不在面板内执行报告。若增加权限、持久化、后台执行或新的 HTTP 方法，必须同步评估数据流、测试和用户文档，并按 [发布流程](releasing.md) 发布版本。
