<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import CommonHeader from "./components/Common_Header.vue";
import CommonVersionSelect from "./components/Common_VersionSelect.vue";
import MainHeroSection from "./components/Main_Hero_Section.vue";
import MainFactionShareSection from "./components/Main_FactionShare_Section.vue";
import MainRepresentativeDecksSection from "./components/Main_RepresentativeDecks_Section.vue";
import MainFeaturedCardsSection from "./components/Main_FeaturedCards_Section.vue";
import { dateOnly, integer } from "./lib/format";
import { loadSnapshot } from "./lib/snapshot";
import { trackPageView } from "./lib/siteAnalytics";
import { loadVersionOptions, manifestFromSnapshot, readVersionParam, selectedVersionFromManifest, writeVersionParam } from "./lib/versionOptions";
import type { LeaderboardSnapshot, LeaderboardVersionManifest } from "./types";

const snapshot = ref<LeaderboardSnapshot | null>(null);
const versionOptions = ref<LeaderboardVersionManifest | null>(null);
const selectedVersion = ref("");
const loading = ref(true);
const error = ref("");

onMounted(async () => {
  trackPageView("leaderboard");
  const requestedVersion = readVersionParam();
  try {
    versionOptions.value = await loadVersionOptions();
    selectedVersion.value = selectedVersionFromManifest(versionOptions.value, requestedVersion);
    writeVersionParam(selectedVersion.value);
    snapshot.value = await loadSnapshot(selectedVersion.value);
  } catch (caught) {
    try {
      snapshot.value = await loadSnapshot(requestedVersion);
      versionOptions.value = manifestFromSnapshot(snapshot.value);
      selectedVersion.value = snapshot.value.metadata.targetVersion || requestedVersion;
      writeVersionParam(selectedVersion.value);
    } catch (fallbackCaught) {
      error.value = fallbackCaught instanceof Error ? fallbackCaught.message : "快照读取失败";
    }
  } finally {
    loading.value = false;
  }
});

const versionList = computed(() => versionOptions.value?.versions ?? []);
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

async function handleVersionChange(targetVersion: string): Promise<void> {
  if (!targetVersion || targetVersion === selectedVersion.value) return;
  selectedVersion.value = targetVersion;
  writeVersionParam(targetVersion);
  loading.value = true;
  error.value = "";
  try {
    snapshot.value = await loadSnapshot(targetVersion);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "快照读取失败";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <CommonHeader current="home" />
  <main class="Common_PageShell">
    <section v-if="loading" class="Common_StatusPanel">正在读取构建快照...</section>
    <section v-else-if="error" class="Common_StatusPanel Common_StatusPanel_Error">{{ error }}</section>
    <template v-else-if="snapshot && home && metadata">
      <section class="MainPage_VersionBar" aria-label="版本筛选">
        <CommonVersionSelect
          :model-value="selectedVersion"
          :versions="versionList"
          :disabled="loading"
          @update:model-value="handleVersionChange"
        />
      </section>
      <MainHeroSection
        :metadata="metadata"
        :summary="home.summary"
        :faction-share="factionShare"
        :top-deck="topDeck"
        :top4-decks="top4Decks"
      />
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

<style scoped>
.MainPage_VersionBar {
  margin-bottom: 16px;
  padding: 12px 16px;
  display: flex;
  justify-content: flex-end;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-panel);
  box-shadow: var(--shadow-soft);
}

@media (max-width: 760px) {
  .MainPage_VersionBar {
    justify-content: stretch;
  }
}
</style>
