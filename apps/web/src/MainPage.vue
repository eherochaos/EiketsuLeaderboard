<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import CommonHeader from "./components/Common_Header.vue";
import MainHeroSection from "./components/Main_Hero_Section.vue";
import MainSnapshotStripSection from "./components/Main_SnapshotStrip_Section.vue";
import MainFactionShareSection from "./components/Main_FactionShare_Section.vue";
import MainRepresentativeDecksSection from "./components/Main_RepresentativeDecks_Section.vue";
import MainFeaturedCardsSection from "./components/Main_FeaturedCards_Section.vue";
import { compareDeckRowsByRank, createSameNameDeckClusters } from "./lib/deck-clusters";
import { dateOnly, integer } from "./lib/format";
import { loadSnapshot } from "./lib/snapshot";
import type { DeckRow, FactionShare, LeaderboardSnapshot } from "./types";

const snapshot = ref<LeaderboardSnapshot | null>(null);
const loading = ref(true);
const error = ref("");

onMounted(async () => {
  try {
    snapshot.value = await loadSnapshot();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "快照读取失败";
  } finally {
    loading.value = false;
  }
});

const home = computed(() => snapshot.value?.home ?? null);
const metadata = computed(() => snapshot.value?.metadata ?? null);
const clusteredRows = computed(() => createSameNameDeckClusters(snapshot.value?.tierRows ?? [], {
  compareRows: compareDeckRowsByRank
}).map((cluster) => cluster.displayRow));
const topDeck = computed(() => clusteredRows.value[0] ?? null);
const top4Decks = computed(() => clusteredRows.value.slice(0, 4));
const factionShare = computed(() => {
  const originalShare = home.value?.factionShare ?? [];
  const colorByFaction = new Map(originalShare.map((item) => [item.faction, item.color]));
  const orderByFaction = new Map(originalShare.map((item, index) => [item.faction, index]));
  const totalSampleSize = clusteredRows.value.reduce((sum, row) => sum + row.sampleSize, 0);
  const byFaction = new Map<string, { sampleSize: number; representatives: string[] }>();

  for (const row of clusteredRows.value) {
    const key = row.faction || "unknown";
    const current = byFaction.get(key) || { sampleSize: 0, representatives: [] };
    current.sampleSize += row.sampleSize;
    if (row.deckName && !current.representatives.includes(row.deckName) && current.representatives.length < 2) {
      current.representatives.push(row.deckName);
    }
    byFaction.set(key, current);
  }

  return Array.from(byFaction.entries())
    .map(([faction, item]): FactionShare => ({
      faction,
      share: totalSampleSize ? Number((item.sampleSize / totalSampleSize * 100).toFixed(1)) : 0,
      color: colorByFaction.get(faction) || "var(--color-muted)",
      representatives: item.representatives
    }))
    .filter((item) => item.faction !== "unknown" && item.share > 0)
    .sort((left, right) => {
      const sampleDiff = right.share - left.share;
      return sampleDiff || (orderByFaction.get(left.faction) ?? 99) - (orderByFaction.get(right.faction) ?? 99);
    });
});
const representativeDecks = computed(() => {
  const rowsByName = new Map(clusteredRows.value.map((row) => [row.deckName || row.deckId, row]));
  const selected: DeckRow[] = [];
  const seen = new Set<string>();

  for (const deck of home.value?.representativeDecks ?? []) {
    const key = deck.deckName || deck.deckId;
    const row = rowsByName.get(key);
    const selectedKey = row?.deckName || row?.deckId || "";
    if (row && !seen.has(selectedKey)) {
      selected.push(row);
      seen.add(selectedKey);
    }
  }

  for (const row of clusteredRows.value) {
    const key = row.deckName || row.deckId;
    if (selected.length >= 4) break;
    if (!seen.has(key)) {
      selected.push(row);
      seen.add(key);
    }
  }

  return selected.slice(0, 4);
});
const featuredCards = computed(() => home.value?.featuredCards ?? []);
const topShareTotal = computed(() => factionShare.value.slice(0, 3).reduce((sum, item) => sum + item.share, 0));
const shareNote = computed(() => {
  if (!metadata.value) {
    return "";
  }
  return `${metadata.value.targetVersion || "未指定版本"} · ${dateOnly(metadata.value.dateFrom)} - ${dateOnly(metadata.value.dateTo)} · 样本 ${integer(metadata.value.sampleSize)}`;
});
</script>

<template>
  <CommonHeader current="home" />
  <main class="Common_PageShell">
    <section v-if="loading" class="Common_StatusPanel">正在读取构建快照...</section>
    <section v-else-if="error" class="Common_StatusPanel Common_StatusPanel_Error">{{ error }}</section>
    <template v-else-if="snapshot && home && metadata">
      <MainHeroSection
        :metadata="metadata"
        :summary="home.summary"
        :faction-share="factionShare"
        :top-deck="topDeck"
        :top4-decks="top4Decks"
      />
      <!-- <MainSnapshotStripSection :metadata="metadata" /> -->
      <MainFactionShareSection
        :faction-share="factionShare"
        :top-share-total="topShareTotal"
        :share-note="shareNote"
      />
      <MainRepresentativeDecksSection :decks="representativeDecks" />
      <MainFeaturedCardsSection :cards="featuredCards" />

      <footer class="MainPage_Foot">
        数据来源 {{ metadata.sourceKind || "analysis" }} Run {{ metadata.sourceRunId }}。
      </footer>
    </template>
  </main>
</template>
