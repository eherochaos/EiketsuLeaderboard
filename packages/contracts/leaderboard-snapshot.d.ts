export type NamingSource = "single" | "combo" | "type";

export interface CardView {
  cardId: string;
  name: string;
  faction: string;
  cardCode?: string;
  cost?: string;
  unitType?: string;
  force?: string;
  intelligence?: string;
  era?: string;
  skills?: string[];
  imageUrl: string;
  imageAlt: string;
}

export interface DeckConfigItem {
  name: string;
  usageRate: number;
  sampleSize: number;
  lowSample: boolean;
}

export interface DeckStrategyConfigItem {
  cardId: string;
  name: string;
  usageRate: number;
  sampleSize: number;
  strategyCount: number;
  averageCount: number;
}

export interface DeckSchoolStageConfigItem extends DeckConfigItem {
  stage: string;
  averageCount: number;
  highlightMatchUrl?: string;
  highlightMatchLabel?: string;
}

export interface DeckUnfavorableMatchupItem {
  deckId: string;
  deckName: string;
  usageRate: number;
  sampleSize: number;
}

export interface DeckConfigStats {
  weapons: DeckConfigItem[];
  styles: DeckConfigItem[];
  souls: DeckConfigItem[];
  strategies: DeckStrategyConfigItem[];
  schoolStages: DeckSchoolStageConfigItem[];
  unfavorableMatchups: DeckUnfavorableMatchupItem[];
}

export interface DeckClusterVariant {
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

export interface DeckRow {
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
  deckConfig: DeckConfigStats;
  evidenceTags: string[];
  clusterVariants?: DeckClusterVariant[];
}

export interface FeaturedCard {
  cardId: string;
  name: string;
  faction: string;
  cardCode?: string;
  cost?: string;
  unitType?: string;
  force?: string;
  intelligence?: string;
  era?: string;
  skills?: string[];
  imageUrl: string;
  imageAlt: string;
  rankScore: number;
  sourceRank?: number;
  winRate: number;
  usageRate: number;
  sampleSize: number;
  evidenceTags: string[];
}

export interface FactionShare {
  faction: string;
  share: number;
  color: string;
  representatives: string[];
}

export interface LeaderboardSnapshot {
  metadata: {
    sourceRunId: number;
    sourceKind?: string;
    targetVersion?: string;
    dateFrom: string;
    dateTo: string;
    updatedAt: string;
    sampleSize: number;
    excludedInvalidDeckRows?: number;
    excludedInvalidDeckSampleSize?: number;
  };
  home: {
    factionShare: FactionShare[];
    representativeDecks: DeckRow[];
    featuredCards: FeaturedCard[];
    summary: string;
    tierRows: DeckRow[];
  };
  clusterRows: DeckRow[];
  tierRows: DeckRow[];
}
