import { memo } from "react";
import type { StreamChunk } from "../../streaming/types";
import { styles } from "../styles";
import { AssistantContent } from "./AssistantContent";

export type UIMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; chunks: StreamChunk[]; isStreaming: boolean };

export const ChatBubble = memo(function ChatBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const isStreaming = message.role === "assistant" && message.isStreaming;

  return (
    <div
      style={{
        ...styles.bubbleRow,
        justifyContent: isUser ? "flex-end" : "flex-start",
      }}
    >
      <div
        style={{
          ...styles.bubble,
          backgroundColor: isUser ? "#3b82f6" : "#1e293b",
          color: "#e2e8f0",
          alignSelf: isUser ? "flex-end" : "flex-start",
        }}
      >
        <div style={styles.bubbleRole}>{isUser ? "You" : "Assistant"}</div>
        {isUser ? (
          // 用户消息：纯文本
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
            {message.content}
          </div>
        ) : (
          // 助手消息：按 chunks 分流渲染；无 chunks 时退回纯文本
          <AssistantContent message={message} isStreaming={isStreaming} />
        )}
      </div>
    </div>
  );
});
