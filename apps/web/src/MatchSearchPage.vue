<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import CommonDeckRail from "./components/Common_DeckRail.vue";
import CommonHeader from "./components/Common_Header.vue";
import CommonImageFrame from "./components/Common_ImageFrame.vue";
import { dateOnly, integer } from "./lib/format";
import { loadMatchSearchOptions, searchMatches } from "./lib/matchSearch";
import type {
  CardView,
  MatchSearchCardMatchMode,
  MatchSearchCardOption,
  MatchSearchItem,
  MatchSearchOptions,
  MatchSearchResponse,
  MatchSearchResultFilter,
  MatchSearchSideRequest,
  MatchSearchStrategyFilter,
  MatchSearchWeaponActivationFilter,
  MatchSearchWeaponOption,
} from "./types";

type SideKey = "sideA" | "sideB";

interface SideForm {
  cardQuery: string;
  faction: string;
  unitType: string;
  cost: string;
  cardIds: string[];
  strategyByCard: Record<string, MatchSearchStrategyFilter>;
  weaponQuery: string;
  weaponName: string;
  weaponActivated: MatchSearchWeaponActivationFilter;
  result: MatchSearchResultFilter;
}

const options = ref<MatchSearchOptions | null>(null);
const response = ref<MatchSearchResponse | null>(null);
const loading = ref(true);
const searching = ref(false);
const error = ref("");
const searchError = ref("");
const cardMatchMode = ref<MatchSearchCardMatchMode>("all");

const sideForms = reactive<Record<SideKey, SideForm>>({
  sideA: createSideForm(),
  sideB: createSideForm(),
});

const sideLabels: Record<SideKey, { title: string; subtitle: string }> = {
  sideA: { title: "Side A", subtitle: "采集方" },
  sideB: { title: "Side B", subtitle: "对手方" },
};
const sideKeys: SideKey[] = ["sideA", "sideB"];

onMounted(async () => {
  try {
    options.value = await loadMatchSearchOptions();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "对局搜索数据读取失败";
  } finally {
    loading.value = false;
  }
});

const metadata = computed(() => options.value?.metadata ?? null);
const cards = computed(() => options.value?.cards ?? []);
const weapons = computed(() => options.value?.weapons ?? []);
const cardsById = computed(() => new Map(cards.value.map((card) => [card.cardId, card])));
const page = computed(() => response.value?.page ?? 1);
const pageSize = computed(() => response.value?.pageSize ?? 20);
const total = computed(() => response.value?.total ?? 0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

const factions = computed(() => uniqueSorted(cards.value.map((card) => card.faction).filter((value) => value && value !== "unknown")));
const unitTypes = computed(() => uniqueSorted(cards.value.map((card) => card.unitType || "").filter(Boolean)));
const costs = computed(() => uniqueSorted(cards.value.map((card) => card.cost || "").filter(Boolean)));
const canSearch = computed(() => hasAnyFilter(sideForms.sideA) || hasAnyFilter(sideForms.sideB));

function createSideForm(): SideForm {
  return {
    cardQuery: "",
    faction: "all",
    unitType: "all",
    cost: "all",
    cardIds: [],
    strategyByCard: {},
    weaponQuery: "",
    weaponName: "",
    weaponActivated: "any",
    result: "any",
  };
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right, "ja"));
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function cardSearchText(card: MatchSearchCardOption): string {
  return normalizedText([
    card.name,
    card.cardCode,
    card.faction,
    card.unitType,
    card.cost,
    card.force,
    card.intelligence,
  ].filter(Boolean).join(" "));
}

function cardScore(card: MatchSearchCardOption, query: string): number {
  if (!query) return card.usageCount;
  const name = normalizedText(card.name);
  const code = normalizedText(card.cardCode || "");
  if (name === query || code === query) return 100000 + card.usageCount;
  if (name.startsWith(query) || code.startsWith(query)) return 80000 + card.usageCount;
  return cardSearchText(card).includes(query) ? 50000 + card.usageCount : 0;
}

function filteredCardOptions(side: SideForm): MatchSearchCardOption[] {
  const query = normalizedText(side.cardQuery);
  const selected = new Set(side.cardIds);
  return cards.value
    .filter((card) => !selected.has(card.cardId))
    .filter((card) => side.faction === "all" || card.faction === side.faction)
    .filter((card) => side.unitType === "all" || card.unitType === side.unitType)
    .filter((card) => side.cost === "all" || card.cost === side.cost)
    .map((card) => ({ card, score: cardScore(card, query) }))
    .filter((item) => !query || item.score > 0)
    .sort((left, right) => right.score - left.score || right.card.usageCount - left.card.usageCount || left.card.name.localeCompare(right.card.name, "ja"))
    .slice(0, 24)
    .map((item) => item.card);
}

