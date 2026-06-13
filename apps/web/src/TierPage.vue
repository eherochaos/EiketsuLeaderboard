<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import CommonHeader from "./components/Common_Header.vue";
import CommonDeckRail from "./components/Common_DeckRail.vue";
import CommonImageFrame from "./components/Common_ImageFrame.vue";
import CommonMetricTags from "./components/Common_MetricTags.vue";
import TierPageDeckConfigPanel from "./components/TierPage_DeckConfigPanel.vue";
import { dateOnly, integer, percent, sourceLabels } from "./lib/format";
import { trackPageView, trackSiteEvent } from "./lib/siteAnalytics";
import { loadTierListDeckConfig, loadTierListSnapshot } from "./lib/tierList";
import type { TierListPageKind } from "./lib/tierList";
import type { CardView, DeckConfigStats, TierListClusterVariant, TierListRow, TierListScope, TierListSnapshot } from "./types";

type SortKey = "rankScore" | "winRate" | "playerAverageWinRate" | "usageRate" | "kabukiPoints" | "sampleSize";

const props = withDefaults(defineProps<{
  pageKind?: TierListPageKind;
}>(), {
  pageKind: "tierList"
});

const INITIAL_VISIBLE_ROWS = 100;
const VISIBLE_ROWS_STEP = 100;

const snapshot = ref<TierListSnapshot | null>(null);
const loading = ref(true);
const error = ref("");
const battleCampFilter = ref("all");
const factionFilter = ref("all");
const sourceFilter = ref("all");
const sortKey = ref<SortKey>("rankScore");
const clusterSameName = ref(false);
const clusterVariantIndexes = ref<Record<string, number>>({});
const expandedDeckIds = ref(new Set<string>());
const visibleRowLimit = ref(INITIAL_VISIBLE_ROWS);
const mobileViewport = ref(false);
const compactMobileViewport = ref(false);
const mobileFiltersOpen = ref(false);
const deckConfigs = ref<Record<string, DeckConfigStats>>({});
const deckConfigLoadingIds = ref(new Set<string>());
const deckConfigErrors = ref<Record<string, string>>({});
let mobileMediaQuery: MediaQueryList | null = null;
let compactMobileMediaQuery: MediaQueryList | null = null;
const emptyDeckConfig: DeckConfigStats = {
  weapons: [],
  styles: [],
  souls: [],
  strategies: [],
  schoolStages: [],
  unfavorableMatchups: []
};

const sortOptions: { value: SortKey; label: string }[] = [
  { value: "rankScore", label: "综合 Rank" },
  { value: "winRate", label: "胜率" },
  { value: "playerAverageWinRate", label: "玩家均胜率" },
  { value: "usageRate", label: "使用率" },
  { value: "kabukiPoints", label: "歌舞伎点" },
  { value: "sampleSize", label: "样本数" }
];

const pageCopy = computed(() => {
  if (props.pageKind === "battleFestival") {
    return {
      analyticsPage: "battle-festival",
      current: "battleFestival" as const,
      eyebrow: "战祭",
      title: "战祭榜单",
      tableEyebrow: "Festival",
      tableTitle: "战祭明细",
      loading: "正在读取战祭快照..."
    };
  }

  return {
    analyticsPage: "tier-list",
    current: "tier" as const,
    eyebrow: "TierList",
    title: "综合榜单",
    tableEyebrow: "Ranking",
    tableTitle: "榜单明细",
    loading: "正在读取构建快照..."
  };
});

function updateViewportMode(): void {
  mobileViewport.value = Boolean(mobileMediaQuery?.matches);
  compactMobileViewport.value = Boolean(compactMobileMediaQuery?.matches);
}

