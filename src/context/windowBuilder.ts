import type { ChatMessage } from "../types/chatMessage";
import type { UserProfile } from "../types/chatMessage";
import type { ContextWindow } from "./updateMessage";
import { formatUserProfile } from "../profile/formatter";

/** 从零构建 ContextWindow。 */
export function buildInitialWindow(params: {
  systemPrompt: string;
  userProfile: UserProfile;
  memorySummary?: string;
}): ContextWindow {
  const now = new Date().toISOString();

  return {
    systemPrompt: {
      id: "system-prompt",
      role: "system",
      content: params.systemPrompt,
      created_at: now,
    } as ChatMessage,

    profileData: params.userProfile,

    userProfile: {
      id: "user-profile",
      role: "system",
      content: formatUserProfile(params.userProfile),
      created_at: now,
    } as ChatMessage,

    memorySummary: {
      id: "memory-summary",
      role: "system",
      content: params.memorySummary ?? "(No prior conversation.)",
      created_at: now,
    } as ChatMessage,

    recentHistory: [],

    latestUser: null as any,
  };
}

/** 构建最终发送给模型的消息数组，按 5 层结构拼接。 */
export function toModelMessages(window: ContextWindow): ChatMessage[] {
  const messages: ChatMessage[] = [
    window.systemPrompt,
    window.userProfile,
    window.memorySummary,
    ...window.recentHistory,
  ];

  if (window.latestUser) {
    messages.push(window.latestUser);
  }

  return messages;
}