function filteredWeaponOptions(side: SideForm): MatchSearchWeaponOption[] {
  const query = normalizedText(side.weaponQuery);
  return weapons.value
    .filter((weapon) => !query || normalizedText(weapon.name).includes(query))
    .slice(0, 80);
}

function selectedCards(side: SideForm): MatchSearchCardOption[] {
  return side.cardIds.map((cardId) => cardsById.value.get(cardId)).filter(Boolean) as MatchSearchCardOption[];
}

function addCard(side: SideForm, card: MatchSearchCardOption): void {
  if (side.cardIds.includes(card.cardId) || side.cardIds.length >= 8) return;
  side.cardIds.push(card.cardId);
  side.strategyByCard[card.cardId] = "any";
  side.cardQuery = "";
}

function removeCard(side: SideForm, cardId: string): void {
  side.cardIds = side.cardIds.filter((value) => value !== cardId);
  delete side.strategyByCard[cardId];
}

function clearSide(side: SideForm): void {
  const fresh = createSideForm();
  Object.assign(side, fresh);
}

function hasAnyFilter(side: SideForm): boolean {
  return side.cardIds.length > 0
    || Boolean(side.weaponName)
    || side.weaponActivated !== "any"
    || side.result !== "any";
}

function requestSide(side: SideForm): MatchSearchSideRequest {
  return {
    cardIds: side.cardIds,
    strategyByCard: side.strategyByCard,
    weaponName: side.weaponName,
    weaponActivated: side.weaponActivated,
    result: side.result,
  };
}

async function runSearch(nextPage = 1): Promise<void> {
  if (!canSearch.value) return;
  searching.value = true;
  searchError.value = "";

  try {
    response.value = await searchMatches({
      page: nextPage,
      pageSize: 20,
      cardMatchMode: cardMatchMode.value,
      sideA: requestSide(sideForms.sideA),
      sideB: requestSide(sideForms.sideB),
    });
  } catch (caught) {
    searchError.value = caught instanceof Error ? caught.message : "搜索失败";
  } finally {
    searching.value = false;
  }
}

function deckSlots(cardsValue: CardView[]): (CardView | null)[] {
  return Array.from({ length: 8 }, (_, index) => cardsValue[index] ?? null);
}

function resultLabel(value: string): string {
  const labels: Record<string, string> = {
    win: "胜",
    loss: "负",
    draw: "平",
  };
  return labels[value] || "-";
}

function resultFilterLabel(value: MatchSearchResultFilter): string {
  const labels: Record<MatchSearchResultFilter, string> = {
    any: "任意",
    win: "胜",
    loss: "负",
    draw: "平",
  };
  return labels[value];
}

function strategyLabel(value: MatchSearchStrategyFilter): string {
  const labels: Record<MatchSearchStrategyFilter, string> = {
    any: "计略任意",
    used: "计略有",
    unused: "计略无",
  };
  return labels[value];
}

function activationLabel(value: MatchSearchWeaponActivationFilter | string): string {
  const labels: Record<string, string> = {
    any: "任意",
    yes: "已发动",
    no: "未发动",
    unknown: "未知",
  };
  return labels[value] || "-";
}

function sideHitNote(item: MatchSearchItem, sideKey: SideKey): string {
  const form = sideForms[sideKey];
  const side = item[sideKey];
  const parts = [];
  if (form.result !== "any") parts.push(resultFilterLabel(form.result));
  if (form.weaponName) parts.push(side.weaponName || form.weaponName);
  if (form.weaponActivated !== "any") parts.push(activationLabel(form.weaponActivated));
  for (const cardId of form.cardIds) {
    const card = cardsById.value.get(cardId);
    const strategy = form.strategyByCard[cardId] || "any";
    parts.push(strategy === "any" ? card?.name || cardId : `${card?.name || cardId} ${strategyLabel(strategy)}`);
  }
  return parts.join(" / ") || "-";
}
</script>

