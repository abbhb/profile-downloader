# 项目协作规范

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tools** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them. `codegraph_node` returns one symbol's source + callers, or reads a whole file with line numbers. If the tools are listed but deferred, load them by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` and `codegraph node <symbol-or-file>` print the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

## 文档与发布说明语言

- README、CHANGELOG、用户文档及 GitHub Release 的标题和正文统一使用中文。产品名、技术名称、代码标识、命令和实际界面标签保留原文；不要把英文正文、中文正文或中英双标题零散拼接。
- 如用户以后要求双语，应提供内容完整、分别组织的中文和英文版本，而不是在同一版本中混杂两种正文。
- 发布前审阅实际 README、版本说明和远端 Release，确保语言一致；不得回退到自动生成的英文发布说明。
- 仅修正文档语言或发布说明时，提交并推送文档，再更新对应版本的 Release 标题和正文即可，无需另发扩展版本。保留已发布的版本标签及下载附件。

## Product and implementation

- This is a Manifest V3 Chrome / Edge DevTools extension using vanilla JavaScript ES modules, HTML and CSS.
- Prefer the compact Network-style workflow. Preserve request names, full URL discoverability, filters, sorting, request detail tabs and the in-panel right-click Profile action.
- Default to 22 px single-line request rows. Keep the endpoint name on that line and the full URL in the row tooltip and Headers; preserving list density is an explicit product requirement. Retain this layout in future changes unless the user requests a different density.
- Fit the table to narrow list panes with compact column widths and adaptive Waterfall / Type visibility; keep the complete request information in details.
- Public Chrome APIs do not expose native Network request-row context-menu injection or its current selection. Do not claim a native Network bridge or use undocumented DevTools internals.
- Capture HTTP(S) methods for inspection; replay only supported GET / POST requests after the user explicitly clicks replay. A context-menu selection alone must not send a request.
- Preserve query parameters, full text body and settable headers. Reject missing body and multipart/file uploads; never silently substitute an empty body. Browser-managed headers remain browser-managed.
- Keep current login/CORS/CSP/CSRF behavior visible. POST executes again, cancellation is not rollback, and server-side Pyinstrument integration is required.
- Do not add analytics, remote services, storage of request data, automatic replay or retries without a direct user requirement.
- Render captured fields and responses as text. Do not execute response HTML in the panel or interpolate request data into HTML.
- Preserve Response JSON highlighting, the collapsible Preview tree and one-click copying. Build safe DOM nodes for keys and values; lazily render children in groups of 100 and keep node copy actions accessible.
- Response formatting and formatted-JSON copying must preserve original tokens, including large integers, duplicate keys and escapes. Preview / node copying uses standard JavaScript parsing; document its precision and duplicate-key limits and keep the exact Response accessible. Reject copying unsafe parsed numbers and containers containing them. Label binary-text copying as Base64.
- Keep response previews bounded to 102,400 source characters. Clearly identify truncated, invalid JSON and binary content; these states must not produce a misleading JSON tree.
- Full-response copying may read the recorded response on demand, up to 20 × 1024 × 1024 characters, without persistently caching the complete body or replaying the endpoint. Report clipboard failures explicitly and allow manual copying. Copying must remain an explicit user action and must not add extension permissions.

## Development and privacy

- Use Node.js 22+. Run `npm test`, `npm run check`, `npm run security:check`, `npm run build` and `npm run release:check` for functional changes. Use synthetic fixtures or local demo services; do not test against real business systems.
- Keep the `manifest.json` and `package.json` versions identical. Do not introduce runtime dependencies unless needed and reviewed.
- Never commit real HAR, report HTML, internal screenshots, credentials, internal URLs, local machine paths or personal email addresses. Use `example.test`, localhost and obvious mock values.
- Inspect the actual staged files and build ZIP. Automated secret checks are a guard, not proof that all sensitive data is absent.
- Keep docs aligned with the shipped behavior. Framework names alone do not imply backend compatibility; `BKAPP_OPEN_PYINSTRUMENT` is application-specific.

## Release completion

The project is intended for public open-source distribution. Treat release work as part of completing each user-visible change, following [docs/releasing.md](docs/releasing.md).

1. Complete the implementation and relevant docs, then run tests, source checks, sensitive-data checks and the release build.
2. Choose SemVer, update both version fields and CHANGELOG, and rebuild the final versioned ZIP and SHA-256 file.
3. Manually review source, staged diff, Git metadata and package contents for sensitive information. Use a GitHub noreply author email for public commits.
4. Commit the release state, create an annotated `vMAJOR.MINOR.PATCH` tag, push the intended branch and tag, and wait for the release workflow to publish both assets and meaningful notes. If automation cannot publish, follow the documented GitHub CLI fallback; avoid a duplicate publication race.
5. Verify repository visibility, remote branch/tag commit, published release version, asset names and downloaded checksum. Report the concrete repository and Release links to the user.

Do not declare a release complete when only local files, a tag or a Git push exist. If checks, GitHub access or publication fail, preserve the verified local result and clearly report the exact unfinished step. Never move an already published version tag or replace its contents silently; use a new patch version.
