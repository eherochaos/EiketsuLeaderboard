import type {
  CardView,
  DeckConfigStats,
  LeaderboardSnapshot,
  NamingSource,
} from "./leaderboard-snapshot.js";

export type TierListScope = "deck" | "cluster";

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
}

export interface TierListDeckConfigResponse {
  metadata: Pick<LeaderboardSnapshot["metadata"], "sourceRunId" | "sourceKind" | "targetVersion" | "dateFrom" | "dateTo" | "updatedAt" | "sampleSize">;
  scope: TierListScope;
  deckId: string;
  deckConfig: DeckConfigStats;
}
