import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const rootDir = path.resolve(import.meta.dirname, "..");
  const env = {
    ...loadEnv(mode, rootDir, ""),
    ...loadEnv(mode, process.cwd(), ""),
  };

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

  const supabaseUrl = (
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    env.VITE_SUPABASE_URL ||
    env.SUPABASE_URL ||
    ""
  ).trim();

  const supabaseAnonKey = (
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    env.VITE_SUPABASE_ANON_KEY ||
    env.SUPABASE_KEY ||
    env.SUPABASE_ANON_KEY ||
    ""
  ).trim();

  const googleClientId = (
    process.env.VITE_GOOGLE_OAUTH_CLIENT_ID ||
    env.VITE_GOOGLE_OAUTH_CLIENT_ID ||
    ""
  ).trim();

  return {
    plugins: [react(), tailwindcss()],
    // Load .env files from the repo root instead of the frontend/ folder
    envDir: "../",
    define: {
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiBaseUrl),
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(supabaseAnonKey),
      "import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID": JSON.stringify(googleClientId),
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      allowedHosts: true,
      proxy: {
        "/api": {
          target: apiBaseUrl || "http://127.0.0.1:8000",
          changeOrigin: true,
          // Pass WebSocket upgrades through too, for the project realtime events.
          ws: true,
          rewrite: (path) => (path.startsWith("/api/v1") ? path : path.replace(/^\/api/, "")),
          cookieDomainRewrite: "",
          followRedirects: false,
        },
      },
    },
  };
});
