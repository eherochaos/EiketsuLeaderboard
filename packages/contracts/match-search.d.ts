import type { CardView } from "./leaderboard-snapshot.js";

export const MATCH_SEARCH_OPTIONS_ENDPOINT: string;
export const MATCH_SEARCH_ENDPOINT: string;

export type MatchSearchCardMatchMode = "all" | "any";
export type MatchSearchResultFilter = "any" | "win" | "loss" | "draw";
export type MatchSearchWeaponActivationFilter = "any" | "yes" | "no";
export type MatchSearchStrategyFilter = "any" | "used" | "unused";
export type MatchSearchWeaponActivation = "yes" | "no" | "unknown";

export interface MatchSearchMetadata {
  sourceRunId?: number;
  sourceKind?: string;
  targetVersion?: string;
  dateFrom?: string;
  dateTo?: string;
  updatedAt?: string;
  indexedAt?: string;
  sampleSize?: number;
  matchCount: number;
  videoMatchCount: number;
}

export interface MatchSearchCardOption extends CardView {
  usageCount: number;
}

export interface MatchSearchWeaponOption {
  name: string;
  usageCount: number;
  activatedCount: number;
  notActivatedCount: number;
  unknownCount: number;
}

export interface MatchSearchOptions {
  schemaVersion: number;
  metadata: MatchSearchMetadata;
  cards: MatchSearchCardOption[];
  weapons: MatchSearchWeaponOption[];
}

export interface MatchSearchSideRequest {
  cardIds?: string[];
  strategyByCard?: Record<string, MatchSearchStrategyFilter>;
  weaponName?: string;
  weaponActivated?: MatchSearchWeaponActivationFilter;
  result?: MatchSearchResultFilter;
}

export interface MatchSearchRequest {
  page?: number;
  pageSize?: number;
  cardMatchMode?: MatchSearchCardMatchMode;
  sideA?: MatchSearchSideRequest;
  sideB?: MatchSearchSideRequest;
}

export interface MatchSearchSideResult {
  result: string;
  playerName: string;
  castleRate: string;
  weaponName: string;
  weaponActivated: MatchSearchWeaponActivation;
  weaponSummary: string;
  schoolName: string;
  cards: MatchSearchCardOption[];
  selectedStrategyCounts: Record<string, number>;
}

export interface MatchSearchItem {
  matchId: number | string;
  version: string;
  mode: string;
  playedAt: string;
  videoUrl: string;
  playUrl: string;
  detailUrl: string;
  m3u8Url: string;
  replayId: string;
  sideA: MatchSearchSideResult;
  sideB: MatchSearchSideResult;
}

export interface MatchSearchResponse {
  schemaVersion: number;
  metadata: MatchSearchMetadata;
  total: number;
  page: number;
  pageSize: number;
  items: MatchSearchItem[];
}
