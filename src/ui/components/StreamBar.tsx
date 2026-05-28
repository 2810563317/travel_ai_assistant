import { useState, useEffect } from "react";
import { styles } from "../styles";

/** 底部流式状态条：展示首 chunk 延迟、chunk 计数等信息 */
export function StreamBar({
  isLoading,
  firstChunkAt,
  chunkCount,
  error,
  onAbort,
  onCorrect,
  correctionPresets,
}: {
  isLoading: boolean;
  firstChunkAt: number;
  chunkCount: number;
  error: string | null;
  onAbort: () => void;
  onCorrect: (reason: string, pruning: "strip" | "annotate") => void;
  correctionPresets: { label: string; reason: string; pruning: "strip" | "annotate" }[];
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isLoading) return;
    const timer = setInterval(() => {
      setElapsed(Date.now() - firstChunkAt);
    }, 100);
    return () => clearInterval(timer);
  }, [isLoading, firstChunkAt]);

  const ttfb = firstChunkAt ? `首 chunk 延迟: ${elapsed}ms` : "";

  return (
    <div style={styles.streamBar}>
      <span style={{ color: error ? "#ef4444" : "#94a3b8" }}>
        {error
          ? `错误: ${error}`
          : isLoading
            ? `接收中... ${ttfb} | chunks: ${chunkCount}`
            : `完成 | 共 ${chunkCount} chunks | ${ttfb}`}
      </span>
      {isLoading && (
        <div style={styles.correctGroup}>
          {correctionPresets.map((p) => (
            <button key={p.label} onClick={() => onCorrect(p.reason, p.pruning)} style={styles.correctBtn}>
              {p.label}
            </button>
          ))}
          <button onClick={onAbort} style={styles.abortBtn}>
            取消
          </button>
        </div>
      )}
    </div>
  );
}
