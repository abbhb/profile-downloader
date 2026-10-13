# 发布流程

用户可见的功能、行为和修复需要随本次工作及时完成版本、tag 与 GitHub Release。仅本地改完代码或 push 分支不算发布完成。仓库地址为 [abbhb/profile-downloader](https://github.com/abbhb/profile-downloader)，公开发布不等于上架 Chrome Web Store 或 Edge Add-ons。

## 文档与发布说明语言

README、版本日志、用户文档和 Release 标题、正文统一使用中文，产品名、技术名称、代码标识、命令及实际界面标签保留原文。不要使用中英双标题或夹杂英文正文。需要双语时，提供分别组织、内容完整的两个版本。

每个版本必须提供非空的 `docs/releases/v<版本>.md`，首行使用 `# 版本号：中文说明` 标题；自动发布从首行提取 Release 标题，缺少说明或标题时直接失败，不回退到自动生成的英文说明。

仅修正文档语言或发布说明时，不需要另发扩展版本：提交并推送文档后，用 `gh release edit` 更新对应已发布版本的标题和正文，再读取远端核对。不要移动已发布的版本标签或替换下载附件。例如：

```sh
gh release edit v1.2.0 --repo abbhb/profile-downloader --title "v1.2.0：JSON 响应高亮、结构预览与复制" --notes-file docs/releases/v1.2.0.md
gh release view v1.2.0 --repo abbhb/profile-downloader --json name,body,url
```

## 1. 完成功能并验证

在仓库根目录使用 Node.js 22+。项目没有 npm 第三方依赖，保留锁文件以支持确定的 CI 安装。

```sh
npm ci
npm test
npm run check
npm run security:check
npm run build
npm run release:check
```

测试使用合成数据和本地服务，不能向真实业务系统重放请求。涉及表格、详情、菜单或主题的变化，还需在浏览器里验证实际交互；确认右键只选择请求并打开 Profile，点击重放才发送。

## 2. 版本与发布说明

使用 SemVer，tag 固定为 `vMAJOR.MINOR.PATCH`：

| 变化 | 版本 |
| --- | --- |
| 兼容的错误修复或小幅行为修正 | PATCH |
| 兼容的新功能 | MINOR |
| 不兼容的使用方式、数据契约或权限模型变更 | MAJOR |

同时更新 `manifest.json`、`package.json`、锁文件中的项目版本及 `CHANGELOG.md`。README、适用技术栈和相关 docs 必须描述最终实现。将本版本面向使用者的说明保存到 `docs/releases/v<版本>.md`，包含变化、安装方式、使用限制和实际验证结果；不粘贴业务请求或内部环境。

首次公开版本是 `1.1.0`；此前 manifest 的 `1.0.0` 是本地原型版本，没有公开 Release。

版本变更后重新运行完整验证，确保包名、manifest 版本和 tag 一致。例如：

```sh
npm test
npm run check -- v1.1.0
npm run security:check
npm run build
npm run release:check -- v1.1.0
```

构建生成：

- `dist/profile-downloader-1.1.0.zip`
- `dist/profile-downloader-1.1.0.zip.sha256`

ZIP 根目录直接包含 `manifest.json` 和其他运行文件，解压后即可加载。构建使用明确的运行文件白名单，不把 docs、真实请求、截图或整个工作目录一起压缩。`release:check` 校验 ZIP、SHA-256 和源码内容对应关系。

## 3. 人工检查公开内容

```sh
git status --short
git diff --check
git diff
git ls-files
```

检查所有将提交的文件、现有 Git 历史、图片和 ZIP。不要提交真实 HAR、报告、内部截图、秘密、内部域名、本机路径或个人邮箱。示例使用 `example.test`、localhost 与明显模拟值；公开截图必须来自本地合成演示。检查 Git 作者使用 GitHub noreply 或获准公开的专用地址。详见 [隐私与开源检查](privacy.md)。

只暂存已经审阅的文件，随后再次核对：

```sh
git diff --cached --check
git diff --cached
```

## 4. 提交、tag 与自动发布

确认 `origin` 指向预期 GitHub 仓库，并确认同名 tag 尚未发布。以下以 `1.1.0` 为例，后续版本替换全部版本号：

```sh
git commit -m "release: v1.1.0"
git tag -a v1.1.0 -m "Profile Downloader v1.1.0"
git push origin main
git push origin v1.1.0
```

tag 推送触发 release 工作流：检查源码、敏感材料、测试和版本一致性，构建 ZIP 与 checksum，然后读取 `docs/releases/v1.1.0.md` 创建 GitHub Release 并上传两个文件。查看 Actions 运行并等到发布结束；不能只看到 tag 就报告成功。

```sh
gh run list --workflow release.yml --limit 5
gh release view v1.1.0 --repo abbhb/profile-downloader
```

如果 Actions 失败，先检查失败原因，解决后重新运行并验证。不要同时让工作流和本地 CLI 创建同一个 Release。已公开版本不可通过强推 tag 或悄悄替换包来修复；发布新 PATCH。

### GitHub CLI 手动路径

仅当确认工作流没有发布，且上述验证均已通过时，使用相同 tag、笔记和两个已校验的附件：

```sh
gh release create v1.1.0 dist/profile-downloader-1.1.0.zip dist/profile-downloader-1.1.0.zip.sha256 --repo abbhb/profile-downloader --verify-tag --title "v1.1.0：首次开源发布" --notes-file docs/releases/v1.1.0.md
```

`--verify-tag` 防止 GitHub 自动从错误分支补建 tag。详细 CLI 行为见 [GitHub CLI release create](https://cli.github.com/manual/gh_release_create)。

## 5. 验证远端与附件

```sh
gh repo view abbhb/profile-downloader --json url,visibility,defaultBranchRef
git rev-parse HEAD
git rev-parse 'v1.1.0^{}'
git ls-remote origin refs/heads/main refs/tags/v1.1.0 'refs/tags/v1.1.0^{}'
gh release view v1.1.0 --repo abbhb/profile-downloader --json url,tagName,isDraft,isPrerelease,assets
mkdir -p output/release-verify-v1.1.0
gh release download v1.1.0 --repo abbhb/profile-downloader --dir output/release-verify-v1.1.0
```

确认仓库是 PUBLIC，远端 main 与 tag 的实际提交对应预期发布提交，Release 不是 draft，且附件名称和版本准确。进入下载目录后校验真正的远端附件：

```sh
shasum -a 256 -c profile-downloader-1.1.0.zip.sha256
```

Linux 可使用 `sha256sum -c`。解压下载的 ZIP，确认 manifest 版本并在 Chrome / Edge 加载。完成后向用户提供仓库、tag / Release 链接、版本、验证结果和仍存在的限制。

发布失败时准确报告停在哪一步；不要把 GitHub 登录、权限或网络错误描述成发布成功。
