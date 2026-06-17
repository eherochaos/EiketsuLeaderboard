import type { TierListDeckConfigResponse, TierListScope, TierListSnapshot } from "../types";
import { apiUrlWithVersion } from "./versionOptions";

export type TierListPageKind = "tierList" | "battleFestival";

const snapshotUrl = import.meta.env.VITE_TIER_LIST_SNAPSHOT_URL || "/api/tier-list-snapshot";
const deckConfigUrl = import.meta.env.VITE_TIER_LIST_DECK_CONFIG_URL || "/api/tier-list-deck-config";
const battleFestivalSnapshotUrl = import.meta.env.VITE_BATTLE_FESTIVAL_SNAPSHOT_URL || "/api/battle-festival-snapshot";
const battleFestivalDeckConfigUrl = import.meta.env.VITE_BATTLE_FESTIVAL_DECK_CONFIG_URL || "/api/battle-festival-deck-config";

function pageSnapshotUrl(pageKind: TierListPageKind): string {
  return pageKind === "battleFestival" ? battleFestivalSnapshotUrl : snapshotUrl;
}

function pageDeckConfigUrl(pageKind: TierListPageKind): string {
  return pageKind === "battleFestival" ? battleFestivalDeckConfigUrl : deckConfigUrl;
}

function pageErrorLabel(pageKind: TierListPageKind): string {
  return pageKind === "battleFestival" ? "战祭数据" : "TierList 数据";
}

export async function loadTierListSnapshot(pageKind: TierListPageKind = "tierList", targetVersion = ""): Promise<TierListSnapshot> {
  const response = await fetch(apiUrlWithVersion(pageSnapshotUrl(pageKind), pageKind === "tierList" ? targetVersion : ""), { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`${pageErrorLabel(pageKind)}读取失败：${response.status}`);
  }

  return await response.json() as TierListSnapshot;
}

export async function loadTierListDeckConfig(
  scope: TierListScope,
  deckId: string,
  pageKind: TierListPageKind = "tierList",
  targetVersion = ""
): Promise<TierListDeckConfigResponse> {
  const url = new URL(pageDeckConfigUrl(pageKind), window.location.origin);
  url.searchParams.set("scope", scope);
  url.searchParams.set("deckId", deckId);
  if (pageKind === "tierList" && targetVersion) {
    url.searchParams.set("version", targetVersion);
  }
  url.searchParams.set("_ts", String(Date.now()));
  const response = await fetch(url.toString(), { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`配置情报读取失败：${response.status}`);
  }

  return await response.json() as TierListDeckConfigResponse;
}
