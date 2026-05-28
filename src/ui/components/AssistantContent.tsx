import React from "react";
import ReactMarkdown from "react-markdown";
import type { UIMessage } from "./ChatBubble";
import { markdownComponents } from "../markdownComponents";
import { sanitizeStreamingMarkdown } from "../sanitizeMarkdown";
import { CardWidget } from "./CardWidget";
import { ErrorWidget } from "./ErrorWidget";
import { styles } from "../styles";

/** 助手消息内容：合并连续文本块后用 Markdown 渲染，卡片和错误穿插其中 */
export function AssistantContent({
  message,
  isStreaming,
}: {
  message: UIMessage & { role: "assistant" };
  isStreaming: boolean;
}) {
  if (message.chunks.length === 0) {
    // 兼容旧消息：没有 chunks 时退回纯文本渲染
    return (
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
        {message.content}
        {isStreaming && <span style={styles.cursor}>▍</span>}
      </div>
    );
  }

  // 将连续的 text chunk 合并为一个文本组，确保跨帧的 Markdown 语法能正确闭合
  // 例：["**Day", " 1**"] → 合并为 "**Day 1**" → react-markdown 渲染为粗体
  const elements: React.ReactNode[] = [];
  let textBuffer = "";

  for (let i = 0; i < message.chunks.length; i++) {
    const chunk = message.chunks[i];

    if (chunk.kind === "text") {
      textBuffer += chunk.text;
    } else {
      // 遇到卡片或错误：先 flush 累积的文本
      if (textBuffer) {
        elements.push(
          <ReactMarkdown key={`t${elements.length}`} components={markdownComponents}>
            {textBuffer}
          </ReactMarkdown>,
        );
        textBuffer = "";
      }

      if (chunk.kind === "card") {
        elements.push(<CardWidget key={`c${elements.length}`} chunk={chunk} />);
      } else {
        elements.push(<ErrorWidget key={`e${elements.length}`} chunk={chunk} />);
      }
    }
  }

  // 最后一个文本组：流式时裁剪尾部残缺 Markdown 语法
  if (textBuffer) {
    const finalText = isStreaming ? sanitizeStreamingMarkdown(textBuffer) : textBuffer;
    elements.push(
      <ReactMarkdown key={`t${elements.length}`} components={markdownComponents}>
        {finalText}
      </ReactMarkdown>,
    );
  }

  return (
    <div>
      {elements}
      {isStreaming && <span style={styles.cursor}>▍</span>}
    </div>
  );
}
