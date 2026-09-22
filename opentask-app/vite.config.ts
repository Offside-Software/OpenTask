import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiBaseUrl = (
    process.env.VITE_API_BASE_URL ||
    process.env.VITE_API_URL ||
    process.env.API_URL ||
    process.env.BACKEND_URL ||
    env.VITE_API_BASE_URL ||
    env.VITE_API_URL ||
    env.API_URL ||
    env.BACKEND_URL ||
    ""
  ).trim();

  return {
    plugins: [react(), tailwindcss()],
    // Load .env files from the repo root instead of the frontend/ folder
    envDir: "../",
    define: {
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiBaseUrl),
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      allowedHosts: ["monasterial-luella-rigid.ngrok-free.dev"],
      proxy: {
        "/api": {
          target: apiBaseUrl || "http://127.0.0.1:8000",
          changeOrigin: true,
          rewrite: (path) => (path.startsWith("/api/v1") ? path : path.replace(/^\/api/, "")),
          cookieDomainRewrite: "",
          followRedirects: false,
        },
      },
    },
  };
});
