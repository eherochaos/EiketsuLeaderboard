import type {
  LeaderboardRefreshStatus,
  LeaderboardSnapshot,
  LeaderboardVersionManifest,
  MatchSearchOptions,
  TierListSnapshot,
} from "../types";
import { loadMatchSearchOptions } from "./matchSearch";
import { loadRefreshStatus } from "./refreshStatus";
import { loadSnapshot } from "./snapshot";
import { loadTierListSnapshot } from "./tierList";
import { loadVersionOptions } from "./versionOptions";

export type AdminSourceKey =
  | "versionOptions"
  | "leaderboard"
  | "tierList"
  | "battleFestival"
  | "matchSearch"
  | "refresh";

export const ADMIN_QUICK_LINKS = [
  { label: "数据状态", href: "/leaderboard-status/" },
  { label: "访问统计", href: "/admin-stats/" },
  { label: "榜单首页", href: "/leaderboard/" },
  { label: "TierList", href: "/tier-list/" },
  { label: "对局搜索", href: "/match-search/" },
] as const;

export function loadAdminVersionOptions(): Promise<LeaderboardVersionManifest> {
  return loadVersionOptions();
}

export function loadAdminLeaderboardSnapshot(): Promise<LeaderboardSnapshot> {
  return loadSnapshot();
}

export function loadAdminTierListSnapshot(): Promise<TierListSnapshot> {
  return loadTierListSnapshot("tierList");
}

export function loadAdminBattleFestivalSnapshot(): Promise<TierListSnapshot> {
  return loadTierListSnapshot("battleFestival");
}

export function loadAdminMatchSearchOptions(): Promise<MatchSearchOptions> {
  return loadMatchSearchOptions();
}

export function loadAdminRefreshStatus(): Promise<LeaderboardRefreshStatus> {
  return loadRefreshStatus();
}

