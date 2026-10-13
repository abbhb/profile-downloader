# 兼容性与后端

## 技术栈

扩展使用 Manifest V3、原生 JavaScript ES modules、HTML、CSS，以及 `chrome.devtools.*` 和 `chrome.downloads`。无需 React、Vue、构建运行时或扩展服务器。

桌面 Chrome 与基于 Chromium 的 Microsoft Edge 是目标浏览器；项目依赖 DevTools 扩展 API，不宣称支持 Firefox、Safari、移动浏览器或任何特定浏览器的所有旧版本。Node.js 仅用于开发检查和发布打包，不安装到业务后端。Edge 的扩展 API 支持情况参见 [Microsoft 官方列表](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support)。

扩展查看所有 HTTP(S) 方法的请求；目前可重放的方法是 GET 和 POST。UTF-8 JSON、URL 编码表单、文本 body 需要 DevTools 提供完整内容。文件上传、multipart、二进制、非 UTF-8、已编码或缺失的请求体及其他 HTTP 方法不做猜测重放。

## 原生 Network 右键菜单的边界

公开的 `chrome.devtools.network` 提供网络记录、请求完成事件和导航事件；它没有提供原生 Network 请求行的选中事件或注入右键菜单的接口。普通 `chrome.contextMenus` 面向网页等公开上下文，不能扩展内置 DevTools 的请求行菜单。

因此当前入口是独立的 **Profile** 面板，使用紧凑 Network 风格表格，在面板内右键某个请求打开 Profile 操作。不能声称已经实现“原生 Network 右键 → 自动选中并跳转 Profile”。不使用向 DevTools 内部界面注入脚本的方式绕过这项限制。

自定义扩展面板的激活与 Network 入口是两件事：较新 Chrome 提供 `ExtensionPanel.show()`，但它不提供原生请求菜单或原生选中项。因此本项目无需通过激活面板 API 来声称实现该入口。

官方接口说明：[DevTools Network](https://developer.chrome.com/docs/extensions/reference/api/devtools/network)、[DevTools Panels](https://developer.chrome.com/docs/extensions/reference/api/devtools/panels)、[Context Menus](https://developer.chrome.com/docs/extensions/reference/api/contextMenus#type-ContextType)。

## 后端契约

扩展不是服务端 profiler。服务端必须在收到 `profile` 参数时实际执行采样，并用成功的 HTML 响应替换业务响应。普通 JSON、登录跳转或错误 HTML 不会自动变成报告。

扩展保留其他查询参数及其原始编码，添加或替换 `profile=1`。服务端可以按参数存在性或该值判断是否启用。给签名 URL 添加参数仍可能使签名失效；这种接口需要服务端提供支持 profiling 的签名方式，扩展不能重签名。

### Django

安装 Pyinstrument 后，将 `pyinstrument.middleware.ProfilerMiddleware` 加入最终生效的 `MIDDLEWARE`，并根据应用环境限制报告访问。官方 Django 集成支持通过 `?profile` 返回调用耗时 HTML；访问控制可通过 `PYINSTRUMENT_SHOW_CALLBACK` 定制。参见 [Pyinstrument 官方指南](https://pyinstrument.readthedocs.io/en/stable/guide.html#profile-a-web-request-in-django)。

```python
# 示例：在应用自己的 Django settings 中配置，保留已有中间件。
MIDDLEWARE = [
    "pyinstrument.middleware.ProfilerMiddleware",
    *MIDDLEWARE,
]
```

检查后续 settings 逻辑是否重新赋值 `MIDDLEWARE` 并覆盖了该配置。某些项目封装了 `BKAPP_OPEN_PYINSTRUMENT` 开关；它属于那些应用的配置，不是 Pyinstrument 的通用配置，也不是使用本扩展的统一前提。

### Flask、FastAPI 和其他框架

需要自行提供“识别参数 → 采样请求 → 返回 Pyinstrument HTML”的集成。框架名称本身不代表已兼容；请先用合成 GET / POST 验证返回契约。异步与线程执行的覆盖范围取决于 profiler 的集成方式，扩展无法补齐服务端采样范围。

## 浏览器上下文

重放通过 `inspectedWindow.eval` 在被检查页面的顶层 JavaScript 上下文执行 `fetch`，使用 `credentials: 'include'`。可设置的原请求头会保留；Cookie、Host、Origin、`Sec-*` 等头由浏览器管理或过滤。当前登录状态可能已不同于原请求发生时。

CORS、CSP、SameSite Cookie、CSRF 校验和页面 Service Worker 仍会影响重放。iframe 专属登录态或 frame 专属执行上下文不保证可复现。浏览器会拒绝重定向，避免把登录跳转作为报告下载。

相关 API：[Inspected Window](https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow)、[Downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads)。
