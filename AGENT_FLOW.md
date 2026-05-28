# Agent Flow: Travel AI Assistant

## 完整请求链路

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 用户输入                                                      │
│    UI 输入框 → Enter 键 → handleSend()                          │
│    构造 UIMessage { role: "user", content: "三天东京行程" }       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. 请求构造                                                      │
│    useMock=true  → createMockSSEStream(MOCK_TOKENS)             │
│    useMock=false → fetch(endpoint, { body: messages })          │
│    StreamSource → useStreamResponse.start(source)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Prompt 构建（服务端）                                         │
│    buildInitialWindow({                                         │
│      systemPrompt,     ← src/prompts/systemPrompt.md           │
│      userProfile,      ← formatUserProfile(profileData)        │
│      memorySummary     ← "(No prior conversation.)"             │
│    })                                                           │
│                                                                  │
│    5 层结构：                                                    │
│    [systemPrompt][userProfile][memorySummary][history][latest]  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Context 构建                                                  │
│    toModelMessages(window) → ChatMessage[]                      │
│    发送给 LLM API                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Tool Decision（LLM 内部）                                     │
│    LLM 判断是否需要调用工具：                                     │
│    - get_weather → 天气查询                                     │
│    - calculate_budget → 预算计算                                │
│    - search_hotels / search_flights / search_attractions        │
│                                                                  │
│    若需要 → 返回 tool_calls                                     │
│    若不需要 → 直接返回文本响应                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. Tool 执行 + 预处理                                            │
│    执行 tool → 获取原始结果                                      │
│    preprocessToolOutput(toolName, rawOutput):                   │
│      → JSON.parse                                               │
│      → 结果数量封顶 (maxResults)                                 │
│      → 字段白名单过滤 (keepFields)                               │
│      → token 预算裁剪 (maxTokens)                                │
│      → 硬截断上限 (SINGLE_MESSAGE_HARD_CAP = 4000)              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. LLM Response（流式输出）                                      │
│    SSE 格式:                                                    │
│    data: {"choices":[{"delta":{"content":"根据"}}]}             │
│    data: {"choices":[{"delta":{"content":"您的"}}]}             │
│    ...                                                          │
│    data: [DONE]                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 8. SSE 解析（前端）                                              │
│    parseSSEChunk(buffer):                                       │
│      → 按 "\n\n" 切分帧                                         │
│      → 解析 "data:" 行                                          │
│      → 提取 choices[0].delta.content                            │
│      → 输出 frames[]                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 9. JSON 卡片检测                                                 │
│    processFrames(frames, detector):                             │
│                                                                  │
│    text 模式:                                                    │
│      → search(/\{"type"\s*:\s*"/)                              │
│      → 未匹配 → TextChunk                                       │
│      → 匹配 → 前面文本 TextChunk + 进入 json 模式                │
│                                                                  │
│    json 模式:                                                    │
│      → buffer += frame                                          │
│      → findJsonEnd(buffer) — 括号深度追踪                       │
│      → 未闭合 → 等待更多数据                                    │
│      → 闭合 → parseJsonChunk() → CardChunk 或 TextChunk        │
│      → 递归处理剩余部分                                          │
│                                                                  │
│    流结束 → flushJsonDetector():                                │
│      → JSON.parse 尝试 → CardChunk                              │
│      → 失败 → ErrorChunk("数据传输中断")                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 10. rAF 节流渲染                                                 │
│     scheduleFlush():                                             │
│       → 已安排? → 跳过                                           │
│       → 未安排 → requestAnimationFrame(flushChunks)             │
│                                                                  │
│     flushChunks():                                               │
│       → 取出 pendingChunksRef                                   │
│       → setState: fullText += TextChunk; chunks += all          │
│       → React 重渲染 (≤60fps)                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 11. UI 渲染                                                      │
│     displayMessages → [...messages, streamingBubble]             │
│                                                                  │
│     ChatBubble:                                                  │
│       user → 纯文本                                              │
│       assistant → AssistantContent                               │
│                                                                  │
│     AssistantContent:                                            │
│       TextChunk[] → 合并 → react-markdown → Markdown 渲染       │
│       CardChunk → CardWidget → RouteCard / WeatherCard          │
│       ErrorChunk → ErrorWidget → 红色错误提示                   │
│       流式时 → sanitizeStreamingMarkdown() → 裁剪残缺语法       │
│       流式时 → 闪烁光标 ▍                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 12. Memory Update（下一轮对话时，服务端）                         │
│     updateMessage(window, { userMessage, assistant, tools }):   │
│                                                                  │
│     Step 1: latestUser → recentHistory                          │
│     Step 2: assistant + preprocessedTools → recentHistory       │
│     Step 3: newUserMessage → latestUser                         │
│     Step 4: if recentHistory > 80k tokens:                      │
│       compressRecentHistory()                                   │
│         → 取最旧 6 条 → findAtomicBoundary() 对齐               │
│         → summarizeMessages() → 合并到 memorySummary            │
│     Step 5: if total > 112k tokens:                             │
│       hardTruncate()                                            │
│         → 扫描删除组 (measureRemovalGroup)                      │
│         → updateProfileQuickly() → mergeProfile() → userProfile │
│         → extractKeyFacts() → memorySummary                     │
│         → splice() 物理删除                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 13. Response Output                                              │
│     最终返回给前端：LLM 文本内容（SSE 流）                       │
│     下一轮对话的输入：更新后的 ContextWindow                     │
└─────────────────────────────────────────────────────────────────┘
```

## 修正流程（用户点击"重规划"/"缩短行程"/"换个风格"）

```
1. 快照当前 partialContent + partialChunks
2. 固化被中断的 assistant 消息（标记 ~已中断~）
3. 追加用户修正指令（如 "🔧 方向完全错误，请忽略..."）
4. 清洗 API 消息：
   - strip 策略 → 过滤掉 ~已中断~ 的 assistant 消息
   - annotate 策略 → 保留全部
5. streamResult.start(newSource) → 自动 abort 旧流 + 启动新流
```

## 流结束时固化

```
useEffect watches: isLoading (prev=true, current=false) && fullText
  → 将最后一个 streaming 气泡固化为普通消息
  → 下一次 handleSend 时正常追加到 messages[]
```
