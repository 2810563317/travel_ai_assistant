import { useState, useRef, useCallback, useEffect } from "react";
import type { StreamState, StreamSource, StreamChunk, JsonDetectorState } from "./types";
import { parseSSEChunk } from "./sseParser";
import { processFrames, flushJsonDetector } from "./jsonDetector";

// ==============================================================================
// useStreamResponse Hook
// ==============================================================================

/**
 * 流式响应处理 Hook
 *
 * 职责：
 *   1. 发起流式请求（fetch 或直接消费 ReadableStream）
 *   2. 逐 chunk 解码并解析 SSE 帧
 *   3. 检测帧中的 JSON 卡片并拦截为结构化数据
 *   4. 通过 requestAnimationFrame 节流合并高频 setState，确保 60fps 流畅渲染
 *   5. 支持取消、错误恢复、组件卸载时资源清理
 *
 * 数据流总览：
 *
 *   Network Chunk → TextDecoder → SSE Frame → processFrames() → StreamChunk[]
 *       ↓                                                              ↓
 *   ReadableStream                                           pendingChunksRef
 *       ↓                                                              ↓
 *   consumeStream()                                          scheduleFlush()
 *       ↓                                                              ↓
 *   while(read) {...}                                      requestAnimationFrame
 *                                                                     ↓
 *                                                             flushChunks()
 *                                                                     ↓
 *                                                           setState (单次，合并后)
 *                                                                     ↓
 *                                                          React 重渲染 (≤60fps)
 *
 * 生命周期管理：
 *   - start()    → 重置所有状态，启动新流
 *   - abort()    → 设置取消标志 + 取消 rAF + AbortController.abort()
 *   - 组件卸载    → useEffect cleanup 取消 rAF
 *   - 流正常结束  → 取消 rAF + 同步 flush
 *   - 流出错      → 取消 rAF + 同步 flush + 设置 error 状态
 *
 * @returns state - 当前流状态（fullText, chunks, isLoading, error, firstChunkAt）
 *          start - 启动新流
 *          abort - 取消当前流
 */
