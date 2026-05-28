import type { ErrorChunk } from "../../streaming/types";
import { styles } from "../styles";

/** JSON 传输中断或解析失败时的错误指示 */
export function ErrorWidget({ chunk }: { chunk: ErrorChunk }) {
  return (
    <div style={styles.errorCard}>
      {chunk.message}
    </div>
  );
}
