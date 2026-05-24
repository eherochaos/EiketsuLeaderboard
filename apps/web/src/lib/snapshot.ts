import type { LeaderboardSnapshot } from "../types";

export async function loadSnapshot(): Promise<LeaderboardSnapshot> {
  const response = await fetch("/data/leaderboard-snapshot.json", { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to load leaderboard snapshot: ${response.status}`);
  }

  return await response.json() as LeaderboardSnapshot;
}
