import React from "react";
import ReactDOM from "react-dom/client";
import App from "./ui/App";

// 注入 blink 动画 keyframe
const style = document.createElement("style");
style.textContent = `
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0f172a; }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
