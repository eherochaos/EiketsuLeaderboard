import type { LeaderboardRefreshStatus } from "../../../../packages/contracts/leaderboard-refresh-status.js";

const refreshStatusUrl = import.meta.env.VITE_LEADERBOARD_REFRESH_STATUS_URL || "/api/leaderboard-refresh-status";

export async function loadRefreshStatus(): Promise<LeaderboardRefreshStatus> {
  const response = await fetch(refreshStatusUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`数据状态读取失败：${response.status}`);
  }
  return await response.json() as LeaderboardRefreshStatus;
}
