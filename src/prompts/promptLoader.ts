/**
 * Prompt 模板加载与变量替换工具。
 *
 * 当前为预留实现。接入后端后，Prompt 可能从文件系统、数据库或远程加载。
 * 这里提供最小可用的模板渲染能力。
 */

/** {{variable}} 格式的模板变量替换 */
export function renderPrompt(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.split(`{{${key}}}`).join(value);
  }
  return result;
}

/**
 * 加载 Prompt 模板文本。
 * 当前为同步读取静态文件（通过 Vite 的 ?raw import）。
 * 接入后端后可替换为 fs.readFile 或远程 fetch。
 */
export async function loadPrompt(path: string): Promise<string> {
  // Vite 支持 ?raw 后缀将文件内容作为字符串导入
  const module = await import(/* @vite-ignore */ `${path}?raw`);
  return typeof module.default === "string" ? module.default : "";
}
