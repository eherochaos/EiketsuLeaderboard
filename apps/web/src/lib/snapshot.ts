import type { LeaderboardSnapshot } from "../types";

const snapshotUrl = import.meta.env.VITE_LEADERBOARD_SNAPSHOT_URL || "/api/leaderboard-snapshot";

export async function loadSnapshot(): Promise<LeaderboardSnapshot> {
  const response = await fetch(snapshotUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`榜单数据读取失败：${response.status}`);
  }

  return await response.json() as LeaderboardSnapshot;
}
