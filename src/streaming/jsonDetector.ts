import type { StreamChunk, JsonDetectorState } from "./types";

/**
 * 匹配 JSON 卡片起始位置的模式：
 *   {"type":"  或  {"type": "  或  {"type" :"
 *
 * 只有在 type 的值是字符串时才触发 JSON 模式。
 * 这是为了防止误匹配，例如 {"type": true} 或 {"type": 123} 不会触发。
 *
 * 为什么用正则而非简单的 indexOf：
 *   - 大模型可能在 type 和冒号/引号之间插入空格
 *   - 需要精确匹配 "type" 后紧跟字符串值的模式
 */
export const JSON_START_RE = /\{"type"\s*:\s*"/;

/**
 * 在文本中查找 JSON 对象/数组的闭合位置。
 *
 * 从头扫描 text，跟踪：
 *   - brace/bracket depth（{} 和 [] 的嵌套深度）
 *   - 是否在字符串内部（"" 之间的括号不计入深度）
 *   - 转义字符（\" 不计为字符串边界）
 *
 * 算法要点：
 *   1. 遇到 { 或 [ → depth++，标记 started=true（排除了还没遇到任何括号的纯文本前缀）
 *   2. 遇到 } 或 ] → depth--，如果 started && depth===0 说明找到了闭合点
 *   3. 遇到 " → 切换 inString 状态
 *   4. 遇到 \" → 转义，跳过下一个字符
 *
 * 为什么需要 started 标志：
 *   考虑输入 "abc}" —— 如果 depth 初始为 0，遇到 } 时 depth 变成 -1，
 *   虽然不会在 -1 时返回，但如果不在 JSON 上下文内遇到 } 仍可能误判。
 *   started 确保只有真正进入了 JSON 结构后才开始判断闭合。
 *
 * @param text - 待扫描的文本
 * @returns 闭合括号之后的位置索引（可用作 slice 的 end 参数）；若未闭合则返回 -1
 */
export function findJsonEnd(text: string): number {
  let depth = 0; // 当前括号嵌套深度
  let inString = false; // 是否在字符串字面量内部
  let escape = false; // 上一个字符是否是反斜杠转义
  let started = false; // 是否已进入 JSON 结构（遇到过 { 或 [）

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    // ---- 处理转义 ----
    if (escape) {
      escape = false; // 转义只作用一个字符，重置
      continue;
    }

    // 在字符串内部遇到反斜杠 → 下一字符被转义
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }

    // ---- 字符串边界 ----
    if (ch === '"') {
      inString = !inString;
      continue;
    }

    // 字符串内部的所有字符（包括括号）均不计入深度
    if (inString) continue;

    // ---- 括号计数 ----
    if (ch === "{" || ch === "[") {
      depth++;
      started = true; // 已确认进入 JSON 结构
    } else if (ch === "}" || ch === "]") {
      depth--;
      // 闭合条件：started 确保我们确实在 JSON 内，depth===0 表示最外层已闭合
      if (started && depth === 0) return i + 1;
    }
  }

  // 遍历结束仍未闭合（或不满足闭合条件），返回 -1
  return -1;
}

/**
 * 尝试将一段完整 JSON 文本解析为结构化 StreamChunk。
 *
 * 解析结果有三种可能：
 *   1. 合法 JSON 且包含字符串 type 字段 → CardChunk（卡片）
 *   2. 合法 JSON 但不满足卡片格式（缺少 type / type 不是字符串 / 是数组） → TextChunk
 *   3. JSON 语法错误 → TextChunk
 *
 * 设计决策：情况 2 和 3 都退化为 TextChunk 而非 ErrorChunk。
 * 理由：如果不是卡片格式，它可能就是用户应该看到的普通文本内容（如代码示例中的 JSON）。
 * 只有流中断导致的不完整 JSON（由 flushJsonDetector 处理）才生成 ErrorChunk。
 */
export function parseJsonChunk(jsonText: string): StreamChunk {
  try {
    const parsed = JSON.parse(jsonText);

    // 校验是否为合法的卡片 JSON：
    //   - 非 null
    //   - object 类型
    //   - 非数组（JSON 数组即使有 type 字段也不是卡片）
    //   - 包含 type 字段
    //   - type 字段的值为 string
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "type" in parsed &&
      typeof (parsed as Record<string, unknown>).type === "string"
    ) {
      return {
        kind: "card",
        cardType: (parsed as Record<string, unknown>).type as string,
        data: parsed as Record<string, unknown>,
      };
    }

    // 合法 JSON 但不是卡片格式 → 当普通文本展示
    return { kind: "text", text: jsonText };
  } catch {
    // JSON.parse 失败说明括号计数有误（理论上不应该发生，但作为安全阀保留）
    return { kind: "text", text: jsonText };
  }
}