onMounted(async () => {
  trackPageView(pageCopy.value.analyticsPage);
  mobileMediaQuery = window.matchMedia("(max-width: 760px)");
  compactMobileMediaQuery = window.matchMedia("(max-width: 430px)");
  updateViewportMode();
  mobileMediaQuery.addEventListener("change", updateViewportMode);
  compactMobileMediaQuery.addEventListener("change", updateViewportMode);
  try {
    snapshot.value = await loadTierListSnapshot(props.pageKind);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "快照读取失败";
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  mobileMediaQuery?.removeEventListener("change", updateViewportMode);
  compactMobileMediaQuery?.removeEventListener("change", updateViewportMode);
  mobileMediaQuery = null;
  compactMobileMediaQuery = null;
});

const metadata = computed(() => snapshot.value?.metadata ?? null);
const battleFestivalData = computed(() => props.pageKind === "battleFestival" ? snapshot.value?.battleFestival ?? null : null);
const battleCampOptions = computed(() => battleFestivalData.value?.campShare ?? []);
const showBattleCampFilter = computed(() => props.pageKind === "battleFestival" && battleCampOptions.value.length > 0);
const battleCampRows = computed(() => {
  if (battleCampFilter.value === "all") return null;
  return battleFestivalData.value?.rowsByCamp?.[battleCampFilter.value] ?? { tierRows: [], clusterRows: [] };
});
const rows = computed(() => battleCampRows.value?.tierRows ?? snapshot.value?.tierRows ?? []);
const clusterRows = computed(() => battleCampRows.value?.clusterRows ?? snapshot.value?.clusterRows ?? []);
const factions = computed(() => {
  const values = new Set([...rows.value, ...clusterRows.value].map((row) => row.faction).filter(Boolean));
  return Array.from(values).sort((left, right) => left.localeCompare(right, "ja"));
});

watch(battleCampOptions, (options) => {
  if (battleCampFilter.value === "all") return;
  if (!options.some((option) => option.camp === battleCampFilter.value)) battleCampFilter.value = "all";
});

function compareRows(left: TierListRow, right: TierListRow): number {
  if (sortKey.value === "rankScore") {
    return left.rankScore - right.rankScore || right.sampleSize - left.sampleSize || right.winRate - left.winRate || left.deckName.localeCompare(right.deckName, "ja");
  }
  const diff = Number(right[sortKey.value]) - Number(left[sortKey.value]);
  return diff || left.rankScore - right.rankScore || right.sampleSize - left.sampleSize || left.deckName.localeCompare(right.deckName, "ja");
}

const filteredRows = computed(() => {
  return rows.value
    .filter((row) => factionFilter.value === "all" || row.faction === factionFilter.value)
    .filter((row) => sourceFilter.value === "all" || row.namingSource === sourceFilter.value)
    .slice()
    .sort(compareRows);
});

const filteredClusterRows = computed(() => {
  return clusterRows.value
    .filter((row) => factionFilter.value === "all" || row.faction === factionFilter.value)
    .filter((row) => sourceFilter.value === "all" || row.namingSource === sourceFilter.value)
    .slice()
    .sort(compareRows);
});

const usePublishedClusters = computed(() => clusterSameName.value && filteredClusterRows.value.length > 0);

const visibleRows = computed(() => usePublishedClusters.value ? filteredClusterRows.value : filteredRows.value);
const renderedRows = computed(() => visibleRows.value.slice(0, visibleRowLimit.value));
const hasMoreRows = computed(() => renderedRows.value.length < visibleRows.value.length);
const renderedCountLabel = computed(() => `${integer(renderedRows.value.length)} / ${integer(visibleRows.value.length)}`);
const emptyStateMessage = computed(() => props.pageKind === "battleFestival" ? "暂无战祭数据" : "暂无榜单数据");

const filterCountLabel = computed(() => {
  if (!clusterSameName.value) return `${integer(filteredRows.value.length)} 条`;
  if (!filteredClusterRows.value.length) return `${integer(filteredRows.value.length)} 条`;
  return `${integer(visibleRows.value.length)} 组 / ${integer(filteredRows.value.length)} 条`;
});

const topDeck = computed(() => visibleRows.value[0] ?? null);

watch([battleCampFilter, factionFilter, sourceFilter, sortKey, clusterSameName], () => {
  visibleRowLimit.value = INITIAL_VISIBLE_ROWS;
  trackSiteEvent("filter_change", pageCopy.value.analyticsPage, {
    battleCamp: battleCampFilter.value,
    faction: factionFilter.value,
    source: sourceFilter.value,
    sortKey: sortKey.value,
    clusterSameName: clusterSameName.value,
  });
});

function deckStateKey(deck: TierListRow): string {
  return usePublishedClusters.value ? `cluster:${deck.deckId}` : `deck:${deck.deckId}`;
}

function deckConfigPanelId(deck: TierListRow): string {
  return `tier-config-${deckStateKey(deck).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function isDeckExpanded(deck: TierListRow): boolean {
  return expandedDeckIds.value.has(deckStateKey(deck));
}

function deckConfigScope(): TierListScope {
  return usePublishedClusters.value ? "cluster" : "deck";
}

function deckConfigFor(deck: TierListRow): DeckConfigStats | null {
  return deckConfigs.value[deckStateKey(deck)] ?? null;
}

function deckConfigError(deck: TierListRow): string {
  return deckConfigErrors.value[deckStateKey(deck)] ?? "";
}

function isDeckConfigLoading(deck: TierListRow): boolean {
  return deckConfigLoadingIds.value.has(deckStateKey(deck));
}

async function ensureDeckConfig(deck: TierListRow): Promise<void> {
  const stateKey = deckStateKey(deck);
  if (deckConfigs.value[stateKey] || deckConfigLoadingIds.value.has(stateKey)) return;

  const deckId = String(deck.deckId || "").trim();
  if (!deckId) {
    deckConfigErrors.value = { ...deckConfigErrors.value, [stateKey]: "配置情报读取失败" };
    return;
  }

  const loadingIds = new Set(deckConfigLoadingIds.value);
  loadingIds.add(stateKey);
  deckConfigLoadingIds.value = loadingIds;
  deckConfigErrors.value = { ...deckConfigErrors.value, [stateKey]: "" };

  try {
    const response = await loadTierListDeckConfig(deckConfigScope(), deckId, props.pageKind);
    deckConfigs.value = { ...deckConfigs.value, [stateKey]: response.deckConfig };
  } catch (caught) {
    deckConfigErrors.value = {
      ...deckConfigErrors.value,
      [stateKey]: caught instanceof Error ? caught.message : "配置情报读取失败"
    };
  } finally {
    const nextLoadingIds = new Set(deckConfigLoadingIds.value);
    nextLoadingIds.delete(stateKey);
    deckConfigLoadingIds.value = nextLoadingIds;
  }
}

function loadMoreRows(): void {
  visibleRowLimit.value = Math.min(visibleRows.value.length, visibleRowLimit.value + VISIBLE_ROWS_STEP);
}

async function toggleDeckConfig(deck: TierListRow): Promise<void> {
  const next = new Set(expandedDeckIds.value);
  const key = deckStateKey(deck);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
    trackSiteEvent("deck_config_open", pageCopy.value.analyticsPage, {
      scope: deckConfigScope(),
      deckId: deck.deckId,
      deckName: deck.deckName,
    });
    void ensureDeckConfig(deck);
  }
  expandedDeckIds.value = next;
}

function deckSlots(deck: TierListRow): (CardView | null)[] {
  const cards = activeClusterVariant(deck)?.deckCards ?? deck.deckCards;
  return Array.from({ length: 8 }, (_, index) => cards[index] ?? null);
}

function factionLabel(value: string): string {
  return value === "unknown" ? "未识别" : value;
}

function battleCampLabel(deck: TierListRow): string {
  return activeClusterVariant(deck)?.battleCamp || deck.battleCamp || "";
}

function deckSubtitle(deck: TierListRow): string {
  const parts = [factionLabel(deck.faction)];
  if (deck.categoryName && deck.categoryName !== deck.deckName) parts.push(deck.categoryName);
  return parts.join(" · ");
}

function mobileDeckSubtitle(deck: TierListRow): string {
  const camp = battleCampLabel(deck);
  return camp ? `${camp} · ${deckSubtitle(deck)}` : deckSubtitle(deck);
}

function displayRowKey(deck: TierListRow): string {
  return deckStateKey(deck);
}

function clusterVariantKey(deck: TierListRow): string {
  return deck.deckId || deck.deckName;
}

function clusterVariants(deck: TierListRow): TierListClusterVariant[] {
  return usePublishedClusters.value ? deck.clusterVariants ?? [] : [];
}

function activeClusterVariant(deck: TierListRow): TierListClusterVariant | null {
  const variants = clusterVariants(deck);
  if (!variants.length) return null;
  const savedIndex = clusterVariantIndexes.value[clusterVariantKey(deck)] ?? 0;
  const activeIndex = Math.min(Math.max(savedIndex, 0), variants.length - 1);
  return variants[activeIndex] ?? variants[0] ?? null;
}

function deckImageUrl(deck: TierListRow): string {
  return activeClusterVariant(deck)?.imageUrl || deck.imageUrl;
}

function deckImageAlt(deck: TierListRow): string {
  return activeClusterVariant(deck)?.imageAlt || deck.imageAlt;
}

function deckImageCard(deck: TierListRow): CardView | null {
  const variant = activeClusterVariant(deck);
  const cards = variant?.deckCards ?? deck.deckCards;
  const imageUrl = deckImageUrl(deck);
  const imageAlt = deckImageAlt(deck);
  return cards.find((card) => (
    (imageUrl && card.imageUrl === imageUrl) ||
    (imageAlt && (card.imageAlt === imageAlt || card.name === imageAlt))
  )) || cards[0] || null;
}

function hasClusterVariants(deck: TierListRow): boolean {
  return clusterVariants(deck).length > 1;
}

function clusterVariantLabel(deck: TierListRow): string {
  const variants = clusterVariants(deck);
  if (!variants.length) return "";
  const savedIndex = clusterVariantIndexes.value[clusterVariantKey(deck)] ?? 0;
  const activeIndex = Math.min(Math.max(savedIndex, 0), variants.length - 1);
  return `${activeIndex + 1}/${variants.length}`;
}

function clusterVariantTitle(deck: TierListRow): string {
  const variants = clusterVariants(deck);
  if (!variants.length) return "";
  const savedIndex = clusterVariantIndexes.value[clusterVariantKey(deck)] ?? 0;
  const activeIndex = Math.min(Math.max(savedIndex, 0), variants.length - 1);
  return `式样 ${activeIndex + 1}/${variants.length}，按样本数排序，点击切换`;
}

function switchClusterVariant(deck: TierListRow): void {
  const variants = clusterVariants(deck);
  if (variants.length <= 1) return;
  const key = clusterVariantKey(deck);
  const savedIndex = clusterVariantIndexes.value[key] ?? 0;
  clusterVariantIndexes.value = {
    ...clusterVariantIndexes.value,
    [key]: (savedIndex + 1) % variants.length
  };
}
</script>

<template>
  <CommonHeader :current="pageCopy.current" />
  <main class="Common_PageShell TierPage">
    <section v-if="loading" class="Common_StatusPanel">{{ pageCopy.loading }}</section>
    <section v-else-if="error" class="Common_StatusPanel Common_StatusPanel_Error">{{ error }}</section>
    <template v-else-if="snapshot && metadata">
      <section class="TierPage_Hero" aria-labelledby="tier-title">
        <div>
          <p class="Common_Eyebrow">{{ pageCopy.eyebrow }}</p>
          <h1 id="tier-title">{{ pageCopy.title }}</h1>
          <p class="TierPage_MetaLine">
            <span>{{ metadata.targetVersion || "未指定版本" }}</span>
            <span>Run {{ metadata.sourceRunId || "-" }}</span>
            <span>{{ dateOnly(metadata.dateFrom) }} - {{ dateOnly(metadata.dateTo) }}</span>
            <span>样本 {{ integer(metadata.sampleSize) }}</span>
          </p>
        </div>
        <div v-if="topDeck" class="TierPage_Leader">
          <span>当前筛选第一</span>
          <strong>{{ topDeck.deckName }}</strong>
          <em>Rank {{ topDeck.rankScore }}</em>
        </div>
      </section>

      <section class="TierPage_FilterBar" :class="{ TierPage_FilterBar_Open: mobileFiltersOpen }" aria-label="榜单筛选">
        <button
          class="TierPage_FilterSummary"
          type="button"
          aria-controls="TierPage_FilterControls"
          :aria-expanded="mobileFiltersOpen"
          @click="mobileFiltersOpen = !mobileFiltersOpen"
        >
          <span>筛选 / 排序</span>
          <strong>{{ filterCountLabel }}</strong>
        </button>
        <div id="TierPage_FilterControls" class="TierPage_FilterControls">
          <label v-if="showBattleCampFilter">
            阵营
            <select v-model="battleCampFilter">
              <option value="all">全部阵营</option>
              <option v-for="camp in battleCampOptions" :key="camp.camp" :value="camp.camp">
                {{ camp.camp }}（{{ integer(camp.sampleSize) }}）
              </option>
            </select>
          </label>
          <label>
            势力
            <select v-model="factionFilter">
              <option value="all">全部势力</option>
              <option v-for="faction in factions" :key="faction" :value="faction">{{ factionLabel(faction) }}</option>
            </select>
          </label>
          <label>
            命名来源
            <select v-model="sourceFilter">
              <option value="all">全部来源</option>
              <option value="single">{{ sourceLabels.single }}</option>
              <option value="combo">{{ sourceLabels.combo }}</option>
              <option value="type">{{ sourceLabels.type }}</option>
            </select>
          </label>
          <label>
            排序
            <select v-model="sortKey">
              <option v-for="option in sortOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <button
            class="TierPage_ClusterToggle"
            type="button"
            :aria-pressed="clusterSameName"
            @click="clusterSameName = !clusterSameName"
          >
            同名聚类
          </button>
          <span class="TierPage_FilterCount">{{ filterCountLabel }}</span>
        </div>
      </section>

      <section class="Common_TableCard TierPage_TableCard" aria-labelledby="TierPage_Table_Title">
        <div class="Common_SectionHeading Common_SectionHeading_Compact">
          <p class="Common_Eyebrow">{{ pageCopy.tableEyebrow }}</p>
          <h2 id="TierPage_Table_Title">{{ pageCopy.tableTitle }}</h2>
        </div>
        <section v-if="!visibleRows.length" class="Common_StatusPanel TierPage_EmptyState">
          {{ emptyStateMessage }}
        </section>
        <table v-else-if="!mobileViewport" class="Common_TableLayout TierPage_Table">
          <colgroup>
            <col class="Common_TableColumn Common_TableColumn_Fixed" style="--Common_TableColumnWidth: var(--TierPage_TableRankColumn)">
            <col class="Common_TableColumn">
            <col class="Common_TableColumn">
            <col class="Common_TableColumn Common_TableColumn_Fixed" style="--Common_TableColumnWidth: var(--TierPage_TableMetricsColumn)">
          </colgroup>
          <thead>
            <tr>
              <th>Rank</th>
              <th>卡组</th>
              <th>核心构成</th>
              <th>指标</th>
              <!-- <th>依据</th> -->
            </tr>
          </thead>
          <tbody>
            <template v-for="(deck, index) in renderedRows" :key="displayRowKey(deck)">
            <tr>
              <td class="Common_RankCell">{{ index + 1 }}</td>
              <td class="TierPage_DeckCell">
                <div class="TierPage_DeckCellInner">
                  <span v-if="battleCampLabel(deck)" class="TierPage_CampPill">{{ battleCampLabel(deck) }}</span>
                  <span class="Common_FactionPill">{{ deckSubtitle(deck) }}</span>
                  <div class="TierPage_DeckTitleLine">
                    <strong>{{ deck.deckName }}</strong>
                    <button
                      v-if="hasClusterVariants(deck)"
                      class="TierPage_ClusterVariantButton"
                      type="button"
                      :title="clusterVariantTitle(deck)"
                      :aria-label="clusterVariantTitle(deck)"
                      @click="switchClusterVariant(deck)"
                    >
                      {{ clusterVariantLabel(deck) }}
                    </button>
                  </div>
                </div>
              </td>
              <td>
                <CommonDeckRail :cards="deckSlots(deck)"  />
                <!-- rail-class="Common_DeckRail_Mini" -->
              </td>
              <td>
                <div class="TierPage_MetricGrid">
                  <!-- <span><b>{{ deck.rankScore }}</b>综合</span> -->
                  <span><b>{{ percent(deck.winRate) }}</b>胜率</span>
                  <span><b>{{ percent(deck.playerAverageWinRate) }}</b>玩家均胜</span>
                  <span><b>{{ percent(deck.usageRate) }}</b>使用率</span>
                  <span><b>{{ integer(deck.sampleSize) }}</b>样本</span>
                </div>
                <button
                  class="TierPage_ConfigToggle"
                  type="button"
                  :aria-expanded="isDeckExpanded(deck)"
                  :aria-controls="deckConfigPanelId(deck)"
                  @click="toggleDeckConfig(deck)"
                >
                  {{ isDeckExpanded(deck) ? "收起配置" : "配置详情" }}
                </button>
              </td>
              <!-- <td class="TierPage_EvidenceCell"><CommonMetricTags :tags="deck.evidenceTags" /></td> -->
            </tr>
            <tr v-if="isDeckExpanded(deck)" class="TierPage_ConfigRow">
              <td :colspan="4">
                <TierPageDeckConfigPanel
                  v-if="deckConfigFor(deck)"
                  :id="deckConfigPanelId(deck)"
                  :config="deckConfigFor(deck) || emptyDeckConfig"
                  :sample-size="deck.sampleSize"
                />
                <section v-else class="Common_StatusPanel TierPage_ConfigStatus">
                  {{ deckConfigError(deck) || (isDeckConfigLoading(deck) ? "正在读取配置情报..." : "配置情报读取失败") }}
                </section>
              </td>
            </tr>
            </template>
          </tbody>
        </table>

        <div v-else class="Common_MobileCardList TierPage_MobileList">
          <article v-for="(deck, index) in renderedRows" :key="`${displayRowKey(deck)}-mobile`" class="TierPage_MobileRow">
            <div class="TierPage_MobileHead">
              <span class="Common_RankCell">#{{ index + 1 }}</span>
              <CommonImageFrame
                v-if="!compactMobileViewport"
                :src="deckImageUrl(deck)"
                :alt="deckImageAlt(deck)"
                :card="deckImageCard(deck)"
                show-details
                density="full"
                ratio="portrait"
              />
              <div>
                <div class="TierPage_MobileTitleLine">
                  <h3>{{ deck.deckName }}</h3>
                  <button
                    v-if="hasClusterVariants(deck)"
                    class="TierPage_ClusterVariantButton"
                    type="button"
                    :title="clusterVariantTitle(deck)"
                    :aria-label="clusterVariantTitle(deck)"
                    @click="switchClusterVariant(deck)"
                  >
                    {{ clusterVariantLabel(deck) }}
                  </button>
                </div>
                <p>{{ mobileDeckSubtitle(deck) }}</p>
                <small>{{ sourceLabels[deck.namingSource] }}</small>
              </div>
            </div>
            <div class="TierPage_MobileMetricGrid">
              <span><b>{{ deck.rankScore }}</b>综合 Rank</span>
              <span><b>{{ percent(deck.winRate) }}</b>胜率</span>
              <span><b>{{ percent(deck.playerAverageWinRate) }}</b>玩家均胜</span>
              <span><b>{{ percent(deck.usageRate) }}</b>使用率</span>
              <span><b>{{ integer(deck.sampleSize) }}</b>样本</span>
            </div>
            <div class="TierPage_MobileDeckSection">
              <span>核心构成</span>
              <CommonDeckRail
                :cards="deckSlots(deck)"
                :rail-class="compactMobileViewport ? 'Common_DeckRail Common_DeckRail_Mobile Common_DeckRail_TierCompact' : 'Common_DeckRail Common_DeckRail_Mobile'"
                :show-card-details="!compactMobileViewport"
                :show-card-overlays="compactMobileViewport"
                :card-density="compactMobileViewport ? 'mini' : 'compact'"
              />
            </div>
            <div class="TierPage_MobileActions">
              <button
                class="TierPage_ConfigToggle"
                type="button"
                :aria-expanded="isDeckExpanded(deck)"
                :aria-controls="deckConfigPanelId(deck)"
                @click="toggleDeckConfig(deck)"
              >
                {{ isDeckExpanded(deck) ? "收起配置" : "配置详情" }}
              </button>
              <CommonMetricTags :tags="deck.evidenceTags" />
            </div>
            <TierPageDeckConfigPanel
              v-if="isDeckExpanded(deck) && deckConfigFor(deck)"
              :id="deckConfigPanelId(deck)"
              :config="deckConfigFor(deck) || emptyDeckConfig"
              :sample-size="deck.sampleSize"
            />
            <section v-else-if="isDeckExpanded(deck)" class="Common_StatusPanel TierPage_ConfigStatus">
              {{ deckConfigError(deck) || (isDeckConfigLoading(deck) ? "正在读取配置情报..." : "配置情报读取失败") }}
            </section>
          </article>
        </div>
        <div v-if="hasMoreRows" class="TierPage_LoadMore">
          <span>已显示 {{ renderedCountLabel }}</span>
          <button type="button" @click="loadMoreRows">加载更多</button>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
/* TierList 页面：顶部留白略小于首页。 */
.TierPage {
  padding-top: 18px;
}

/* 榜单页 Hero：左侧标题信息，右侧当前筛选第一。 */
.TierPage_Hero {
  min-height: 136px;
  padding: 20px 28px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 288px;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-lg);
}

/* 榜单页主标题尺寸。 */
.TierPage_Hero h1 {
  margin-bottom: 8px;
  font-size: 42px;
}

/* 榜单页说明文字和移动端卡组说明。 */
.TierPage_Hero p,
.TierPage_MobileRow p {
  margin-bottom: var(--space-sm);
  color: var(--color-muted);
  font-size: 14px;
}

/* 元信息行：版本、Run、日期和样本横向排列。 */
.TierPage_MetaLine {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}

/* 元信息文本。 */
.TierPage_MetaLine span {
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 14px;
  font-weight: 700;
}

/* 当前筛选第一提示卡。 */
.TierPage_Leader {
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid rgba(216, 192, 151, 0.82);
  background: rgba(255, 248, 235, 0.72);
}

/* 当前筛选第一标签。 */
.TierPage_Leader span {
  display: block;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: var(--font-size-sm);
  font-weight: 700;
}

/* 当前筛选第一名称和 Rank。 */
.TierPage_Leader strong,
.TierPage_Leader em {
  display: block;
  color: var(--color-brown);
  font-style: normal;
  font-weight: 900;
}

/* 当前筛选第一名称，最多两行。 */
.TierPage_Leader strong {
  margin-top: 4px;
  font-size: 19px;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 当前筛选第一 Rank 数字。 */
.TierPage_Leader em {
  margin-top: 4px;
  color: var(--color-gold);
  font-family: var(--font-number);
  font-size: 24px;
}

/* 筛选条：桌面端横向排列筛选项。 */
.TierPage_FilterBar {
  margin-top: var(--space-md);
  min-height: 76px;
  padding: 12px 18px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 14px;
}

.TierPage_FilterSummary {
  display: none;
}

.TierPage_FilterControls {
  display: contents;
}

/* 单个筛选控件标签。 */
.TierPage_FilterBar label {
  display: grid;
  gap: 5px;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 14px;
  font-weight: 700;
}

/* 下拉框：固定宽度，避免筛选条抖动。 */
.TierPage_FilterBar select {
  width: 174px;
  height: 36px;
  padding: 0 34px 0 12px;
  border: 1px solid var(--color-border);
  color: var(--color-brown);
  background: #fffaf0;
  font-family: var(--font-control);
  font-size: 14px;
  font-weight: 800;
  text-overflow: ellipsis;
}

/* 同名聚类开关：只改变榜单显示粒度。 */
.TierPage_ClusterToggle {
  align-self: end;
  height: 36px;
  padding: 0 14px;
  border: 1px solid rgba(185, 133, 36, 0.52);
  color: #76521c;
  background: rgba(255, 244, 217, 0.72);
  font-family: var(--font-control);
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
}

.TierPage_ClusterToggle[aria-pressed="true"] {
  border-color: rgba(169, 42, 36, 0.74);
  color: #fffaf0;
  background: var(--color-primary);
}

/* 筛选结果数量，推到右侧。 */
.TierPage_FilterCount {
  margin-left: auto;
  color: var(--color-primary);
  font-family: var(--font-control);
  font-size: 14px;
  font-weight: 700;
}

/* 榜单表格外壳。 */
.TierPage_TableCard {
  margin-top: var(--space-md);
  padding: 18px 20px;
}

/* 表格标题在表格卡片内纵向显示。 */
.TierPage_TableCard .Common_SectionHeading.Common_SectionHeading_Compact {
  display: block;
  margin-bottom: var(--space-sm);
}

/* 表格标题里的英文小标题间距。 */
.TierPage_TableCard .Common_SectionHeading.Common_SectionHeading_Compact .Common_Eyebrow {
  margin-bottom: 4px;
}

/* 桌面榜单表格固定列宽。 */
.TierPage_Table {
  --TierPage_TableRankColumn: 72px;
  --TierPage_TableMetricsColumn: 220px;

  table-layout: auto;
}

/* Rank 列宽。 */

/* 卡组信息列宽。 */

/* 核心构成列宽。 */

/* 指标列宽。 */

/* 依据标签列宽。 */
/* 榜单表格内边距。 */
.TierPage_Table th,
.TierPage_Table td {
  padding: var(--space-sm);
}

/* 表格行最低高度。 */
.TierPage_Table tbody tr {
  min-height: 96px;
}

/* 卡组单元格：头像和文字两列。 */
.TierPage_DeckCell {
  min-width: 0;
}

/* 卡组头像尺寸。 */
/* 卡组文字容器允许省略。 */
.TierPage_DeckCellInner {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

/* 卡组标题行：名称和式样切换按钮同排。 */
.TierPage_CampPill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  height: 28px;
  margin-bottom: var(--space-xs);
  padding: 0 var(--space-sm);
  border: 1px solid color-mix(in srgb, var(--color-primary) 68%, var(--color-border));
  border-radius: 999px;
  color: var(--color-surface);
  background: var(--color-primary);
  font-family: var(--font-control);
  font-size: var(--font-size-sm);
  font-weight: 900;
}

.TierPage_DeckTitleLine,
.TierPage_MobileTitleLine {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

.TierPage_DeckTitleLine strong,
.TierPage_MobileTitleLine h3 {
  min-width: 0;
}

/* 聚类式样按钮：显示当前式样序号，点击切换下一个样本量排序后的式样。 */
.TierPage_ClusterVariantButton {
  flex: 0 0 auto;
  min-width: 42px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid rgba(185, 133, 36, 0.58);
  color: #76521c;
  background: #fff4d9;
  font-family: var(--font-number);
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.TierPage_ClusterVariantButton:hover {
  border-color: rgba(169, 42, 36, 0.72);
  color: var(--color-primary);
}

/* 卡组名最多两行。 */
.TierPage_DeckCell strong,
.TierPage_MobileRow h3 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 移动端卡组标题。 */
.TierPage_MobileRow h3 {
  margin-bottom: var(--space-xs);
  color: var(--color-brown);
  font-family: var(--font-serif);
  font-size: var(--card-title-size);
  line-height: 1.25;
  letter-spacing: 0;
}

/* 卡组分类和来源文本。 */
.TierPage_DeckCell span:not(.Common_FactionPill),
.TierPage_DeckCell small {
  display: block;
  color: var(--color-muted);
  font-size: var(--font-size-sm);
  line-height: 1.35;
}

/* 卡组分类最多两行。 */
.TierPage_DeckCell span:not(.Common_FactionPill) {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 卡组命名来源文本。 */
.TierPage_DeckCell small {
  margin-top: 3px;
  font-family: var(--font-control);
  font-weight: 800;
}

/* 指标网格：桌面和移动端都按两列显示。 */
.TierPage_MetricGrid,
.TierPage_MobileMetricGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

/* 单个指标格。 */
.TierPage_MetricGrid span,
.TierPage_MobileMetricGrid span {
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(216, 192, 151, 0.72);
  background: rgba(255, 248, 235, 0.64);
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 12px;
  font-weight: 800;
  line-height: 1.2;
}

/* 指标格里的数字。 */
.TierPage_MetricGrid b,
.TierPage_MobileMetricGrid b {
  display: block;
  margin-bottom: 2px;
  color: var(--color-brown);
  font-family: var(--font-number);
  font-size: 18px;
  line-height: 1.05;
  font-weight: 900;
  white-space: nowrap;
}

/* 配置详情按钮：低权重操作，不和主要红色 CTA 抢视觉。 */
.TierPage_ConfigToggle {
  width: 100%;
  min-height: 32px;
  margin-top: 8px;
  padding: 0 10px;
  border: 1px solid rgba(185, 133, 36, 0.52);
  color: #76521c;
  background: rgba(255, 244, 217, 0.72);
  font-family: var(--font-control);
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.TierPage_ConfigToggle:hover {
  border-color: rgba(185, 133, 36, 0.78);
  background: #fff4d9;
}

.TierPage_MobileActions {
  display: grid;
  gap: 8px;
}

/* 配置详情展开行：不新增表格列，只承载附属统计。 */
.TierPage_ConfigRow td {
  padding-top: 0;
  background: rgba(255, 252, 245, 0.42);
}

/* 依据标签在表格单元格内垂直居中。 */
.TierPage_EvidenceCell :deep(.Common_MetricTags) {
  align-content: center;
}

/* 平板端：保留桌面表格，但允许横向滚动。 */
.TierPage_ConfigStatus {
  margin-top: 0;
  padding: 14px;
  box-shadow: none;
}

.TierPage_EmptyState {
  margin-top: var(--space-sm);
  padding: 24px;
}

.TierPage_LoadMore {
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 14px;
  font-weight: 800;
}

.TierPage_LoadMore button {
  min-height: 34px;
  padding: 0 18px;
  border: 1px solid rgba(185, 133, 36, 0.58);
  color: #76521c;
  background: #fff4d9;
  font-family: var(--font-control);
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
}

@media (max-width: 1099px) {
  /* 表格最小宽度，避免列被压坏。 */
  .TierPage_Table {
    min-width: 1060px;
  }
}

/* 手机端：隐藏表格，改为卡片行块。 */
@media (max-width: 760px) {
  /* 手机隐藏桌面表格。 */
  .TierPage_Table {
    display: none;
  }

  /* 手机榜单卡片列表。 */
  .TierPage_MobileList {
    display: grid;
    gap: 12px;
  }

  /* 手机单条榜单卡。 */
  .TierPage_MobileRow {
    display: grid;
    gap: 12px;
    padding: 14px;
    border: 1px solid rgba(216, 192, 151, 0.82);
    background: rgba(255, 250, 240, 0.76);
  }

  /* 手机榜单卡头部：Rank、头像、卡组名。 */
  .TierPage_MobileHead {
    display: grid;
    grid-template-columns: 44px 50px 1fr;
    gap: 12px;
    align-items: start;
  }

  /* 手机榜单头像尺寸。 */
  .TierPage_MobileHead :deep(.Common_ImageFrame) {
    width: 50px;
    height: auto;
  }

  /* 手机命名来源文本。 */
  .TierPage_MobileHead small {
    display: block;
    margin-top: 4px;
    color: var(--color-muted);
    font-family: var(--font-control);
    font-size: var(--font-size-sm);
    font-weight: 800;
  }

  /* 手机 Hero 改为单列。 */
  .TierPage_Hero {
    min-height: 0;
    align-items: stretch;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  /* 手机榜单标题尺寸。 */
  .TierPage_Hero h1 {
    margin-bottom: var(--space-xs);
    font-size: 32px;
  }

  /* 手机当前第一提示卡：名称和 Rank 同行感。 */
  .TierPage_Leader {
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 4px 12px;
    align-items: end;
    padding: 12px;
  }

  /* 手机当前第一标签独占一行。 */
  .TierPage_Leader span {
    grid-column: 1 / -1;
  }

  /* 手机当前第一名称和 Rank 清掉上边距。 */
  .TierPage_Leader strong,
  .TierPage_Leader em {
    margin-top: 0;
  }

  /* 手机当前第一名称字号。 */
  .TierPage_Leader strong {
    font-size: 18px;
  }

  /* 手机当前第一 Rank 字号。 */
  .TierPage_Leader em {
    font-size: 22px;
  }

  /* 手机筛选条改为纵向排列。 */
  .TierPage_FilterBar {
    align-items: stretch;
    flex-direction: column;
    gap: var(--space-sm);
    padding: 14px var(--space-md);
  }

  .TierPage_FilterControls {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  /* 手机筛选标签间距。 */
  .TierPage_FilterBar label {
    gap: 4px;
  }

  /* 手机下拉框高度。 */
  .TierPage_FilterBar select {
    height: 34px;
  }

  /* 手机筛选控件铺满。 */
  .TierPage_FilterBar label,
  .TierPage_FilterBar select,
  .TierPage_ClusterToggle {
    width: 100%;
  }

  /* 手机结果数量不再推右。 */
  .TierPage_FilterCount {
    margin-left: 0;
  }

  /* 手机核心构成标题。 */
  .TierPage_MobileDeckSection > span {
    display: block;
    margin-bottom: 8px;
    color: var(--color-muted);
    font-family: var(--font-control);
    font-size: var(--font-size-sm);
    font-weight: 800;
  }

  /* 手机指标数字大小。 */
  .TierPage_MobileMetricGrid b {
    font-size: 18px;
  }

  .TierPage_MobileTitleLine {
    align-items: flex-start;
  }

  .TierPage_ConfigToggle {
    margin-top: 0;
  }
}

@media (max-width: 430px) {
  .TierPage {
    padding-top: 8px;
  }

  .TierPage_Hero {
    padding: 12px;
    gap: 8px;
  }

  .TierPage_Hero h1 {
    font-size: 28px;
  }

  .TierPage_MetaLine {
    gap: 4px 10px;
  }

  .TierPage_MetaLine span {
    font-size: 12px;
  }

  .TierPage_Leader {
    padding: 8px;
  }

  .TierPage_Leader strong {
    font-size: 16px;
  }

  .TierPage_Leader em {
    font-size: 18px;
  }

  .TierPage_FilterBar {
    min-height: 0;
    margin-top: 12px;
    padding: 8px;
    gap: 8px;
  }

  .TierPage_FilterSummary {
    min-height: 36px;
    padding: 0 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border: 1px solid rgba(185, 133, 36, 0.58);
    color: #76521c;
    background: #fff4d9;
    font-family: var(--font-control);
    font-size: 13px;
    font-weight: 900;
    cursor: pointer;
  }

  .TierPage_FilterSummary strong {
    color: var(--color-primary);
    font-family: var(--font-number);
    font-size: 14px;
    white-space: nowrap;
  }

  .TierPage_FilterControls {
    display: none;
  }

  .TierPage_FilterBar_Open .TierPage_FilterControls {
    display: flex;
  }

  .TierPage_FilterBar select {
    height: 32px;
  }

  .TierPage_ClusterToggle {
    height: 32px;
  }

  .TierPage_TableCard {
    margin-top: 12px;
    padding: 12px 10px;
  }

  .TierPage_TableCard .Common_SectionHeading.Common_SectionHeading_Compact {
    margin-bottom: 8px;
    padding-bottom: 8px;
  }

  .TierPage_MobileList {
    gap: 6px;
  }

  .TierPage_MobileRow {
    gap: 6px;
    padding: 7px;
  }

  .TierPage_MobileHead {
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 8px;
    align-items: start;
  }

  .TierPage_MobileHead .Common_RankCell {
    font-size: 20px;
  }

  .TierPage_MobileHead :deep(.Common_ImageFrame) {
    width: 38px;
  }

  .TierPage_MobileTitleLine {
    gap: 6px;
  }

  .TierPage_MobileRow h3 {
    margin-bottom: 2px;
    font-size: 16px;
    line-height: 1.18;
  }

  .TierPage_MobileRow p {
    margin-bottom: 0;
    font-size: 12px;
    line-height: 1.2;
  }

  .TierPage_MobileHead small {
    margin-top: 2px;
    font-size: 11px;
    line-height: 1.15;
  }

  .TierPage_MobileMetricGrid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 4px;
  }

  .TierPage_MobileMetricGrid span {
    padding: 5px 4px;
    font-size: 10px;
    line-height: 1.05;
    text-align: center;
  }

  .TierPage_MobileMetricGrid b {
    margin-bottom: 1px;
    font-size: 14px;
  }

  .TierPage_MobileDeckSection > span {
    margin-bottom: 2px;
    font-size: 11px;
  }

  .TierPage_MobileActions {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .TierPage_ConfigToggle {
    width: auto;
    min-height: 28px;
    margin-top: 0;
    padding: 0 8px;
    flex: 0 0 auto;
    font-size: 11px;
  }

  .TierPage_MobileActions :deep(.Common_MetricTags) {
    min-width: 0;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 3px;
  }

  .TierPage_MobileActions :deep(.Common_MetricTags_Item) {
    min-width: 0;
    min-height: 26px;
    justify-content: center;
    padding: 0 3px;
    overflow: hidden;
    font-size: 10px;
    text-overflow: ellipsis;
  }
}
</style>
