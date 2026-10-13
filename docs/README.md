# 文档

Profile Downloader 是浏览器 DevTools 扩展：从已记录的请求里选择 GET / POST，添加 `profile` 查询参数后重放，下载后端返回的 Pyinstrument HTML。

| 文档 | 内容 |
| --- | --- |
| [使用说明](usage.md) | 安装、查找接口、右键重放、下载和排障 |
| [兼容性与后端](compatibility.md) | 技术栈、原生 Network 菜单限制、Pyinstrument 后端契约 |
| [架构](architecture.md) | 文件职责、请求采集和重放数据流 |
| [验证说明](testing.md) | Node 测试、模拟浏览器检查与真实扩展验证的区分 |
| [隐私与开源检查](privacy.md) | 权限、内存数据、公开仓库材料边界 |
| [发布流程](releasing.md) | 检查、版本、tag、GitHub Release 和远端验证 |

开发约定见 [CONTRIBUTING.md](../CONTRIBUTING.md) 与 [AGENTS.md](../AGENTS.md)。
