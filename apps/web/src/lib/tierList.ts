import type { TierListDeckConfigResponse, TierListScope, TierListSnapshot } from "../types";

const snapshotUrl = import.meta.env.VITE_TIER_LIST_SNAPSHOT_URL || "/api/tier-list-snapshot";
const deckConfigUrl = import.meta.env.VITE_TIER_LIST_DECK_CONFIG_URL || "/api/tier-list-deck-config";

export async function loadTierListSnapshot(): Promise<TierListSnapshot> {
  const response = await fetch(snapshotUrl);

  if (!response.ok) {
    throw new Error(`TierList 数据读取失败：${response.status}`);
  }

  return await response.json() as TierListSnapshot;
}

export async function loadTierListDeckConfig(scope: TierListScope, deckId: string): Promise<TierListDeckConfigResponse> {
  const url = new URL(deckConfigUrl, window.location.origin);
  url.searchParams.set("scope", scope);
  url.searchParams.set("deckId", deckId);
  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`配置情报读取失败：${response.status}`);
  }

  return await response.json() as TierListDeckConfigResponse;
}