<template>
  <CommonHeader current="matchSearch" />
  <main class="Common_PageShell MatchSearchPage">
    <section v-if="loading" class="Common_StatusPanel">正在读取对局搜索数据...</section>
    <section v-else-if="error" class="Common_StatusPanel Common_StatusPanel_Error">{{ error }}</section>
    <template v-else-if="options && metadata">
      <section class="MatchSearch_Hero" aria-labelledby="match-search-title">
        <div>
          <p class="Common_Eyebrow">Match Search</p>
          <h1 id="match-search-title">对局搜索</h1>
          <p class="MatchSearch_MetaLine">
            <span>{{ metadata.targetVersion || "未指定版本" }}</span>
            <span>Run {{ metadata.sourceRunId || "-" }}</span>
            <span>{{ dateOnly(metadata.dateFrom || "") }} - {{ dateOnly(metadata.dateTo || "") }}</span>
            <span>视频 {{ integer(metadata.videoMatchCount) }}</span>
          </p>
        </div>
        <div class="MatchSearch_ActionBox">
          <span>{{ cardMatchMode === "all" ? "AND" : "OR" }}</span>
          <strong>{{ response ? integer(total) : integer(metadata.matchCount) }}</strong>
        </div>
      </section>

      <section class="MatchSearch_Toolbar" aria-label="搜索控制">
        <div class="MatchSearch_Segmented">
          <button type="button" :aria-pressed="cardMatchMode === 'all'" @click="cardMatchMode = 'all'">AND</button>
          <button type="button" :aria-pressed="cardMatchMode === 'any'" @click="cardMatchMode = 'any'">OR</button>
        </div>
        <button class="MatchSearch_SearchButton" type="button" :disabled="!canSearch || searching" @click="runSearch(1)">
          {{ searching ? "搜索中..." : "搜索" }}
        </button>
        <span v-if="searchError" class="MatchSearch_SearchError">{{ searchError }}</span>
        <span v-else class="MatchSearch_ToolbarCount">{{ response ? `命中 ${integer(total)} 条` : "未搜索" }}</span>
      </section>

      <section class="MatchSearch_FormGrid" aria-label="双方条件">
        <article v-for="sideKey in sideKeys" :key="sideKey" class="MatchSearch_SidePanel">
          <div class="MatchSearch_SideHead">
            <div>
              <p class="Common_Eyebrow">{{ sideLabels[sideKey].subtitle }}</p>
              <h2>{{ sideLabels[sideKey].title }}</h2>
            </div>
            <button type="button" @click="clearSide(sideForms[sideKey])">清空</button>
          </div>

          <div class="MatchSearch_ControlRow">
            <label>
              胜负
              <select v-model="sideForms[sideKey].result">
                <option value="any">任意</option>
                <option value="win">胜</option>
                <option value="loss">负</option>
                <option value="draw">平</option>
              </select>
            </label>
            <label>
              战器发动
              <select v-model="sideForms[sideKey].weaponActivated">
                <option value="any">任意</option>
                <option value="yes">已发动</option>
                <option value="no">未发动</option>
              </select>
            </label>
          </div>

          <div class="MatchSearch_FieldBlock">
            <label>
              战器
              <input v-model="sideForms[sideKey].weaponQuery" type="search" autocomplete="off" placeholder="筛选战器" />
            </label>
            <select v-model="sideForms[sideKey].weaponName">
              <option value="">全部战器</option>
              <option v-for="weapon in filteredWeaponOptions(sideForms[sideKey])" :key="weapon.name" :value="weapon.name">
                {{ weapon.name }}（{{ integer(weapon.usageCount) }}）
              </option>
            </select>
          </div>

          <div class="MatchSearch_FieldBlock">
            <label>
              单卡
              <input v-model="sideForms[sideKey].cardQuery" type="search" autocomplete="off" placeholder="名称 / 卡号 / 势力 / 兵种 / Cost" />
            </label>
            <div class="MatchSearch_FilterRow">
              <select v-model="sideForms[sideKey].faction" aria-label="势力">
                <option value="all">全部势力</option>
                <option v-for="faction in factions" :key="faction" :value="faction">{{ faction }}</option>
              </select>
              <select v-model="sideForms[sideKey].unitType" aria-label="兵种">
                <option value="all">全部兵种</option>
                <option v-for="unitType in unitTypes" :key="unitType" :value="unitType">{{ unitType }}</option>
              </select>
              <select v-model="sideForms[sideKey].cost" aria-label="Cost">
                <option value="all">全部 Cost</option>
                <option v-for="cost in costs" :key="cost" :value="cost">{{ cost }}</option>
              </select>
            </div>
            <div class="MatchSearch_CardResults">
              <button
                v-for="card in filteredCardOptions(sideForms[sideKey])"
                :key="card.cardId"
                class="MatchSearch_CardPick"
                type="button"
                @click="addCard(sideForms[sideKey], card)"
              >
                <CommonImageFrame :src="card.imageUrl" :alt="card.imageAlt" :card="card" show-details density="compact" ratio="portrait" />
                <span>
                  <strong>{{ card.name }}</strong>
                  <small>{{ card.cardCode || "-" }} / {{ card.faction }} / {{ card.unitType || "-" }} / {{ card.cost || "-" }}</small>
                </span>
                <em>{{ integer(card.usageCount) }}</em>
              </button>
            </div>
          </div>

          <div class="MatchSearch_SelectedList">
            <article v-for="card in selectedCards(sideForms[sideKey])" :key="card.cardId" class="MatchSearch_SelectedCard">
              <CommonImageFrame :src="card.imageUrl" :alt="card.imageAlt" :card="card" show-details density="compact" ratio="portrait" />
              <div>
                <strong>{{ card.name }}</strong>
                <small>{{ card.cardCode || "-" }} / {{ card.unitType || "-" }}</small>
              </div>
              <select v-model="sideForms[sideKey].strategyByCard[card.cardId]" :aria-label="`${card.name} 计略条件`">
                <option value="any">计略任意</option>
                <option value="used">计略有</option>
                <option value="unused">计略无</option>
              </select>
              <button type="button" :aria-label="`移除 ${card.name}`" @click="removeCard(sideForms[sideKey], card.cardId)">×</button>
            </article>
          </div>
        </article>
      </section>

      <section class="Common_TableCard MatchSearch_ResultPanel" aria-labelledby="match-result-title">
        <div class="Common_SectionHeading Common_SectionHeading_Compact">
          <div>
            <p class="Common_Eyebrow">Results</p>
            <h2 id="match-result-title">搜索结果</h2>
          </div>
          <span>{{ response ? `${integer(total)} 条` : "等待搜索" }}</span>
        </div>

        <div v-if="response && !response.items.length" class="Common_StatusPanel">没有匹配对局</div>
        <div v-else-if="response" class="MatchSearch_ResultList">
          <article v-for="item in response.items" :key="item.matchId" class="MatchSearch_ResultItem">
            <div class="MatchSearch_ResultHead">
              <div>
                <strong>#{{ item.matchId }}</strong>
                <span>{{ dateOnly(item.playedAt) }} / {{ item.version || "-" }} / {{ item.mode || "-" }}</span>
              </div>
              <a v-if="item.videoUrl" :href="item.videoUrl" target="_blank" rel="noopener noreferrer">打开视频</a>
            </div>
            <div class="MatchSearch_ResultSides">
              <section v-for="sideKey in sideKeys" :key="`${item.matchId}-${sideKey}`">
                <div class="MatchSearch_ResultSideTitle">
                  <strong>{{ sideLabels[sideKey].title }} {{ resultLabel(item[sideKey].result) }}</strong>
                  <span>{{ item[sideKey].playerName || "-" }}</span>
                </div>
                <p>{{ sideHitNote(item, sideKey) }}</p>
                <CommonDeckRail :cards="deckSlots(item[sideKey].cards)" rail-class="Common_DeckRail_Mini" :show-card-details="true" card-density="compact" />
                <div class="MatchSearch_ResultTags">
                  <span>{{ item[sideKey].weaponName || "无战器" }}</span>
                  <span>{{ activationLabel(item[sideKey].weaponActivated) }}</span>
                  <span v-if="item[sideKey].schoolName">{{ item[sideKey].schoolName }}</span>
                </div>
              </section>
            </div>
          </article>
        </div>
        <div v-else class="Common_StatusPanel">请设置条件后搜索</div>

        <div v-if="response && totalPages > 1" class="MatchSearch_Pager">
          <button type="button" :disabled="page <= 1 || searching" @click="runSearch(page - 1)">上一页</button>
          <span>{{ page }} / {{ totalPages }}</span>
          <button type="button" :disabled="page >= totalPages || searching" @click="runSearch(page + 1)">下一页</button>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.MatchSearchPage {
  padding-top: 18px;
}

