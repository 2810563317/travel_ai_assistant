import { useState, useRef, useEffect } from "react";
import { useStreamResponse } from "../streaming/useStreamResponse";
import type { StreamSource } from "../streaming/types";
import type { ChatMessage } from "../types/chatMessage";
import { streamDeepSeekChat } from "../api/deepseekClient";
import { createMockSSEStream, MOCK_TOKENS } from "./mockStream";
import { styles } from "./styles";
import { ChatBubble } from "./components/ChatBubble";
import type { UIMessage } from "./components/ChatBubble";
import { StreamBar } from "./components/StreamBar";

/**
 * 预设修正指令及对应的剪枝 (pruning) 策略：
 *
 *   "strip"    — 剔除被中断的 assistant 回复，只保留用户消息 + 修正指令。
 *                适用场景：AI 输出方向完全错误，错误内容本身无参考价值，
 *                传回去反而会干扰模型判断（如景点名称、预算数字写错）。
 *
 *   "annotate" — 保留被中断的回复（标记 ~已中断~），让模型参考其结构/风格。
 *                适用场景：缩短行程 / 更换风格 —— 原回复的结构仍可作为参照。
 */
const CORRECTION_PRESETS = [
  { label: "重规划",  reason: "方向完全错误，请忽略之前的规划，重新从头规划。", pruning: "strip" as const },
  { label: "缩短行程", reason: "行程太长，请缩短为更紧凑的版本，减少天数或景点。",   pruning: "annotate" as const },
  { label: "换个风格", reason: "请换一种风格，减少大众景点，增加小众特色和深度体验。", pruning: "annotate" as const },
];

/**
 * 将 UIMessage 转为 ChatMessage（DeepSeek API 所需的内部类型）。
 * 用于将对话历史发送给 LLM。
 */
function uiMessagesToChatMessages(msgs: UIMessage[]): ChatMessage[] {
  const now = new Date().toISOString();
  return msgs.map((m, i) => ({
    id: `msg-${i}`,
    role: m.role,
    content: m.content,
    created_at: now,
  } as ChatMessage));
}

/**
 * 启动 DeepSeek 流式请求，将返回的 stream 交给 useStreamResponse 消费。
 * 所有错误由 useStreamResponse 内部的 catch 块处理。
 */
function startDeepSeekStream(
  messages: UIMessage[],
  start: (source: StreamSource) => void
) {
  const chatMessages = uiMessagesToChatMessages(messages);
  streamDeepSeekChat({ messages: chatMessages })
    .then((stream) => start({ type: "stream", stream }))
    .catch((err) => {
      // 如果 streamDeepSeekChat 本身失败（如 API key 未配置），
      // 需要手动设置错误状态。这里通过一个"error stream"来传递错误。
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      const encoder = new TextEncoder();
      const errorStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(`data: {"choices":[{"delta":{"content":"请求失败: ${errorMsg}"}}]}\n\n`)
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      start({ type: "stream", stream: errorStream });
    });
}

