import type { LeaderboardSnapshot } from "../types";
import { apiUrlWithVersion } from "./versionOptions";

const snapshotUrl = import.meta.env.VITE_LEADERBOARD_SNAPSHOT_URL || "/api/leaderboard-snapshot";

export async function loadSnapshot(targetVersion = ""): Promise<LeaderboardSnapshot> {
  const response = await fetch(apiUrlWithVersion(snapshotUrl, targetVersion), { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`榜单数据读取失败：${response.status}`);
  }

  return await response.json() as LeaderboardSnapshot;
}