.MatchSearch_Hero {
  min-height: 136px;
  padding: 20px 28px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 148px;
  align-items: center;
  gap: var(--space-lg);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}

.MatchSearch_Hero h1 {
  margin-bottom: 8px;
  color: var(--color-brown);
  font-family: var(--font-serif);
  font-size: 42px;
  line-height: 1.15;
}

.MatchSearch_MetaLine {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 14px;
  font-weight: 700;
}

.MatchSearch_ActionBox {
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid rgba(216, 192, 151, 0.82);
  background: rgba(255, 248, 235, 0.72);
  text-align: right;
}

.MatchSearch_ActionBox span,
.MatchSearch_ActionBox strong {
  display: block;
}

.MatchSearch_ActionBox span {
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 13px;
  font-weight: 800;
}

.MatchSearch_ActionBox strong {
  margin-top: 4px;
  color: var(--color-gold);
  font-family: var(--font-number);
  font-size: 32px;
  line-height: 1;
}

.MatchSearch_Toolbar,
.MatchSearch_SidePanel {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}

.MatchSearch_Toolbar {
  margin-top: var(--space-md);
  min-height: 64px;
  padding: 12px 18px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.MatchSearch_Segmented {
  display: inline-grid;
  grid-template-columns: repeat(2, 70px);
  border: 1px solid rgba(185, 133, 36, 0.52);
  background: #fffaf0;
}

.MatchSearch_Segmented button,
.MatchSearch_SearchButton,
.MatchSearch_SideHead button,
.MatchSearch_Pager button {
  min-height: 36px;
  border: 0;
  color: #76521c;
  background: transparent;
  font-family: var(--font-control);
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
}

.MatchSearch_Segmented button[aria-pressed="true"],
.MatchSearch_SearchButton {
  color: #fffaf0;
  background: var(--color-primary);
}

.MatchSearch_SearchButton {
  min-width: 112px;
  padding: 0 18px;
}

.MatchSearch_SearchButton:disabled,
.MatchSearch_Pager button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.MatchSearch_SearchError,
.MatchSearch_ToolbarCount {
  margin-left: auto;
  font-family: var(--font-control);
  font-size: 14px;
  font-weight: 800;
}

.MatchSearch_SearchError {
  color: var(--color-primary);
}

.MatchSearch_ToolbarCount {
  color: var(--color-muted);
}

.MatchSearch_FormGrid {
  margin-top: var(--space-md);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-md);
}

