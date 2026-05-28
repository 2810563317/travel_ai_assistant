import type { ChatMessage } from "../types/chatMessage";

/**
 * 从 sliceEnd 往前扫描，找到一个安全的切割点。
 * 安全的切割点 = 一个完整 tool-call 组的结束位置（即下一条 user 消息之前）。
 * 这样可以确保 tool 返回不会与其发起调用的 assistant 消息分离。
 */
export function findAtomicBoundary(messages: ChatMessage[], sliceEnd: number): number {
  let boundary = sliceEnd;

  for (let i = sliceEnd - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "tool") {
      // 该 tool 消息属于前面的 assistant —— 继续回退
      boundary = i;
      continue;
    }
    if (msg.role === "assistant" && "tool_calls" in msg && msg.tool_calls?.length) {
      // 找到了发起 tool call 的 assistant —— 将其也包含进原子组
      boundary = i;
      continue;
    }
    // 其他角色（user 或普通 assistant）：在此消息之后切割是安全的
    break;
  }

  return boundary;
}

/** 从 cursor 位置开始，测量一个不可分割的原子组包含多少条消息。 */
export function measureRemovalGroup(messages: ChatMessage[], cursor: number): number {
  const first = messages[cursor];
  let count = 1;

  if (first.role === "tool") {
    for (let i = cursor + 1; i < messages.length; i++) {
      if (messages[i].role === "tool") count++;
      else break;
    }
  } else if (first.role === "assistant" && "tool_calls" in first && first.tool_calls?.length) {
    for (let i = cursor + 1; i < messages.length; i++) {
      if (messages[i].role === "tool") count++;
      else break;
    }
  }

  return count;
}