export default function App() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [useMock, setUseMock] = useState(false);
  const streamResult = useStreamResponse();
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 当流式内容更新时，自动滚动到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamResult.fullText, streamResult.chunks.length]);

  // 将 streamResult.fullText 注入为实时 assistant 气泡
  // 空闲态（!isLoading）直接返回 messages；流式态追加 streaming 气泡
  const displayMessages: UIMessage[] = (() => {
    if (!streamResult.isLoading) return messages;

    const lastMsg = messages[messages.length - 1];
    const streamingBubble: UIMessage = {
      role: "assistant" as const,
      content: streamResult.fullText,
      chunks: streamResult.chunks,
      isStreaming: true,
    };

    // 保留前一次 render 已追加的 streaming 气泡，仅更新其内容
    if (lastMsg?.role === "assistant" && (lastMsg as any).isStreaming) {
      return [...messages.slice(0, -1), streamingBubble];
    }
    return [...messages, streamingBubble];
  })();

  function handleSend() {
    const text = input.trim();
    if (!text || streamResult.isLoading) return;

    const userMsg: UIMessage = { role: "user", content: text };
    const messagesWithUser = [...messages, userMsg];
    setMessages(messagesWithUser);
    setInput("");

    if (useMock) {
      streamResult.start({ type: "stream", stream: createMockSSEStream(MOCK_TOKENS) });
    } else {
      startDeepSeekStream(messagesWithUser, streamResult.start);
    }
  }

  /** 中断当前流，按剪枝策略清洗历史，自动发起新请求 */
  function handleCorrect(reason: string, pruning: "strip" | "annotate") {
    if (!streamResult.isLoading) return;

    // 快照当前已输出的内容（在 abort 前保存，因为 start() 会重置 state）
    const partialContent = streamResult.fullText;
    const partialChunks = streamResult.chunks;

    // 将 partial 响应固化为一条已中断消息 + 追加用户修正指令
    const correctionMsg: UIMessage = { role: "user", content: `🔧 ${reason}` };
    const allMessages = (() => {
      const prev = [...messages];
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && (last as any).isStreaming) {
        prev[prev.length - 1] = {
          role: "assistant" as const,
          content: partialContent ? `~已中断~\n${partialContent}` : "~已中断~",
          chunks: partialChunks,
          isStreaming: false,
        };
      }
      prev.push(correctionMsg);
      return prev;
    })();

    // UI 始终保持完整历史（用户能看到中断前的 partial 内容）
    setMessages(allMessages);

    // ── 发送给 API 的消息：按剪枝策略清洗 ──
    let messagesForApi = allMessages;
    if (pruning === "strip") {
      // 移除被中断的 assistant 回复 —— 避免错误内容干扰模型判断
      messagesForApi = allMessages.filter(
        (m) => !(m.role === "assistant" && m.content.startsWith("~已中断~")),
      );
    }
    // annotate 策略：保留全部，~已中断~ 标记即是最小上下文中和

    if (useMock) {
      streamResult.start({ type: "stream", stream: createMockSSEStream(MOCK_TOKENS) });
    } else {
      startDeepSeekStream(messagesForApi, streamResult.start);
    }
  }

  // 流结束时固化消息（由 isLoading: false → 触发）
  const prevLoading = useRef(false);
  useEffect(() => {
    if (prevLoading.current && !streamResult.isLoading && streamResult.fullText) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && (last as any).isStreaming) return prev;
        return [
          ...prev,
          { role: "assistant" as const, content: streamResult.fullText, chunks: streamResult.chunks, isStreaming: false },
        ];
      });
    }
    prevLoading.current = streamResult.isLoading;
  }, [streamResult.isLoading, streamResult.fullText]);

  return (
    <div style={styles.container}>
      {/* 头部 */}
      <header style={styles.header}>
        <h1 style={styles.title}>Travel AI Assistant</h1>
        <div style={styles.config}>
          <label style={styles.configLabel}>
            <input
              type="checkbox"
              checked={useMock}
              onChange={(e) => setUseMock(e.target.checked)}
            />
            {" "}模拟流
          </label>
          {!useMock && (
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              DeepSeek API
            </span>
          )}
        </div>
      </header>

      {/* 聊天区域 */}
      <main style={styles.chatArea}>
        {displayMessages.length === 0 && (
          <div style={styles.emptyHint}>
            输入旅行需求，体验流式响应 —— 观察首 chunk 如何到达并即时渲染。
          </div>
        )}
        {displayMessages.map((msg, i) => (
          <ChatBubble key={i} message={msg} />
        ))}
        <div ref={chatEndRef} />
      </main>

      {/* 底部状态栏 */}
      {streamResult.firstChunkAt !== null && (
        <StreamBar
          isLoading={streamResult.isLoading}
          firstChunkAt={streamResult.firstChunkAt}
          chunkCount={streamResult.chunks.length}
          error={streamResult.error}
          onAbort={streamResult.abort}
          onCorrect={handleCorrect}
          correctionPresets={CORRECTION_PRESETS}
        />
      )}

      {/* 输入区 */}
      <footer style={styles.inputArea}>
        <input
          style={styles.textInput}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="输入旅行需求，如：帮我规划三天东京行程"
          disabled={streamResult.isLoading}
        />
        <button
          style={{
            ...styles.sendBtn,
            opacity: streamResult.isLoading ? 0.5 : 1,
          }}
          onClick={handleSend}
          disabled={streamResult.isLoading}
        >
          发送
        </button>
      </footer>
    </div>
  );
}