.MatchSearch_SidePanel {
  min-width: 0;
  padding: 18px;
}

.MatchSearch_SideHead {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: var(--space-md);
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(216, 192, 151, 0.8);
}

.MatchSearch_SideHead h2 {
  margin: 0;
  color: var(--color-brown);
  font-family: var(--font-serif);
  font-size: 28px;
  line-height: 1.2;
}

.MatchSearch_SideHead button {
  min-width: 60px;
  border: 1px solid rgba(185, 133, 36, 0.52);
  background: rgba(255, 244, 217, 0.72);
}

.MatchSearch_ControlRow,
.MatchSearch_FilterRow {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.MatchSearch_FilterRow {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.MatchSearch_FieldBlock {
  margin-top: 12px;
  display: grid;
  gap: 8px;
}

.MatchSearch_ControlRow label,
.MatchSearch_FieldBlock label {
  display: grid;
  gap: 5px;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 13px;
  font-weight: 800;
}

.MatchSearch_ControlRow select,
.MatchSearch_FieldBlock select,
.MatchSearch_FieldBlock input,
.MatchSearch_SelectedCard select {
  width: 100%;
  min-height: 36px;
  border: 1px solid var(--color-border);
  color: var(--color-brown);
  background: #fffaf0;
  font-family: var(--font-control);
  font-size: 14px;
  font-weight: 800;
}

.MatchSearch_FieldBlock input {
  padding: 0 11px;
}

.MatchSearch_CardResults {
  max-height: 324px;
  overflow-y: auto;
  display: grid;
  gap: 6px;
  padding-right: 2px;
}

.MatchSearch_CardPick {
  min-width: 0;
  padding: 6px;
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(216, 192, 151, 0.72);
  color: var(--color-brown);
  background: rgba(255, 250, 240, 0.72);
  text-align: left;
  cursor: pointer;
}

.MatchSearch_CardPick:hover {
  border-color: rgba(169, 42, 36, 0.72);
}

.MatchSearch_CardPick :deep(.Common_ImageFrame),
.MatchSearch_SelectedCard :deep(.Common_ImageFrame) {
  width: 38px;
  height: 60px;
}

.MatchSearch_CardPick strong,
.MatchSearch_SelectedCard strong {
  display: block;
  overflow: hidden;
  color: var(--color-brown);
  font-family: var(--font-control);
  font-size: 14px;
  font-weight: 900;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.MatchSearch_CardPick small,
.MatchSearch_SelectedCard small {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 12px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.MatchSearch_CardPick em {
  color: var(--color-gold);
  font-family: var(--font-number);
  font-style: normal;
  font-weight: 900;
}

.MatchSearch_SelectedList {
  margin-top: 12px;
  display: grid;
  gap: 8px;
}

.MatchSearch_SelectedCard {
  min-width: 0;
  padding: 7px;
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 110px 34px;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(216, 192, 151, 0.72);
  background: rgba(255, 244, 217, 0.5);
}

.MatchSearch_SelectedCard button {
  width: 34px;
  height: 34px;
  border: 1px solid rgba(185, 133, 36, 0.52);
  color: var(--color-primary);
  background: #fffaf0;
  font-size: 18px;
  font-weight: 900;
  cursor: pointer;
}

.MatchSearch_ResultPanel {
  margin-top: var(--space-md);
}

.MatchSearch_ResultList {
  display: grid;
  gap: 14px;
}

.MatchSearch_ResultItem {
  padding: 14px;
  border: 1px solid rgba(216, 192, 151, 0.82);
  background: rgba(255, 250, 240, 0.76);
}

.MatchSearch_ResultHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.MatchSearch_ResultHead strong,
.MatchSearch_ResultHead span {
  display: block;
}

.MatchSearch_ResultHead strong {
  color: var(--color-gold);
  font-family: var(--font-number);
  font-size: 22px;
}

.MatchSearch_ResultHead span {
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 13px;
  font-weight: 800;
}

.MatchSearch_ResultHead a {
  min-height: 34px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  color: #fffaf0;
  background: var(--color-primary);
  font-family: var(--font-control);
  font-size: 13px;
  font-weight: 900;
}

.MatchSearch_ResultSides {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.MatchSearch_ResultSides section {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.MatchSearch_ResultSideTitle {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: var(--color-brown);
  font-family: var(--font-control);
  font-weight: 900;
}

.MatchSearch_ResultSideTitle span,
.MatchSearch_ResultSides p {
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 800;
}

.MatchSearch_ResultSides p {
  margin: 0;
  min-height: 18px;
}

.MatchSearch_ResultSides :deep(.Common_DeckRail_Mini) {
  max-width: 100%;
  overflow-x: auto;
}

.MatchSearch_ResultTags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.MatchSearch_ResultTags span {
  padding: 4px 8px;
  color: #76521c;
  background: rgba(255, 244, 217, 0.72);
  border: 1px solid rgba(216, 192, 151, 0.72);
  font-family: var(--font-control);
  font-size: 12px;
  font-weight: 900;
}

.MatchSearch_Pager {
  margin-top: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-weight: 900;
}

.MatchSearch_Pager button {
  min-width: 88px;
  border: 1px solid rgba(185, 133, 36, 0.52);
  background: #fffaf0;
}

@media (max-width: 1099px) {
  .MatchSearch_FormGrid,
  .MatchSearch_ResultSides {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .MatchSearch_Hero {
    min-height: 0;
    padding: var(--space-md);
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .MatchSearch_Hero h1 {
    font-size: 32px;
  }

  .MatchSearch_ActionBox {
    text-align: left;
  }

  .MatchSearch_Toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .MatchSearch_Segmented {
    width: 100%;
    grid-template-columns: repeat(2, 1fr);
  }

  .MatchSearch_SearchButton,
  .MatchSearch_SearchError,
  .MatchSearch_ToolbarCount {
    width: 100%;
    margin-left: 0;
  }

  .MatchSearch_SidePanel {
    padding: var(--space-md);
  }

  .MatchSearch_ControlRow,
  .MatchSearch_FilterRow {
    grid-template-columns: 1fr;
  }

  .MatchSearch_CardResults {
    max-height: 280px;
  }

  .MatchSearch_SelectedCard {
    grid-template-columns: 38px minmax(0, 1fr) 34px;
  }

  .MatchSearch_SelectedCard select {
    grid-column: 1 / -1;
  }

  .MatchSearch_ResultHead {
    align-items: stretch;
    flex-direction: column;
  }

  .MatchSearch_ResultHead a {
    justify-content: center;
  }
}
</style>
