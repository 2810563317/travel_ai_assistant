# Travel AI Assistant

AI 旅行规划助手的上下文窗口管理框架。解决的核心问题：在 LLM token 预算限制内维持长时间的旅行规划对话，同时保留关键的用户偏好、决策和对话上下文。

## 项目架构

```
src/
├── types/          # 所有 TypeScript 类型定义
├── api/            # LLM API 客户端（请求构造 + 流式调用）
├── config/         # 配置常量（token 限制、工具配置、模型参数）
├── prompts/        # Prompt 模板（.md 文件）+ 加载/渲染工具
├── tools/          # Tool 定义（JSON Schema）+ 预处理 + 注册表
├── profile/        # 用户画像合并 + 格式化
├── context/        # 上下文窗口引擎（核心）
├── streaming/      # SSE 流式响应解析 + JSON 卡片检测
├── ui/             # React UI 组件 + 样式 + Mock 流
├── utils/          # 通用工具（logger 等）
└── index.tsx       # 入口
```

## Agent Flow

```
用户输入 → App.tsx (handleSend)
  → useStreamResponse.start(source)
    → fetch(url) 或 直接消费 ReadableStream
      → parseSSEChunk()     — SSE 帧解析
      → processFrames()     — JSON 卡片检测状态机
      → scheduleFlush()     — rAF 节流
      → flushChunks()       — setState 合并
  → ChatBubble + AssistantContent → Markdown 渲染 + 卡片渲染
```

（服务端上下文管理链路，当前通过 API 端点间接调用）：

```
updateMessage(currentWindow, incoming)
  → 1. latestUser 推入 recentHistory
  → 2. toolResults 预处理（preprocessToolMessages）
  → 3. 新消息成为 latestUser
  → 4. 若 recentHistory 超限 → compressRecentHistory()
  → 5. 若仍超限 → hardTruncate()
  → 返回更新后的 ContextWindow
```

## Prompt Flow

发送给模型的上下文窗口是 5 层结构：

```
[systemPrompt]  →  ~2k tokens，静态内容，仅加载一次
[userProfile]   →  ~1k tokens，结构化用户画像，以 system 消息形式注入
[memorySummary] →  ~8k tokens，被截断历史的压缩摘要
[recentHistory] → ~100k tokens，最近消息的滑动窗口
[latestUser]    →  ~2k tokens，始终保留，永不截断
```

Token 总预算：128k，其中 16k 预留给模型输出。

所有 Prompt 模板集中在 `src/prompts/` 目录下管理：
- `systemPrompt.md` — 主系统 Prompt（含行为规则）
- `userProfilePrompt.md` — 用户画像提取 Prompt
- `promptLoader.ts` — 模板加载与 `{{variable}}` 变量替换工具

## Memory Flow

上下文压缩（`compressRecentHistory`）：
当 `recentHistory` 超出 80k tokens 时，从头部取出最旧的 6 条消息，调用 LLM 蒸馏为摘要，合并到 `memorySummary`。

硬截断（`hardTruncate`）：
压缩后仍超出预算时，三阶段处理：
1. **扫描** — 按原子边界测量可删除的消息组
2. **收割** — `updateProfileQuickly()` 提取结构化偏好 → `userProfile`；`extractKeyFacts()` 提取文本事实 → `memorySummary`
3. **删除** — `splice()` 移除

原子边界检测（`findAtomicBoundary`）：
`assistant(tool_calls)` + 后续 `tool` 消息构成不可分割的原子组，压缩和截断不会在其中间切割。

## Tool Calling Flow

1. Tool 定义存放在 `src/tools/definitions/*.json`（OpenAI function calling 格式）
2. `toolPreprocessor.ts` 在 tool 返回进入 context 前执行预处理：
   - 结果数量封顶（`maxResults`）
   - 字段白名单过滤（`keepFields`）
   - token 预算裁剪（`maxTokens`）
3. 每个 tool 在 `src/config/tools.ts` → `TOOL_OUTPUT_CONFIGS` 中有独立配置

## Context Management

核心文件：`src/context/updateMessage.ts` → `updateMessage()` 是编排器，每轮对话调用一次。

依赖关系：
- `tokenEstimator.ts` — token 估算（stub，待替换为 tiktoken）
- `atomicBoundary.ts` — 原子边界检测
- `compressor.ts` — 摘要 + 压缩
- `hardTruncate.ts` — 硬截断 + 画像收割
- `windowBuilder.ts` — 初始化 + 构建模型消息数组

## 关键模块

| 模块 | 目录 | 职责 |
|---|---|---|
| 类型系统 | `src/types/` | ChatMessage、UserProfile、ToolCall 等所有类型 |
| API 客户端 | `src/api/` | LLM API 请求构造 + 流式客户端 |
| 配置管理 | `src/config/` | Token 限制、工具输出配置、模型参数 |
| Prompt | `src/prompts/` | 所有 prompt 模板 + 加载工具 |
| Tool | `src/tools/` | Tool 定义、预处理、注册 |
| 用户画像 | `src/profile/` | 画像合并（mergeProfile）、格式化 |
| 上下文引擎 | `src/context/` | 5 层上下文窗口管理 |
| 流式处理 | `src/streaming/` | SSE 解析、JSON 卡片检测、rAF 节流 |
| UI | `src/ui/` | React 组件、样式、Mock 流 |
| 工具 | `src/utils/` | Logger 等通用工具 |

## 待接入的 Stub 函数

