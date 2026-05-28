# Issues

记录开发过程中发现的问题、待修复的 bug、待优化的点。

格式：`[状态] 问题描述 — 发现日期`

状态标记：

- `[ ]` 待处理
- `[~]` 进行中
- `[x]` 已解决

---

## Bug

[ ] <!-- 在此记录 bug -->

## 优化

[ ] `get_weather.json`、`calculate_budget.json` 未被任何代码 import，仅为静态文件 — 2026-05-28
[ ] `tools` 参数未传入 `streamDeepSeekChat()`，Tool Calling 尚未接入 — 2026-05-28
[ ] `estimateTokens()` 仍为字符数/3 粗略估算，生产环境应替换为 tiktoken — 2026-05-28
[ ] 四个 stub 函数（`summarizeMessages` / `updateProfileQuickly` / `extractKeyFacts`）占位未接入 — 2026-05-28
[ ] 页面交互-流式输出的过程中页面无法滚动 — 2026-05-28

## 待调研

[ ] DeepSeek API 生产环境需搭建后端代理（Vite proxy 仅 dev 有效） — 2026-05-28
[x] Context 窗口引擎（`src/context/`）已接入前端 API 调用链路（App.tsx → updateMessage → toModelMessages → API） — 2026-05-28
