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

export interface BattleFestivalMeritDeck {
  deckId: string;
  deckName: string;
  faction: string;
  sampleSize: number;
  winCount: number;
  lossCount: number;
  drawCount: number;
  unknownCount: number;
  winRate: number;
  deckCards: CardView[];
}

export interface BattleFestivalMeritPaceDay {
  date: string;
  firstObservedAt: string;
  lastObservedAt: string;
  firstMerit: number;
  lastMerit: number;
  meritGain: number;
  meritSampleCount: number;
  observedMinutes: number;
  averageMinutesPerMatch: number;
  meritPerHour: number;
}

export interface BattleFestivalMeritPaceSample {
  observedAt: string;
  merit: number;
  meritDelta: number;
  minutesSincePrevious: number;
  firstOfDay: boolean;
}

export interface BattleFestivalMeritProjection {
  basis: {
    date: string;
    meritGain: number;
    meritSampleCount: number;
    observedMinutes: number;
    averageMinutesPerMatch: number;
    meritPerHour: number;
  } | null;
  basisType: string;
  latestObservedAt: string;
  latestMerit: number;
  finalAt: string;
  remainingMinutes: number;
  projectedFinalMerit: number;
}

export interface BattleFestivalMeritPace {
  days: BattleFestivalMeritPaceDay[];
  samples: BattleFestivalMeritPaceSample[];
  projection: BattleFestivalMeritProjection | null;
}

export interface BattleFestivalMeritRow {
  playerName: string;
  camp: string;
  firstSeenAt: string;
  lastSeenAt: string;
  highestMerit: number;
  highestMeritSeenAt: string;
  meritSampleCount: number;
  observedMatchCount: number;
  winCount: number;
  lossCount: number;
  drawCount: number;
  unknownCount: number;
  winRate: number;
  decks: BattleFestivalMeritDeck[];
  pace?: BattleFestivalMeritPace;
}

export interface BattleFestivalMeritSummary {
  observedPlayerCount: number;
  meritPlayerCount: number;
  meritSampleCount: number;
  highestMerit: number;
  topPlayerName: string;
  observedMatchCount: number;
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
