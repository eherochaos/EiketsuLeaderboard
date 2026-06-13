import type {
  CardView,
  DeckConfigStats,
  LeaderboardSnapshot,
  NamingSource,
} from "./leaderboard-snapshot.js";

export type TierListScope = "deck" | "cluster";

export interface BattleFestivalCampShare {
  camp: string;
  sampleSize: number;
  winRate: number;
  share: number;
  representatives: string[];
}

export interface BattleFestivalCampRows {
  tierRows: TierListRow[];
  clusterRows: TierListRow[];
}

export type BattleFestivalMeritConfidence = "high" | "medium" | "single";

export interface BattleFestivalMeritRow {
  playerName: string;
  camp: string;
  firstSeenAt: string;
  lastSeenAt: string;
  firstMerit: number;
  lastMerit: number;
  maxMerit: number;
  meritDelta: number;
  meritSampleCount: number;
  observedMatchCount: number;
  winCount: number;
  lossCount: number;
  drawCount: number;
  unknownCount: number;
  confidence: BattleFestivalMeritConfidence;
}

export interface BattleFestivalMeritSummary {
  observedPlayerCount: number;
  meritPlayerCount: number;
  rankedPlayerCount: number;
  singleSamplePlayerCount: number;
  meritSampleCount: number;
  maxMeritDelta: number;
  topPlayerName: string;
}

export interface BattleFestivalSnapshotData {
  camps: string[];
  campShare: BattleFestivalCampShare[];
  rowsByCamp: Record<string, BattleFestivalCampRows>;
  meritRows?: BattleFestivalMeritRow[];
  meritSummary?: BattleFestivalMeritSummary;
}

export interface TierListClusterVariant {
  deckId: string;
  deckName: string;
  categoryId: string;
  categoryName: string;
  faction: string;
  namingSource: NamingSource;
  rankScore: number;
  sourceRank?: number;
  winRate: number;
  playerAverageWinRate: number;
  usageRate: number;
  kabukiPoints: number;
  sampleSize: number;
  imageUrl: string;
  imageAlt: string;
  deckCards: CardView[];
  battleCamp?: string;
}

export interface TierListRow extends TierListClusterVariant {
  evidenceTags: string[];
  clusterVariants?: TierListClusterVariant[];
}

export interface TierListSnapshot {
  schemaVersion: number;
  metadata: LeaderboardSnapshot["metadata"];
  tierRows: TierListRow[];
  clusterRows: TierListRow[];
  battleFestival?: BattleFestivalSnapshotData;
}

export interface TierListDeckConfigResponse {
  metadata: Pick<LeaderboardSnapshot["metadata"], "sourceRunId" | "sourceKind" | "targetVersion" | "dateFrom" | "dateTo" | "updatedAt" | "sampleSize">;
  scope: TierListScope;
  deckId: string;
  deckConfig: DeckConfigStats;
}
