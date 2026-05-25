<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import CommonHeader from "./components/Common_Header.vue";
import MainHeroSection from "./components/Main_Hero_Section.vue";
import MainSnapshotStripSection from "./components/Main_SnapshotStrip_Section.vue";
import MainFactionShareSection from "./components/Main_FactionShare_Section.vue";
import MainRepresentativeDecksSection from "./components/Main_RepresentativeDecks_Section.vue";
import MainFeaturedCardsSection from "./components/Main_FeaturedCards_Section.vue";
import { dateOnly, integer } from "./lib/format";
import { loadSnapshot } from "./lib/snapshot";
import type { LeaderboardSnapshot } from "./types";

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
const homeRows = computed(() => home.value?.tierRows ?? snapshot.value?.clusterRows ?? snapshot.value?.tierRows ?? []);
const topDeck = computed(() => homeRows.value[0] ?? null);
const top4Decks = computed(() => homeRows.value.slice(0, 4));
const factionShare = computed(() => home.value?.factionShare ?? []);
const representativeDecks = computed(() => (home.value?.representativeDecks?.length ? home.value.representativeDecks : homeRows.value.slice(0, 4)));
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
