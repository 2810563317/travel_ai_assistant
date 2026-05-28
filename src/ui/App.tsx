import { useState, useRef, useEffect } from "react";
import { useStreamResponse } from "../streaming/useStreamResponse";
import type { ChatMessage, UserProfile } from "../types/chatMessage";
import { streamDeepSeekChat } from "../api/deepseekClient";
import { createMockSSEStream, MOCK_TOKENS } from "./mockStream";
import { styles } from "./styles";
import { ChatBubble } from "./components/ChatBubble";
import type { UIMessage } from "./components/ChatBubble";
import { StreamBar } from "./components/StreamBar";
import systemPromptRaw from "../prompts/systemPrompt.md?raw";
import { renderPrompt } from "../prompts/promptLoader";
import { buildInitialWindow, toModelMessages, updateMessage } from "../context";
import type { ContextWindow } from "../context";
import { formatUserProfile } from "../profile";

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

/** 初始空画像 —— 随对话推进由 hardTruncate 中的 updateProfileQuickly 逐步填充 */
const EMPTY_PROFILE: UserProfile = {
  user_id: "default",
  preferences: {},
  constraints: {},
  updated_at: new Date().toISOString(),
};

/**
 * 构造 system prompt：加载模板并替换 {{current_date}}、{{timezone}}、{{user_profile}} 变量。
 * 接收 UserProfile，通过 formatUserProfile 渲染真实画像数据。空画像时给出友好提示。
 */
function buildSystemPrompt(profile: UserProfile): string {
  const now = new Date();
  const profileText = formatUserProfile(profile);
  return renderPrompt(systemPromptRaw, {
    current_date: now.toISOString().split("T")[0],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    user_profile:
      profileText === "[User Profile]"
        ? "暂无用户画像（用户尚未填写偏好信息）"
        : profileText,
  });
}

export default function App() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [useMock, setUseMock] = useState(false);
  const [profilePreview, setProfilePreview] = useState<UserProfile>(EMPTY_PROFILE);
  const [showProfile, setShowProfile] = useState(false);
  const streamResult = useStreamResponse();
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Context 引擎 ──
  const contextWindowRef = useRef<ContextWindow>(
    buildInitialWindow({
      systemPrompt: buildSystemPrompt(EMPTY_PROFILE),
      userProfile: EMPTY_PROFILE,
      memorySummary: undefined,
    })
  );
  /** 上一轮已完成的 assistant 回复，供下一轮 updateMessage 消费 */
  const lastAssistantRef = useRef<ChatMessage | null>(null);

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

  /**
   * 通过 context 引擎发送消息到 API：updateMessage → toModelMessages → streamDeepSeekChat。
   * systemPrompt 始终位于 messages[0]（"定海神针"），后续各层按 5 层结构排列。
   */
  async function sendToApi(userChatMsg: ChatMessage) {
    // 每次发送前用最新画像刷新 systemPrompt（画像可能在上一轮 hardTruncate 中被 applyProfilePatch 更新）
    contextWindowRef.current.systemPrompt = {
      ...contextWindowRef.current.systemPrompt,
      content: buildSystemPrompt(contextWindowRef.current.profileData),
    };

    const result = await updateMessage(contextWindowRef.current, {
      userMessage: userChatMsg,
      assistantResponse: lastAssistantRef.current ?? undefined,
    });
    contextWindowRef.current = result.window;
    lastAssistantRef.current = null; // 已消费，清空等待下一轮流结束回填
    setProfilePreview(result.window.profileData); // 同步到调试面板

    const modelMessages = toModelMessages(result.window);

    if (useMock) {
      streamResult.start({ type: "stream", stream: createMockSSEStream(MOCK_TOKENS) });
    } else {
      streamDeepSeekChat({ messages: modelMessages })
        .then((stream) => streamResult.start({ type: "stream", stream }))
        .catch((err) => {
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
          streamResult.start({ type: "stream", stream: errorStream });
        });
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || streamResult.isLoading) return;

    const userMsg: UIMessage = { role: "user", content: text };
    setMessages([...messages, userMsg]);
    setInput("");

    const userChatMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };

    await sendToApi(userChatMsg);
  }

  /** 中断当前流，按剪枝策略清洗历史，自动发起新请求 */
  async function handleCorrect(reason: string, pruning: "strip" | "annotate") {
    if (!streamResult.isLoading) return;

    // 快照当前已输出的内容（在 start() 重置状态前保存）
    const partialContent = streamResult.fullText;
    const partialChunks = streamResult.chunks;

    // UI：固化中断消息 + 追加修正指令
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

    setMessages(allMessages);

    // 根据剪枝策略决定是否将 partial 回复送入 context 窗口
    // strip：partial 不进入窗口 —— assistantResponse 保持为 undefined，避免错误内容干扰模型
    // annotate：partial 进入窗口（标记 ~已中断~），模型可参考其结构/风格
    if (pruning === "annotate" && partialContent) {
      lastAssistantRef.current = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: `~已中断~\n${partialContent}`,
        created_at: new Date().toISOString(),
      };
    }
    // strip 且 lastAssistantRef 中有上一轮合法回复：保留它，让修正指令与上一轮回复配对
    // strip 且 lastAssistantRef 为 null：不做任何事，修正指令独立发送

    const correctionChatMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: `🔧 ${reason}`,
      created_at: new Date().toISOString(),
    };

    await sendToApi(correctionChatMsg);
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

      // 将完整 assistant 回复写入 ref，供下一轮 sendToApi → updateMessage 使用
      lastAssistantRef.current = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: streamResult.fullText,
        created_at: new Date().toISOString(),
      };
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

      {/* 画像预览面板（调试用） */}
      <div style={{
        borderBottom: showProfile ? "1px solid #1e293b" : "none",
      }}>
        <button
          onClick={() => setShowProfile((v) => !v)}
          style={{
            width: "100%",
            padding: "6px 20px",
            fontSize: 12,
            color: "#64748b",
            background: "none",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
            fontFamily: "monospace",
          }}
        >
          {showProfile ? "▾" : "▸"} 画像预览 (UserProfile)
        </button>
        {showProfile && (
          <pre style={{
            margin: "0 20px 10px",
            padding: "10px 14px",
            fontSize: 11,
            fontFamily: "monospace",
            color: "#94a3b8",
            backgroundColor: "#0a101f",
            borderRadius: 6,
            border: "1px solid #1e293b",
            maxHeight: 200,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}>
            {JSON.stringify(profilePreview, null, 2)}
          </pre>
        )}
      </div>

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