export function useStreamResponse() {
  // ---- 核心状态 ----
  const [state, setState] = useState<StreamState>({
    fullText: "",
    chunks: [],
    isLoading: false,
    error: null,
    firstChunkAt: null,
  });

  // ---- AbortController 引用，用于取消正在进行的 fetch / 流 ----
  const abortRef = useRef<AbortController | null>(null);

  /**
   * 流的"代际"计数器。
   *
   * 每次调用 start() 时递增；旧的异步 catch 块在最终写入 state 前会检查
   * generationRef.current !== gen，若已不匹配说明后续又启动了新流，
   * 旧流的 setState（如 isLoading: false）应被丢弃，避免覆盖新流的状态。
   *
   * 这是解决"用户快速连续取消 + 重发"场景下状态竞态的最小实现。
   */
  const generationRef = useRef(0);

  /** 取消标志 —— consumeStream 主循环每次迭代检查，支持 mock 流取消 */
  const cancelledRef = useRef(false);

  // ---- rAF 节流相关 ----

  /**
   * 待 flush 的 chunk 缓冲区
   *
   * 在两次 rAF 回调之间，所有通过 processFrames 产出的 StreamChunk
   * 都先累积在这里，等到下一帧重绘前由 flushChunks 一次性取出并 setState。
   * 这样就实现了"无论数据来得多快，一帧最多只渲染一次"的效果。
   */
  const pendingChunksRef = useRef<StreamChunk[]>([]);

  /**
   * 已注册但尚未执行的 requestAnimationFrame ID
   *
   * 非 null 表示已安排了一次 flush，后续到达的数据只需追加到缓冲区，
   * 不需要再注册新的 rAF（避免多个 rAF 回调在短时间内连续触发 setState）。
   */
  const rafIdRef = useRef<number | null>(null);

  /**
   * 首个 chunk 到达的物理时间戳
   *
   * 使用 ref 而非 state 的原因：时间戳需要在异步的 consumeStream 中写入，
   * 但在 setState 的函数式更新中读取（通过 firstChunkAt ?? firstChunkTimeRef.current）。
   * 如果用 state，会因为闭包导致读到过期的值。
   */
  const firstChunkTimeRef = useRef<number | null>(null);

  /**
   * 将缓冲区中的所有 chunk 一次性写入 state。
   *
   * 设计要点：
   *   - 使用 setState 的函数式更新（prev => ...）避免依赖外部 state 闭包
   *   - 只将 TextChunk 拼入 fullText，CardChunk 和 ErrorChunk 不进入 fullText
   *   - firstChunkAt 只在首次 flush 时记录（prev.firstChunkAt ?? ref）
   */
  const flushChunks = useCallback(() => {
    if (cancelledRef.current) return; // 已取消，跳过
    const chunks = pendingChunksRef.current;
    if (chunks.length === 0) return; // 空缓冲区，跳过

    // 取出并清空缓冲区（在 setState 外同步操作，避免并发问题）
    pendingChunksRef.current = [];

    setState((prev) => {
      let fullText = prev.fullText;

      // 遍历本次要 flush 的 chunk，只有 TextChunk 才拼入 fullText
      // CardChunk / ErrorChunk 只在 chunks 数组中，不污染纯文本
      for (const c of chunks) {
        if (c.kind === "text") fullText += c.text;
      }

      return {
        ...prev,
        fullText,
        chunks: [...prev.chunks, ...chunks],
        // 首次 flush 时记录首字节时间，之后保持不变
        firstChunkAt: prev.firstChunkAt ?? firstChunkTimeRef.current,
      };
    });
  }, []);

  /**
   * 安排一次 flush 在下一次浏览器重绘前执行。
   *
   * 防重复机制：如果 rafIdRef 非 null，说明已经安排过了，
   * 当前数据已追加到缓冲区，直接返回即可，不需要再注册新的 rAF。
   *
   * 这意味着无论在同一帧内调用多少次 scheduleFlush，
   * 实际上只会执行一次 flushChunks → 一次 setState → 一次重渲染。
   */
  const scheduleFlush = useCallback(() => {
    // 已安排或已取消则跳过
    if (rafIdRef.current !== null || cancelledRef.current) return;

    rafIdRef.current = requestAnimationFrame(() => {
      // rAF 回调执行时清除 ID，允许下一帧重新注册
      rafIdRef.current = null;
      flushChunks();
    });
  }, [flushChunks]);

  /**
   * 组件卸载时的清理：取消任何尚未执行的 rAF。
   *
   * 使用 useEffect 的 cleanup 函数确保即使组件在流进行中被卸载，
   * 也不会留下悬空的回调尝试更新已卸载组件的状态（React 会警告）。
   */
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  /**
   * 消费 ReadableStream，逐 chunk 读取、解码、解析并调度渲染。
   *
   * 这是整个 hook 的核心异步循环。在 start() 中被调用。
   *
   * 流程：
   *   while (reader 未完成) {
   *     1. 读取原始字节 → decoder.decode() 解码为文本
   *     2. 追加到跨 chunk 的 SSE buffer
   *     3. parseSSEChunk() 切出完整帧 + 保留不完整尾部
   *     4. processFrames() 将帧通过 JSON 检测状态机
   *     5. 产出 StreamChunk[] → 追加到 pendingChunksRef
   *     6. scheduleFlush() 安排在下一帧渲染
   *   }
   *   流结束后：
   *     7. 处理 buffer 残余 → flushJsonDetector() 回收未闭合 JSON
   *     8. 取消 rAF + 同步 flush 确保最后一帧数据不丢失
   *
   * @param stream - 已获取的 ReadableStream（来自 fetch response.body 或外部传入）
   */
  async function consumeStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    // ReadableStream 的读取器，通过 reader.read() 逐块获取数据
    const reader = stream.getReader();

    // TextDecoder 用于将 UTF-8 字节解码为 JavaScript 字符串
    // stream: true 表示流式解码 —— 多字节字符（如中文）可能被切割到两个 chunk，
    // decoder 会记住未完成的部分并在下次解码时补齐
    const decoder = new TextDecoder();

    // SSE 帧解析的跨 chunk 缓冲区
    // 一个 SSE data 帧可能被 TCP 切分到两个网络 chunk 中，
    // 此 buffer 保留上次切分后不完整的尾部，等待与下一 chunk 拼接
    let buffer = "";

    // JSON 检测状态机实例，在 consumeStream 的整个生命周期中保持
    // 确保跨 chunk 的 JSON 卡片能被正确拼接和识别
    const detector: JsonDetectorState = { mode: "text", buffer: "" };

    try {
      // ── 主循环：逐 chunk 读取网络数据 ──
      while (true) {
        // 每次迭代前检查取消标志 —— 支持 mock 流的取消
        if (cancelledRef.current) break;

        // reader.read() 返回 { done: boolean, value: Uint8Array | undefined }
        // done=true 表示流已关闭（正常结束或服务端主动关闭）
        const { done, value } = await reader.read();
        if (done) break;

        // 流式解码 UTF-8 字节
        const text = decoder.decode(value, { stream: true });
        // 追加到 SSE buffer，与上次保留的尾部拼接
        buffer += text;

        // SSE 帧切分
        const { frames, remainder } = parseSSEChunk(buffer);
        buffer = remainder; // 保留不完整尾部，等待下个 chunk

        if (frames.length > 0) {
          // 记录首个 chunk 到达的时间戳（只记录一次）
          if (firstChunkTimeRef.current === null) {
            firstChunkTimeRef.current = Date.now();
          }

          // 通过 JSON 检测状态机处理帧
          const chunks = processFrames(frames, detector);
          if (chunks.length > 0) {
            // 累积到缓冲区，等待 rAF 合并
            pendingChunksRef.current.push(...chunks);
            // 安排下一次渲染（如果已安排则此调用无操作）
            scheduleFlush();
          }
        }
      }

      // ── 流结束后不再做 flush，让 abort 负责最后的 UI 状态 ──
      if (cancelledRef.current) return;

      // ── 流结束处理 ──
      // SSE buffer 中可能还有残留（流在 data 帧中间结束了）
      if (buffer.trim()) {
        // 强制补两个换行，让 parseSSEChunk 将残余内容作为完整帧切出
        const { frames } = parseSSEChunk(buffer + "\n\n");
        if (frames.length > 0) {
          const chunks = processFrames(frames, detector);
          if (chunks.length > 0) {
            pendingChunksRef.current.push(...chunks);
          }
        }
      }

      // 回收 JSON 检测状态机中未闭合的数据（优雅降级）
      const finalChunks = flushJsonDetector(detector, true);
      if (finalChunks.length > 0) {
        pendingChunksRef.current.push(...finalChunks);
      }

      // 取消任何尚未执行的 rAF，立即同步 flush
      // 这是为了确保在异步函数返回前，所有缓冲的数据都已被写入 state
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      flushChunks();
    } finally {
      // 无论成功、失败还是取消，都必须释放 reader 锁
      // 否则 ReadableStream 将被锁定，无法再次读取
      reader.releaseLock();
    }
  }

  /**
   * 启动一个新的流式请求。
   *
   * 生命周期：
   *   1. 取消上一个未完成的流（abortRef.current?.abort()）
   *   2. 创建新的 AbortController 用于本次流
   *   3. 重置所有节流和状态机状态
   *   4. 清空 state 到初始值
   *   5. 根据 source.type 分发：
   *      - "stream" → 直接消费外部传入的 stream
   *      - "url"    → fetch 请求 → 检查状态码 → 消费 response.body
   *   6. 错误处理：AbortError（用户取消）不视为错误；其他异常写入 state.error
   *   7. 流正常结束后将 isLoading 置为 false
   *
   * useCallback 依赖为空数组 []，确保 start 函数引用始终稳定，
   * 可以作为 useEffect 的依赖或传递给子组件而不会导致不必要的重新创建。
   *
   * @param source - 流数据来源
   */
  const start = useCallback(async (source: StreamSource) => {
    // 取消上一个正在进行的流（如果存在）
    abortRef.current?.abort();

    // 创建本次流的 AbortController
    const controller = new AbortController();
    abortRef.current = controller;

    // 递增代际 —— 后续异步回调中若 generationRef 已变，则丢弃当前流的副作用
    const gen = ++generationRef.current;

    // ── 重置所有可变状态 ──
    cancelledRef.current = false;
    pendingChunksRef.current = [];
    firstChunkTimeRef.current = null;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // 清空 state 到初始值，开始加载
    setState({
      fullText: "",
      chunks: [],
      isLoading: true,
      error: null,
      firstChunkAt: null,
    });

    try {
      if (source.type === "stream") {
        // 直接消费外部已获取的 ReadableStream
        await consumeStream(source.stream);
      } else {
        // 通过 fetch 发起请求
        const response = await fetch(source.url, {
          ...source.init,
          signal: controller.signal, // 绑定 AbortController，使外部 abort() 可以取消 fetch
        });

        // 检查 HTTP 状态码
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // response.body 是 ReadableStream<Uint8Array> | null
        const body = response.body;
        if (!body) {
          throw new Error("Response body is empty or non-streamable");
        }

        await consumeStream(body);
      }
    } catch (err: unknown) {
      // 代际已过期：后续已启动新流，丢弃当前流的任何副作用
      if (generationRef.current !== gen) return;

      // ── 错误处理：先 flush 缓冲区中的残余数据 ──
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      flushChunks();

      // AbortError 是用户主动取消的，不是真正的错误
      // DOMException + name==="AbortError" 是 fetch 被 AbortController 取消时的标准行为
      if (err instanceof DOMException && err.name === "AbortError") {
        setState((prev) => ({ ...prev, isLoading: false }));
        return;
      }

      // 其他异常（网络错误、HTTP 错误等）写入 state.error
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : "Unknown error",
        isLoading: false,
      }));
      return;
    }

    // 代际已过期：丢弃当前流的完成信号
    if (generationRef.current !== gen) return;

    // 流正常结束，关闭加载状态
    setState((prev) => ({ ...prev, isLoading: false }));
  }, []);

  /**
   * 取消当前正在进行的流。
   *
   * 做三件事：
   *   1. 设置取消标志 —— consumeStream 主循环在下一次迭代时停止
   *   2. 取消未执行的 rAF（避免在已取消的流上继续更新 UI）
   *   3. 调用 AbortController.abort() 终止 fetch / 流读取
   */
  const abort = useCallback(() => {
    cancelledRef.current = true;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    abortRef.current?.abort();
  }, []);

  // 返回值展开 state 便于消费方直接解构使用
  // as const 确保 TypeScript 推断出最精确的字面量类型
  return { ...state, start, abort } as const;
}
