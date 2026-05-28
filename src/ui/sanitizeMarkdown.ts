/**
 * 流式输出过程中，末尾的 Markdown 语法可能尚未闭合（如只收到了 **Day 还未收到 1**）。
 * 大多数不完整语法会被 react-markdown 的 remark 解析器当作普通文本处理，不会 crash，
 * 但以下两种极端情况会导致视觉异常或乃至"吃掉"后续内容：
 *
 *   1. 奇数个末尾反引号 — 解析器进入行内代码模式，后续内容全部变灰直到下一组反引号
 *   2. [text](url 缺少闭合 ) — 解析器会将后续所有内容视为链接 URL
 *
 * 本函数在流式渲染前裁剪掉这些尾部残缺语法。
 *
 * 为什么不对 ** / * / ~~ 做同样处理：
 *   remark 对未闭合的强调/删除线语法非常宽容，会将 **Day 渲染为纯文本 "**Day"，
 *   等下一个 rAF 帧中闭合后自然变为粗体。这个过渡仅持续一帧（≤16ms），肉眼无法感知。
 *
 * 与 rAF 节流的协同：
 *   rAF 将数据到达节流为最多 60fps 的 setState → 重渲染。
 *   sanitizeStreamingMarkdown 在每次 flush 之后、渲染之前运行，
 *   确保即使存在短暂的不完整语法，也最多暴露一个帧周期。
 */
export function sanitizeStreamingMarkdown(text: string): string {
  let result = text;

  // 1. 末尾奇数个反引号：去掉最后一个，打破行内代码模式
  const trailingTicks = result.match(/`+$/);
  if (trailingTicks && trailingTicks[0].length % 2 === 1) {
    result = result.slice(0, result.length - 1);
  }

  // 2. 末尾未闭合的链接：去掉 "](" 及其之后的内容
  const lastLink = result.lastIndexOf("](");
  if (lastLink !== -1) {
    const after = result.slice(lastLink + 2);
    if (!after.includes(")")) {
      result = result.slice(0, lastLink + 1); // 保留 "]"
    }
  }

  return result;
}
