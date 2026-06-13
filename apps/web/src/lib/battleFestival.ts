import type { LeaderboardRefreshUpload } from "../../../../packages/contracts/leaderboard-refresh-status.js";
import { loadRefreshStatus } from "./refreshStatus";

export interface BattleFestivalPeriod {
  dateFrom: string;
  dateTo: string;
  targetVersion: string;
  sourceRunId: number | string;
  sampleSize: number;
}

function dateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const tokyoYear = parts.find((part) => part.type === "year")?.value;
  const tokyoMonth = parts.find((part) => part.type === "month")?.value;
  const tokyoDay = parts.find((part) => part.type === "day")?.value;
  if (tokyoYear && tokyoMonth && tokyoDay) return `${tokyoYear}-${tokyoMonth}-${tokyoDay}`;

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isBattleFestivalActive(period: BattleFestivalPeriod | null, now: Date = new Date()): boolean {
  if (!period?.dateFrom || !period.dateTo) return false;
  const today = dateKey(now);
  return period.dateFrom <= today && today <= period.dateTo;
}

export async function loadBattleFestivalPeriod(): Promise<BattleFestivalPeriod | null> {
  try {
    const status = await loadRefreshStatus();
    const uploads = [
      status.latestUpload,
      ...status.recentUploads
    ].filter((upload): upload is LeaderboardRefreshUpload => upload?.modeScope === "battle_festival");
    const upload = uploads[0] ?? null;
    const dateFrom = upload?.festivalDateFrom || upload?.dateFrom;
    const dateTo = upload?.festivalDateTo || upload?.dateTo;
    if (!upload || !dateFrom || !dateTo) return null;

    return {
      dateFrom,
      dateTo,
      targetVersion: upload.targetVersion || "",
      sourceRunId: upload.id,
      sampleSize: upload.importedMatchCount || upload.matchCount || 0
    };
  } catch {
    return null;
  }
}