/**
 * 处理一批 SSE 帧，通过状态机将文本中的 JSON 卡片识别出来。
 *
 * 这是 JSON 检测的核心函数。它在每次网络 chunk 带来的新帧上调用，
 * 共享同一个 JsonDetectorState，实现跨网络 chunk 的 JSON 识别。
 *
 * 处理流程（对每个 frame）：
 *
 *   text 模式：
 *     - 用 JSON_START_RE 正则搜索 {"type":" 模式
 *     - 未找到 → 整帧作为 TextChunk 输出
 *     - 找到 → 前面的文本作为 TextChunk；从匹配位置进入 json 模式
 *
 *   json 模式：
 *     - 将帧内容追加到 state.buffer
 *     - 调用 findJsonEnd 检查是否已闭合
 *     - 未闭合 → continue，等待下一个 chunk 的更多数据
 *     - 已闭合 → 切出 JSON 文本，调用 parseJsonChunk；剩余部分递归处理
 *
 * 递归处理的设计原因：
 *   同一帧内 JSON 闭合后可能紧跟更多文本或另一个 JSON 块：
 *   …}继续推荐：{"type":"weather_card",...}
 *               ↑ 这部分不能被丢弃，需要继续识别
 */
export function processFrames(frames: string[], state: JsonDetectorState): StreamChunk[] {
  const result: StreamChunk[] = [];

  for (const frame of frames) {
    if (state.mode === "text") {
      // ── text 模式：搜索 JSON 卡片起始标志 ──
      const idx = frame.search(JSON_START_RE);
      if (idx === -1) {
        // 未找到任何 JSON 起始标志，整帧都是普通文本
        if (frame.length > 0) result.push({ kind: "text", text: frame });
        continue;
      }

      // JSON 起始标志之前的内容 → 普通文本
      if (idx > 0) result.push({ kind: "text", text: frame.slice(0, idx) });

      // 进入 JSON 模式，从匹配位置开始收集
      state.mode = "json";
      state.buffer = frame.slice(idx);
      // 不 continue，继续执行下面的 JSON 处理逻辑（可能 JSON 在同一帧内就闭合了）
    } else {
      // ── json 模式：继续追加到未闭合的 JSON 缓冲区 ──
      state.buffer += frame;
    }

    // ── 检查 JSON 是否已闭合 ──
    const endIdx = findJsonEnd(state.buffer);
    if (endIdx === -1) continue; // 仍未闭合，需要等待更多数据到达

    // 切出完整的 JSON 文本
    const jsonText = state.buffer.slice(0, endIdx);
    // 闭合括号之后的内容 —— 可能是普通文本或另一个 JSON 块
    const remainder = state.buffer.slice(endIdx);

    // 重置状态机，回到文本模式
    state.buffer = "";
    state.mode = "text";

    // 解析 JSON 并生成对应 chunk
    result.push(parseJsonChunk(jsonText));

    // 递归处理闭合后的剩余内容
    // 例如：…json…}剩余文本{"type":"another_card",...}
    if (remainder) {
      const sub = processFrames([remainder], state);
      result.push(...sub);
    }
  }

  return result;
}

/**
 * 流结束时调用：处理状态机中尚未闭合的 JSON 缓冲区。
 *
 * 当网络流正常结束或异常断开时，状态机可能还停留在 json 模式。
 * 此函数执行最后的回收工作：
 *
 *   1. 尝试 JSON.parse —— 流结束时可能刚好凑齐了完整 JSON（边界对齐）
 *   2. 若解析成功且为有效卡片 → 返回 CardChunk
 *   3. 若解析失败 → 返回 ErrorChunk 做优雅降级，不抛异常
 *
 * 优雅降级的意义：
 *   如果流在 {"type":"route_ca 处断开，直接拼接源码到 fullText 会让用户看到乱码。
 *   生成 ErrorChunk 让 UI 渲染一条"加载失败"提示，体验远好于 raw JSON 或白屏 crash。
 *
 * @param state   - 状态机状态（原地修改，会重置回 text 模式）
 * @param showRaw - 是否在 ErrorChunk.raw 中包含完整的原始缓冲区（调试用途）
 * @returns 可能包含一个 CardChunk 或 ErrorChunk，也可能为空
 */
export function flushJsonDetector(state: JsonDetectorState, showRaw: boolean): StreamChunk[] {
  // 不在 JSON 模式或缓冲区为空 → 无事可做
  if (state.mode !== "json" || !state.buffer) return [];

  const buffer = state.buffer;

  // 重置状态机（先取值再重置，避免后续逻辑误用已清空的 buffer）
  state.mode = "text";
  state.buffer = "";

  // 尽最大努力解析：流结束时那最后一个 chunk 可能刚好补齐了缺失的 }
  try {
    const parsed = JSON.parse(buffer);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "type" in parsed &&
      typeof (parsed as Record<string, unknown>).type === "string"
    ) {
      return [
        {
          kind: "card",
          cardType: (parsed as Record<string, unknown>).type as string,
          data: parsed as Record<string, unknown>,
        },
      ];
    }
  } catch {
    // 确实解析不了，说明 JSON 在中途被截断，走下面的 ErrorChunk 降级
  }

  // 生成优雅降级提示
  // 只截取前 200 个字符作为预览，避免在 UI 上展示大段乱码
  const preview = buffer.length > 200 ? buffer.slice(0, 200) + "…" : buffer;
  return [
    {
      kind: "error",
      message: "数据传输中断，行程卡片无法完整展示",
      raw: showRaw ? buffer : preview,
    },
  ];
}
