# Architecture: Travel AI Assistant

## 系统架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Browser (Vite + React)                      │
│                                                                      │
│  ┌──────────┐    ┌──────────────────────────────────────────────┐   │
│  │ App.tsx  │───▶│  updateMessage() — 上下文窗口编排器（浏览器端）│   │
│  │ (UI 主控) │    │                                              │   │
│  └──────────┘    │  ┌────────────┐  ┌────────────┐              │   │
│        │         │  │ Compressor │  │ HardTrunc  │              │   │
│        │         │  │ (压缩)      │  │ (硬截断)    │              │   │
│        │         │  └────────────┘  └────────────┘              │   │
│        │         │                                              │   │
│        │         │  ┌────────────┐  ┌────────────┐              │   │
│        │         │  │ Atomic     │  │ Token      │              │   │
│        │         │  │ Boundary   │  │ Estimator  │              │   │
│        │         │  └────────────┘  └────────────┘              │   │
│        │         │                                              │   │
│        │         │  ┌──────────────────────────────────────┐    │   │
│        │         │  │ UserProfile                           │    │   │
│        │         │  │ mergeProfile() + formatUserProfile() │    │   │
│        │         │  └──────────────────────────────────────┘    │   │
│        │         └──────────────────────────────────────────────┘   │
│        │                         │                                   │
│        │                         ▼                                   │
│        │         ┌──────────────────────────────────────────────┐   │
│        │         │  toModelMessages() → 5 层结构 ChatMessage[]  │   │
│        │         └──────────────────────────────────────────────┘   │
│        │                         │                                   │
│        ▼                         ▼                                   │
│  ┌──────────┐    ┌──────────────────────┐    ┌───────────────────┐  │
│  │ChatBubble│    │ useStreamResponse.ts │───▶│  SSE Parser       │  │
│  │Assistant │    │ (流式 Hook)          │    │  JSON Detector    │  │
│  │Content   │    └──────────────────────┘    │  rAF Throttle     │  │
│  └──────────┘                               └───────────────────┘  │
│                                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐      │
│  │ChatBubble│    │ Card     │    │ StreamBar│    │ Styles   │      │
│  │Assistant │    │ Widget   │    │          │    │          │      │
│  │Content   │    │          │    │          │    │          │      │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ POST /api/deepseek (Vite proxy)
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       External                                       │
│                                                                      │
│  ┌──────────┐    ┌──────────────────────────────────────────────┐   │
│  │   Vite   │───▶│  DeepSeek API (api.deepseek.com)             │   │
│  │  Proxy   │    │  Authorization: Bearer <key> (服务端注入)     │   │
│  └──────────┘    └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## 模块依赖关系

```
src/index.tsx
  └── src/ui/App.tsx
        ├── src/context/updateMessage.ts       ← 上下文引擎（浏览器端）
        │     ├── src/types/chatMessage.ts
        │     ├── src/config/context.ts
        │     ├── src/context/tokenEstimator.ts
        │     ├── src/context/compressor.ts
        │     │     ├── src/context/tokenEstimator.ts
        │     │     └── src/context/atomicBoundary.ts
        │     ├── src/context/hardTruncate.ts
        │     │     ├── src/context/tokenEstimator.ts
        │     │     ├── src/context/atomicBoundary.ts
        │     │     ├── src/profile/mergeProfile.ts
        │     │     └── src/profile/formatter.ts
        │     ├── src/context/windowBuilder.ts
        │     │     └── src/profile/formatter.ts
        │     └── src/tools/toolPreprocessor.ts
        │           └── src/context/tokenEstimator.ts
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
```

## 数据流：用户发送消息

```
1. 用户在 UI 输入文本，点击发送
2. App.tsx handleSend() 创建 UIMessage + ChatMessage
3. sendToApi(userChatMsg):
   a. updateMessage(window, { userMessage, assistantResponse })
      → 推入历史 → 检查 token → 压缩/截断 → 返回新窗口
   b. toModelMessages(window) → 5 层 ChatMessage[]
   c. 若 useMock=true → createMockSSEStream(MOCK_TOKENS)
      若 useMock=false → streamDeepSeekChat({ messages })
        → POST /api/deepseek (Vite proxy → api.deepseek.com)
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
7. React 重渲染（与旧版相同）
8. 流结束 → isLoading=false:
   a. setMessages 固化 assistant 消息
   b. lastAssistantRef = assistant ChatMessage（供下一轮使用）
```

## Agent 生命周期（浏览器端）

```
[初始化]
buildInitialWindow({ systemPrompt, userProfile, memorySummary? })
  → 创建 5 层空窗口，存入 contextWindowRef

[每轮对话]
sendToApi(userChatMsg)
  → updateMessage(current, { userMessage, assistantResponse?, toolResults? })
  → 推入历史 → 检查 token → 压缩/截断 → 返回新窗口
  → toModelMessages(window) → 发送 API

[流结束]
useEffect: isLoading true→false
  → lastAssistantRef = assistant ChatMessage

[上下文压缩]
compressRecentHistory(window)
  → 从 recentHistory 头部取 batch → LLM 蒸馏 → 合并到 memorySummary
  （stub：当前为占位实现，接入真实 LLM 后自动生效）

[硬截断]
hardTruncate(window, budget)
  → 扫描 → updateProfileQuickly() + extractKeyFacts() → splice()
  （stub：当前 harvest 函数返回 null，硬截断仅做物理删除）

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
