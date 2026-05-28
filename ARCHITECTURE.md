# Architecture: Travel AI Assistant

## 系统架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Browser (Vite + React)                      │
│                                                                      │
│  ┌──────────┐    ┌──────────────────────┐    ┌───────────────────┐  │
│  │ App.tsx  │───▶│ useStreamResponse.ts │───▶│  SSE Parser       │  │
│  │ (UI 主控) │    │ (流式 Hook)          │    │  JSON Detector    │  │
│  └──────────┘    └──────────────────────┘    │  rAF Throttle     │  │
│        │                                      └───────────────────┘  │
│        │                                                             │
│        ▼                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐      │
│  │ChatBubble│    │ Card     │    │ StreamBar│    │ Styles   │      │
│  │Assistant │    │ Widget   │    │          │    │          │      │
│  │Content   │    │          │    │          │    │          │      │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP POST / SSE
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Server (待接入)                                │
│                                                                      │
│  ┌──────────┐    ┌──────────────────────────────────────────────┐   │
│  │ API Route│───▶│  updateMessage() — 上下文窗口编排器            │   │
│  └──────────┘    │                                              │   │
│                  │  ┌────────────┐  ┌────────────┐              │   │
│                  │  │ Compressor │  │ HardTrunc  │              │   │
│                  │  │ (压缩)      │  │ (硬截断)    │              │   │
│                  │  └────────────┘  └────────────┘              │   │
│                  │                                              │   │
│                  │  ┌────────────┐  ┌────────────┐              │   │
│                  │  │ Atomic     │  │ Token      │              │   │
│                  │  │ Boundary   │  │ Estimator  │              │   │
│                  │  └────────────┘  └────────────┘              │   │
│                  └──────────────────────────────────────────────┘   │
│                                    │                                 │
│                                    ▼                                 │
│                  ┌──────────────────────────────────────────────┐   │
│                  │              UserProfile                       │   │
│                  │  mergeProfile() + formatUserProfile()        │   │
│                  └──────────────────────────────────────────────┘   │
│                                    │                                 │
│                                    ▼                                 │
│                  ┌──────────────────────────────────────────────┐   │
│                  │              LLM API                          │   │
│                  │  (Anthropic / OpenAI — stub 待接入)           │   │
│                  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## 模块依赖关系

```
src/index.tsx
  └── src/ui/App.tsx
        ├── src/streaming/useStreamResponse.ts
        │     ├── src/streaming/sseParser.ts
        │     ├── src/streaming/jsonDetector.ts
        │     └── src/streaming/types.ts
        ├── src/ui/components/ChatBubble.tsx
        │     └── src/ui/components/AssistantContent.tsx
        │           ├── src/ui/components/CardWidget.tsx
        │           ├── src/ui/components/ErrorWidget.tsx
        │           ├── src/ui/markdownComponents.tsx
        │           └── src/ui/sanitizeMarkdown.ts
        ├── src/ui/components/StreamBar.tsx
        ├── src/ui/styles.ts
        └── src/ui/mockStream.ts

src/context/updateMessage.ts (服务端核心，不直接 import 于前端)
  ├── src/types/chatMessage.ts
  ├── src/config/context.ts
  ├── src/context/tokenEstimator.ts
  ├── src/context/compressor.ts
  │     ├── src/context/tokenEstimator.ts
  │     └── src/context/atomicBoundary.ts
  ├── src/context/hardTruncate.ts
  │     ├── src/context/tokenEstimator.ts
  │     ├── src/context/atomicBoundary.ts
  │     ├── src/profile/mergeProfile.ts
  │     └── src/profile/formatter.ts
  ├── src/context/windowBuilder.ts
  │     └── src/profile/formatter.ts
  └── src/tools/toolPreprocessor.ts
        └── src/context/tokenEstimator.ts
```

## 数据流：用户发送消息

```
1. 用户在 UI 输入文本，点击发送
2. App.tsx handleSend() 创建 UIMessage，更新 messages state
3. 若 useMock=true → 调用 createMockSSEStream(MOCK_TOKENS) 构造模拟字节流
   若 useMock=false → 构造 fetch(url, { body: JSON.stringify(messages) })
4. useStreamResponse.start(source) 启动流消费
5. consumeStream() 循环：
   a. reader.read() → 原始字节
   b. TextDecoder.decode() → UTF-8 字符串
   c. parseSSEChunk(buffer) → SSE 帧数组
   d. processFrames(frames, detector) → StreamChunk[]
   e. push 到 pendingChunksRef
   f. scheduleFlush() → requestAnimationFrame
6. flushChunks() 在下一帧前：
   a. 取出 pendingChunksRef 中的所有 chunk
   b. setState: fullText 拼接 TextChunk；chunks 数组追加全部
7. React 重渲染：
   a. displayMessages 计算 → 末尾追加 streaming 气泡
   b. ChatBubble → AssistantContent → 遍历 chunks 渲染
   c. TextChunk 合并后用 react-markdown 渲染
   d. CardChunk 渲染为 CardWidget（RouteCard / WeatherCard）
   e. ErrorChunk 渲染为 ErrorWidget
8. 流结束 → isLoading=false → 固化 streaming 气泡为普通消息
```

## 数据流：服务端上下文管理（待接入）

```
1. POST /api/chat 接收 { messages }
2. buildInitialWindow({ systemPrompt, userProfile }) 构建初始窗口
3. 每轮对话：
   a. toModelMessages(window) → 5 层消息数组
   b. 发送给 LLM
   c. LLM 返回 assistantResponse + toolResults
   d. updateMessage(window, { userMessage, assistantResponse, toolResults })
      - recentHistory 超限 → compressRecentHistory() → 蒸馏摘要
      - 仍超限 → hardTruncate() → 收割偏好 + 物理删除
4. 返回 LLM 的最终文本内容给前端（SSE 流式输出）
```

## Agent 生命周期（服务端）

```
[初始化]
buildInitialWindow({ systemPrompt, userProfile, memorySummary? })
  → 创建 5 层空窗口

[每轮对话]
updateMessage(current, { userMessage, assistantResponse?, toolResults? })
  → 推入历史 → 检查 token → 压缩/截断 → 返回新窗口

[上下文压缩]
compressRecentHistory(window)
  → 从 recentHistory 头部取 batch → LLM 蒸馏 → 合并到 memorySummary

[硬截断]
hardTruncate(window, budget)
  → 扫描 → updateProfileQuickly() + extractKeyFacts() → splice()

[用户画像更新]
mergeProfile(current, patch)
  → 数组合并（并集） + 标量覆盖
  → applyProfilePatch() 重新格式化 userProfile 消息
```

## Tool 生命周期

```
[定义]  JSON Schema 文件在 src/tools/definitions/
[配置]  TOOL_OUTPUT_CONFIGS 在 src/config/tools.ts
[调用]  LLM 在响应中返回 tool_calls
[执行]  服务端调用对应 tool 函数
[预处理] preprocessToolOutput(toolName, rawContent)
          → 结果数量封顶 → 字段过滤 → token 裁剪
[进入上下文] 预处理后的 tool 消息进入 recentHistory
```

## Memory 生命周期

```
[新增消息] → recentHistory
[超限触发] → compressRecentHistory()
  → 取出最旧消息 → summarizeMessages() → 合并到 memorySummary
[仍超限] → hardTruncate()
  → updateProfileQuickly() → 画像结构化更新 → userProfile
  → extractKeyFacts() → 文本事实 → memorySummary
  → splice() 物理删除
```
