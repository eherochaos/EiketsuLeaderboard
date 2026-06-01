import type { LeaderboardRefreshStatus } from "../../../../packages/contracts/leaderboard-refresh-status.js";

const configuredRefreshStatusUrl = import.meta.env.VITE_LEADERBOARD_REFRESH_STATUS_URL;
const defaultRefreshStatusUrls = ["/api/leaderboard-refresh-status", "/assets/leaderboard-refresh-status.json"];

export async function loadRefreshStatus(): Promise<LeaderboardRefreshStatus> {
  const urls = configuredRefreshStatusUrl ? [configuredRefreshStatusUrl] : defaultRefreshStatusUrls;
  let lastError = "";
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        return await response.json() as LeaderboardRefreshStatus;
      }
      lastError = String(response.status);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "network";
    }
  }
  throw new Error(`数据状态读取失败：${lastError || "unknown"}`);
}
