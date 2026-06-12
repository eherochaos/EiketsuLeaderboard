export const LEADERBOARD_REFRESH_STATUS_ENDPOINT: string;
export const LEADERBOARD_REFRESH_STATUS_REFRESH_FIELDS: readonly string[];
export const LEADERBOARD_REFRESH_STATUS_ROOT_FIELDS: readonly string[];

export interface LeaderboardRefreshRun {
  id: number;
  status: string;
  targetVersion: string;
  dateFrom: string;
  dateTo: string;
  modeScope?: string;
  festivalDateFrom?: string;
  festivalDateTo?: string;
  uploadWatermark: number;
  uploadCount: number;
  packageCount: number;
  matchCount: number;
  sideSampleCount: number;
  rowCount: number;
  startedAt: string;
  generatedAt: string;
  error: string;
}

export interface LeaderboardRefreshUpload {
  id: number;
  contributorName?: string;
  userPublicId?: string;
  targetVersion: string;
  dateFrom: string;
  dateTo: string;
  modeScope?: string;
  festivalDateFrom?: string;
  festivalDateTo?: string;
  status: string;
  matchCount: number;
  importedMatchCount: number;
  createdAt: string;
  updatedAt: string;
  errors: unknown[];
}

export interface LeaderboardRefreshStatus {
  schemaVersion: number;
  generatedAt: string;
  refresh: {
    status: string;
    reason: string;
    error: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
  };
  runRefresh: Record<string, unknown>;
  snapshot: {
    sourceRunId?: number;
    sourceKind?: string;
    targetVersion?: string;
    dateFrom?: string;
    dateTo?: string;
    updatedAt?: string;
    sampleSize?: number;
    clusterRows?: number;
    tierRows?: number;
    homeTierRows?: number;
  };
  export: {
    tables: Record<string, number>;
    cards: Record<string, boolean>;
  };
  latestRun: LeaderboardRefreshRun | null;
  recentRuns: LeaderboardRefreshRun[];
  latestUpload: LeaderboardRefreshUpload | null;
  recentUploads: LeaderboardRefreshUpload[];
}
