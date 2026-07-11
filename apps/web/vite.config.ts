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
    },
    "/api/leaderboard-refresh-status": {
      target: leaderboardApiOrigin,
      changeOrigin: true
    },
    "/api/version-options": {
      target: leaderboardApiOrigin,
      changeOrigin: true
    },
    "/api/tier-list-snapshot": {
      target: leaderboardApiOrigin,
      changeOrigin: true
    },
    "/api/tier-list-deck-config": {
      target: leaderboardApiOrigin,
      changeOrigin: true
    },
    "/api/battle-festival-snapshot": {
      target: leaderboardApiOrigin,
      changeOrigin: true
    },
    "/api/battle-festival-deck-config": {
      target: leaderboardApiOrigin,
      changeOrigin: true
    },
    "/api/match-search-options": {
      target: leaderboardApiOrigin,
      changeOrigin: true
    },
    "/api/match-search": {
      target: leaderboardApiOrigin,
      changeOrigin: true
    },
    "/api/site-analytics-event": {
      target: leaderboardApiOrigin,
      changeOrigin: true
    },
    "/api/site-analytics-summary": {
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
          leaderboardStatus: resolve(__dirname, "leaderboard-status/index.html"),
          webmaster: resolve(__dirname, "webmaster/index.html"),
          adminStats: resolve(__dirname, "admin-stats/index.html"),
          matchSearch: resolve(__dirname, "match-search/index.html"),
          tierList: resolve(__dirname, "tier-list/index.html"),
          battleFestival: resolve(__dirname, "battle-festival/index.html")
        }
      }
    }
  };
});