以下函数当前为占位实现，需要接入真实 LLM：
- `summarizeMessages()` (`context/compressor.ts`) — 调用 LLM 进行对话摘要
- `updateProfileQuickly()` (`context/hardTruncate.ts`) — 调用快速模型提取画像变更
- `extractKeyFacts()` (`context/hardTruncate.ts`) — 调用快速模型提取关键事实
- `estimateTokens()` (`context/tokenEstimator.ts`) — 字符数/3 粗略估算；应替换为 tiktoken

## 开发规范

### 文档同步
当项目需求、架构或模块发生变更时，必须同步更新以下三份文档：

| 变更类型 | 需更新的文档 |
|---|---|
| 新增/删除模块 | CLAUDE.md（架构树 + 模块表）、ARCHITECTURE.md（依赖关系） |
| 新增/修改流程 | AGENT_FLOW.md |
| 配置变更 | CLAUDE.md、ARCHITECTURE.md |
| API / 集成变更 | CLAUDE.md、ARCHITECTURE.md |
| 规范变更 | CLAUDE.md（对应章节） |

- **CLAUDE.md** — AI 助手和开发者的入口文档，必须反映项目最新状态
- **ARCHITECTURE.md** — 系统架构文档，必须反映模块依赖和数据流
- **AGENT_FLOW.md** — Agent 流程文档，必须反映完整的请求/响应链路

### 新增 Prompt
1. 在 `src/prompts/` 下创建 `.md` 文件
2. 使用 `{{variable}}` 语法标记模板变量
3. 通过 `loadPrompt()` + `renderPrompt()` 加载和渲染

### 新增 Tool
1. 在 `src/tools/definitions/` 下创建 JSON Schema 文件
2. 在 `src/config/tools.ts` → `TOOL_OUTPUT_CONFIGS` 添加输出预处理配置
3. 在 `src/tools/toolRegistry.ts` 注册（接入真实 Tool Calling 后）

### 新增 Memory 类型
1. 如需新的 memory 层，在 `src/context/` 下新增模块
2. 通过 `updateMessage()` 编排器接入主流程

### 命名规范
- 文件名：camelCase（如 `tokenEstimator.ts`、`useStreamResponse.ts`）
- 类型名：PascalCase（如 `ChatMessage`、`ContextWindow`）
- 函数名：camelCase（如 `buildInitialWindow`）
- 常量名：UPPER_SNAKE_CASE（如 `DEFAULT_CONTEXT_CONFIG`）
- Prompt 文件：camelCase + `.md`（如 `systemPrompt.md`）

### 错误处理
- 使用 `src/utils/logger.ts` 的 `createLogger(module)` 创建模块级 logger
- 不使用裸 `console.log`

### 测试
- 测试文件放在 `tests/` 目录
- 命名：`*.test.ts`

## 禁止事项
- 不允许在业务代码中硬编码 prompt 文本
- 不允许在 UI 组件中直接调用 LLM API
- 不允许跨模块引用内部实现细节（只能通过 barrel export）
- 不允许修改 `src/types/` 中的类型定义而不更新所有引用
- 不允许删除 stub 函数（它们是接入真实 LLM 的预留接口）

## 变更工作流策略 (Change Workflow Policy)

默认禁止直接修改代码。

任何需求变更、重构、优化、新功能开发、Bug 修复，必须遵守以下流程：

### Step 1：需求理解

先分析需求：
- 当前问题是什么
- 涉及哪些模块
- 是否影响现有逻辑
- 是否影响架构
- 是否影响 Prompt / Tool / Memory / Context

### Step 2：输出方案

必须先输出方案。方案至少包含：

| 章节 | 内容 |
|---|---|
| 修改目标 | 本次要解决什么问题 |
| 涉及模块 | 哪些文件或模块会修改 |
| 修改思路 | 准备如何修改 |
| 风险评估 | 可能影响什么 |
| 文档影响 | 是否需要同步更新 CLAUDE.md、ARCHITECTURE.md、AGENT_FLOW.md |
| 验证方案 | 如何验证功能未受影响 |

### Step 3：等待确认

输出方案后必须等待用户确认。

禁止：
- 禁止直接修改代码
- 禁止提前生成代码
- 禁止直接重构
- 禁止自动创建文件
- 禁止自动删除代码

只有收到明确确认（如"开始修改""按方案执行""确认方案"），才允许进入代码修改阶段。

### Step 4：执行修改

修改时：
- 最小改动原则
- 不改变业务逻辑
- 输出修改清单
- 输出风险点
- 输出验证步骤

### Step 5：文档同步

检查是否需要更新：
- CLAUDE.md
- ARCHITECTURE.md
- AGENT_FLOW.md

输出文档同步报告。

默认行为：没有明确确认时，只给方案，不改代码。

## 语言策略 (Language Policy)

默认使用中文输出，包括但不限于：

- 架构方案
- 重构方案
- review 报告
- 风险分析
- 模块说明
- 文档生成
- 代码解释
- 问题定位
- 调试建议

特殊情况除外（以下内容保持原文，不翻译）：

- 代码
- 配置项
- API 字段
- 文件名
- 类名
- 函数名
- 数据库字段
- Prompt 内容（如明确要求英文）

规则：

1. 输出方案优先中文
2. 注释优先中文
3. 文档优先中文
4. 不要中英混杂表达
5. 如果引用英文术语，后面补中文解释
6. 对专业术语保持准确，不强制翻译

## 技术栈
- TypeScript + React 18
- Vite 6 构建工具
- react-markdown 渲染
- 无后端框架依赖（纯 TS 类型与函数）
- 设计为与任意 LLM API 对接（Anthropic、OpenAI 等）
