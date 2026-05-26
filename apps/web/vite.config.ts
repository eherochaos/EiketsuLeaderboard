import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const leaderboardApiOrigin = env.VITE_LEADERBOARD_API_ORIGIN || "http://127.0.0.1:8001";
  const leaderboardApiProxy = {
    "/api/leaderboard-snapshot": {
      target: leaderboardApiOrigin,
      changeOrigin: true
    }
  };

  return {
    plugins: [vue()],
    server: {
      proxy: leaderboardApiProxy
    },
    preview: {
      proxy: leaderboardApiProxy
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          leaderboard: resolve(__dirname, "leaderboard/index.html"),
          tierList: resolve(__dirname, "tier-list/index.html")
        }
      }
    }
  };
});
