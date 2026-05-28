import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api/deepseek": {
          target: "https://api.deepseek.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/deepseek/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (_proxyReq, _req, _res) => {
              // 服务端注入 API Key，浏览器永远看不到此 header
              _proxyReq.setHeader("Authorization", `Bearer ${env.DEEPSEEK_API_KEY}`);
            });
          },
        },
      },
    },
  };
});
