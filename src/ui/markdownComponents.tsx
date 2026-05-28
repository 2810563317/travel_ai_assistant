import React from "react";

/**
 * react-markdown 自定义组件映射：将标准 HTML 元素覆写为暗色主题样式。
 *
 * 为什么自定义而不是用 CSS 类：
 *   气泡内的 Markdown 内容被渲染为纯 HTML（p / strong / code / ul 等），
 *   使用内联样式可以确保颜色、间距与气泡的 #1e293b 背景协调，
 *   无需额外的全局 CSS 文件。
 *
 * 与 rAF 节流的性能关系：
 *   react-markdown 每次接收到新的 children 字符串时都会重新解析 AST。
 *   但 rAF 将其限制为最多 60fps，且单条聊天消息的文本量（< 10KB）
 *   在 remark 解析器中耗时 < 1ms，远低于 16ms 的帧预算。
 */
export const markdownComponents = {
  // 段落：用 div 替代 p 以避免 React 的 hydration 警告（div 嵌套规则更宽松）
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<"p">) => (
    <div style={{ margin: "4px 0", lineHeight: 1.7 }} {...props}>
      {children}
    </div>
  ),
  strong: ({ children, ...props }: React.ComponentPropsWithoutRef<"strong">) => (
    <strong style={{ color: "#fbbf24", fontWeight: 700 }} {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }: React.ComponentPropsWithoutRef<"em">) => (
    <em style={{ color: "#c4b5fd", fontStyle: "italic" }} {...props}>
      {children}
    </em>
  ),
  code: ({ children, ...props }: React.ComponentPropsWithoutRef<"code">) => (
    <code
      style={{
        backgroundColor: "#0f172a",
        color: "#f97316",
        padding: "1px 5px",
        borderRadius: 3,
        fontSize: "0.9em",
        fontFamily: "monospace",
      }}
      {...props}
    >
      {children}
    </code>
  ),
  ul: ({ children, ...props }: React.ComponentPropsWithoutRef<"ul">) => (
    <ul style={{ margin: "4px 0", paddingLeft: 18 }} {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.ComponentPropsWithoutRef<"ol">) => (
    <ol style={{ margin: "4px 0", paddingLeft: 18 }} {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }: React.ComponentPropsWithoutRef<"li">) => (
    <li style={{ margin: "2px 0", lineHeight: 1.6 }} {...props}>
      {children}
    </li>
  ),
  hr: (props: React.ComponentPropsWithoutRef<"hr">) => (
    <hr style={{ borderColor: "#334155", margin: "10px 0" }} {...props} />
  ),
  blockquote: ({ children, ...props }: React.ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote
      style={{
        borderLeft: "3px solid #3b82f6",
        paddingLeft: 10,
        margin: "6px 0",
        color: "#94a3b8",
      }}
      {...props}
    >
      {children}
    </blockquote>
  ),
};
