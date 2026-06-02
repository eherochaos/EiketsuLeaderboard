<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
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
const pickerSide = ref<SideKey | null>(null);
const resultPanelRef = ref<HTMLElement | null>(null);

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
const pickerForm = computed(() => sideForms[pickerSide.value ?? "sideA"]);
const pickerTitle = computed(() => pickerSide.value ? sideLabels[pickerSide.value].title : "");
const pickerSelectedCards = computed(() => selectedCards(pickerForm.value));
const pickerCardOptions = computed(() => {
  const selected = pickerSelectedCards.value;
  const candidates = filteredCardOptions(pickerForm.value, Math.max(0, 96 - selected.length));
  return [...selected, ...candidates];
});

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

function filteredCardOptions(side: SideForm, limit = 24): MatchSearchCardOption[] {
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
    .slice(0, limit)
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

function openCardPicker(sideKey: SideKey): void {
  pickerSide.value = sideKey;
}

function closeCardPicker(): void {
  pickerSide.value = null;
}

function addCard(side: SideForm, card: MatchSearchCardOption): void {
  if (side.cardIds.includes(card.cardId) || side.cardIds.length >= 8) return;
  side.cardIds.push(card.cardId);
  side.strategyByCard[card.cardId] = "any";
  side.cardQuery = "";
}

function isCardSelected(side: SideForm, cardId: string): boolean {
  return side.cardIds.includes(cardId);
}

function toggleCard(side: SideForm, card: MatchSearchCardOption): void {
  if (isCardSelected(side, card.cardId)) {
    removeCard(side, card.cardId);
    return;
  }
  addCard(side, card);
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
    await nextTick();
    resultPanelRef.value?.scrollIntoView({ block: "start", behavior: "smooth" });
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
            <span class="MatchSearch_FieldLabel">单卡</span>
            <button class="MatchSearch_CardPickerTrigger" type="button" @click="openCardPicker(sideKey)">
              <span>
                <strong>选择单卡</strong>
                <small>{{ selectedCards(sideForms[sideKey]).length }} / 8 已选</small>
              </span>
              <em>{{ filteredCardOptions(sideForms[sideKey]).length }}</em>
            </button>
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

      <section ref="resultPanelRef" class="Common_TableCard MatchSearch_ResultPanel" aria-labelledby="match-result-title">
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
                <div class="MatchSearch_ResultSideMeta">
                  <div class="MatchSearch_ResultSideTitle">
                    <strong>{{ sideLabels[sideKey].title }} {{ resultLabel(item[sideKey].result) }}</strong>
                    <span>{{ item[sideKey].playerName || "-" }}</span>
                    <span class="MatchSearch_ResultHitNote">{{ sideHitNote(item, sideKey) }}</span>
                  </div>
                  <p>{{ sideHitNote(item, sideKey) }}</p>
                  <div class="MatchSearch_ResultSideInline">
                    <span>{{ item[sideKey].weaponName || "无战器" }}</span>
                    <span>{{ activationLabel(item[sideKey].weaponActivated) }}</span>
                    <span v-if="item[sideKey].schoolName">{{ item[sideKey].schoolName }}</span>
                  </div>
                </div>
                <CommonDeckRail :cards="deckSlots(item[sideKey].cards)" rail-class="Common_DeckRail_Mini" :show-card-details="true" card-density="compact" />
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

    <div v-if="pickerSide" class="MatchSearch_CardPickerBackdrop" role="presentation" @click.self="closeCardPicker">
      <section class="MatchSearch_CardPicker" role="dialog" aria-modal="true" aria-labelledby="match-card-picker-title" @keydown.esc="closeCardPicker">
        <header class="MatchSearch_CardPickerHead">
          <div>
            <p class="Common_Eyebrow">{{ pickerTitle }}</p>
            <h2 id="match-card-picker-title">选择单卡</h2>
          </div>
          <button type="button" aria-label="关闭选卡" @click="closeCardPicker">×</button>
        </header>

        <div class="MatchSearch_CardPickerControls">
          <label>
            搜索
            <input v-model="pickerForm.cardQuery" type="search" autocomplete="off" placeholder="名称 / 卡号 / 势力 / 兵种 / Cost" />
          </label>
          <select v-model="pickerForm.faction" aria-label="势力">
            <option value="all">全部势力</option>
            <option v-for="faction in factions" :key="faction" :value="faction">{{ faction }}</option>
          </select>
          <select v-model="pickerForm.unitType" aria-label="兵种">
            <option value="all">全部兵种</option>
            <option v-for="unitType in unitTypes" :key="unitType" :value="unitType">{{ unitType }}</option>
          </select>
          <select v-model="pickerForm.cost" aria-label="Cost">
            <option value="all">全部 Cost</option>
            <option v-for="cost in costs" :key="cost" :value="cost">{{ cost }}</option>
          </select>
        </div>

        <div class="MatchSearch_CardPickerSelected">
          <span>{{ pickerSelectedCards.length }} / 8 已选</span>
          <button v-for="card in pickerSelectedCards" :key="card.cardId" type="button" @click="removeCard(pickerForm, card.cardId)">
            {{ card.name }} ×
          </button>
        </div>

        <div v-if="pickerCardOptions.length" class="MatchSearch_CardPickerGrid">
          <button
            v-for="card in pickerCardOptions"
            :key="card.cardId"
            class="MatchSearch_CardPick"
            :class="{ MatchSearch_CardPick_Selected: isCardSelected(pickerForm, card.cardId) }"
            type="button"
            :disabled="pickerForm.cardIds.length >= 8 && !isCardSelected(pickerForm, card.cardId)"
            @click="toggleCard(pickerForm, card)"
          >
            <CommonImageFrame :src="card.imageUrl" :alt="card.imageAlt" :card="card" density="compact" ratio="portrait" />
            <span class="MatchSearch_CardPickText">
              <strong>{{ card.name }}</strong>
              <small>{{ card.cardCode || "-" }} / {{ card.faction }} / {{ card.unitType || "-" }} / {{ card.cost || "-" }}</small>
            </span>
            <em>{{ integer(card.usageCount) }}</em>
          </button>
        </div>
        <div v-else class="Common_StatusPanel">没有匹配单卡</div>

        <footer class="MatchSearch_CardPickerFoot">
          <button type="button" @click="closeCardPicker">完成</button>
        </footer>
      </section>
    </div>
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

.MatchSearch_FieldLabel {
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 13px;
  font-weight: 800;
}

.MatchSearch_CardPickerTrigger {
  width: 100%;
  min-height: 52px;
  padding: 9px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--color-border);
  color: var(--color-brown);
  background: #fffaf0;
  text-align: left;
  cursor: pointer;
}

.MatchSearch_CardPickerTrigger strong,
.MatchSearch_CardPickerTrigger small {
  display: block;
  font-family: var(--font-control);
}

.MatchSearch_CardPickerTrigger strong {
  font-size: 15px;
  font-weight: 900;
}

.MatchSearch_CardPickerTrigger small {
  margin-top: 3px;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 800;
}

.MatchSearch_CardPickerTrigger em {
  min-width: 34px;
  color: var(--color-gold);
  font-family: var(--font-number);
  font-size: 18px;
  font-style: normal;
  font-weight: 900;
  text-align: right;
}

.MatchSearch_CardPickerTrigger:hover {
  border-color: rgba(169, 42, 36, 0.72);
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

.MatchSearch_CardPick:disabled {
  cursor: not-allowed;
  opacity: 0.52;
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

.MatchSearch_CardPickerBackdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  padding: 24px;
  display: grid;
  place-items: center;
  background: rgba(28, 20, 12, 0.36);
}

.MatchSearch_CardPicker {
  width: min(1120px, calc(100vw - 40px));
  max-height: min(700px, calc(100vh - 40px));
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
  border: 1px solid rgba(185, 133, 36, 0.56);
  background: var(--color-surface);
  box-shadow: 0 18px 48px rgba(55, 35, 12, 0.26);
}

.MatchSearch_CardPickerHead {
  padding: 8px 12px 6px;
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid rgba(216, 192, 151, 0.78);
}

.MatchSearch_CardPickerHead h2 {
  margin: 0;
  color: var(--color-brown);
  font-family: var(--font-serif);
  font-size: 22px;
  line-height: 1.2;
}

.MatchSearch_CardPickerHead button,
.MatchSearch_CardPickerFoot button,
.MatchSearch_CardPickerSelected button {
  border: 1px solid rgba(185, 133, 36, 0.52);
  color: #76521c;
  background: #fffaf0;
  font-family: var(--font-control);
  font-weight: 900;
  cursor: pointer;
}

.MatchSearch_CardPickerHead button {
  width: 30px;
  height: 30px;
  font-size: 18px;
  line-height: 1;
}

.MatchSearch_CardPickerControls {
  padding: 7px 12px 6px;
  display: grid;
  grid-template-columns: minmax(240px, 1fr) repeat(3, minmax(108px, 0.38fr));
  gap: 6px;
  border-bottom: 1px solid rgba(216, 192, 151, 0.52);
}

.MatchSearch_CardPickerControls label {
  display: grid;
  gap: 4px;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 12px;
  font-weight: 800;
}

.MatchSearch_CardPickerControls input,
.MatchSearch_CardPickerControls select {
  width: 100%;
  min-height: 32px;
  border: 1px solid var(--color-border);
  color: var(--color-brown);
  background: #fffaf0;
  font-family: var(--font-control);
  font-size: 12px;
  font-weight: 800;
}

.MatchSearch_CardPickerControls input {
  padding: 0 9px;
}

.MatchSearch_CardPickerSelected {
  min-height: 32px;
  padding: 4px 12px;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  border-bottom: 1px solid rgba(216, 192, 151, 0.52);
}

.MatchSearch_CardPickerSelected span {
  flex: 0 0 auto;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 12px;
  font-weight: 900;
}

.MatchSearch_CardPickerSelected button {
  flex: 0 0 auto;
  min-height: 24px;
  padding: 0 7px;
  font-size: 12px;
}

.MatchSearch_CardPickerGrid {
  min-height: 0;
  padding: 6px 12px 10px;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
}

.MatchSearch_CardPickerGrid .MatchSearch_CardPick {
  min-height: 56px;
  padding: 3px 5px;
  grid-template-columns: 32px minmax(0, 1fr) 34px;
  gap: 6px;
  background: rgba(255, 250, 240, 0.86);
}

.MatchSearch_CardPickerGrid .MatchSearch_CardPick :deep(.Common_ImageFrame) {
  width: 32px;
  height: 51px;
}

.MatchSearch_CardPickerGrid .MatchSearch_CardPick strong {
  font-size: 12px;
  line-height: 1.15;
}

.MatchSearch_CardPickerGrid .MatchSearch_CardPick small {
  margin-top: 1px;
  font-size: 10px;
  line-height: 1.15;
}

.MatchSearch_CardPickerGrid .MatchSearch_CardPick em {
  min-width: 0;
  font-size: 15px;
  text-align: right;
}

.MatchSearch_CardPickerFoot {
  padding: 6px 12px 10px;
  display: flex;
  justify-content: end;
  border-top: 1px solid rgba(216, 192, 151, 0.68);
}

.MatchSearch_CardPickerFoot button {
  min-width: 104px;
  min-height: 34px;
  color: #fffaf0;
  background: var(--color-primary);
}

.MatchSearch_ResultPanel {
  margin-top: var(--space-md);
}

.MatchSearch_ResultList {
  display: grid;
  align-items: start;
  gap: 8px;
}

.MatchSearch_ResultItem {
  width: fit-content;
  max-width: 100%;
  padding: 8px 10px;
  border: 1px solid rgba(216, 192, 151, 0.82);
  background: rgba(255, 250, 240, 0.76);
}

.MatchSearch_ResultHead {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.MatchSearch_ResultHead > div {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  gap: 8px;
}

.MatchSearch_ResultHead strong,
.MatchSearch_ResultHead span {
  display: block;
  min-width: 0;
}

.MatchSearch_ResultHead strong {
  color: var(--color-gold);
  font-family: var(--font-number);
  font-size: 18px;
}

.MatchSearch_ResultHead span {
  overflow: hidden;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 12px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.MatchSearch_ResultHead a {
  min-height: 28px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  color: #fffaf0;
  background: var(--color-primary);
  font-family: var(--font-control);
  font-size: 12px;
  font-weight: 900;
}

.MatchSearch_ResultSides {
  display: grid;
  grid-template-columns: repeat(2, max-content);
  justify-content: start;
  gap: 8px 18px;
  max-width: 100%;
}

.MatchSearch_ResultSides section {
  min-width: 0;
  width: max-content;
  max-width: 100%;
  display: grid;
  gap: 4px;
}

.MatchSearch_ResultSideMeta {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.MatchSearch_ResultSideTitle {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  gap: 8px;
  color: var(--color-brown);
  font-family: var(--font-control);
  font-size: 13px;
  font-weight: 900;
}

.MatchSearch_ResultSideTitle strong,
.MatchSearch_ResultSideTitle span,
.MatchSearch_ResultSides p {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.MatchSearch_ResultSideTitle span,
.MatchSearch_ResultSides p,
.MatchSearch_ResultSideInline {
  color: var(--color-muted);
  font-family: var(--font-control);
  font-weight: 800;
}

.MatchSearch_ResultHitNote {
  display: none;
}

.MatchSearch_ResultSides p {
  margin: 0;
  min-height: 0;
  font-size: 12px;
  line-height: 1.15;
}

.MatchSearch_ResultSides :deep(.Common_DeckRail_Mini) {
  max-width: 100%;
  overflow-x: auto;
}

.MatchSearch_ResultSideInline {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
  overflow: hidden;
  font-size: 11px;
  line-height: 1.15;
}

.MatchSearch_ResultSideInline span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.MatchSearch_ResultSideInline span + span::before {
  content: "/";
  margin-right: 8px;
  opacity: 0.5;
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

@media (max-width: 1180px) {
  .MatchSearch_CardPickerGrid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 980px) {
  .MatchSearch_CardPicker {
    width: min(920px, calc(100vw - 32px));
  }

  .MatchSearch_CardPickerGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .MatchSearchPage {
    padding-top: 8px;
  }

  .MatchSearchPage.Common_PageShell {
    padding-right: 8px;
    padding-left: 8px;
  }

  .MatchSearch_Hero {
    min-height: 0;
    padding: 8px 10px;
    grid-template-columns: minmax(0, 1fr) 68px;
    gap: 8px;
    box-shadow: none;
  }

  .MatchSearch_Hero .Common_Eyebrow {
    display: none;
  }

  .MatchSearch_Hero h1 {
    margin-bottom: 4px;
    font-size: 24px;
    line-height: 1;
  }

  .MatchSearch_MetaLine {
    gap: 3px 8px;
    font-size: 10px;
    line-height: 1.15;
  }

  .MatchSearch_MetaLine span {
    white-space: nowrap;
  }

  .MatchSearch_ActionBox {
    padding: 6px 8px;
    text-align: right;
  }

  .MatchSearch_ActionBox span {
    font-size: 10px;
  }

  .MatchSearch_ActionBox strong {
    margin-top: 2px;
    font-size: 19px;
  }

  .MatchSearch_Toolbar {
    min-height: 38px;
    margin-top: 6px;
    padding: 5px;
    align-items: center;
    flex-direction: row;
    gap: 5px;
    box-shadow: none;
  }

  .MatchSearch_Segmented {
    flex: 0 0 84px;
    width: 84px;
    grid-template-columns: repeat(2, 42px);
  }

  .MatchSearch_Segmented button,
  .MatchSearch_SearchButton {
    min-height: 32px;
    font-size: 11px;
  }

  .MatchSearch_SearchButton {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0 8px;
    font-size: 12px;
  }

  .MatchSearch_SearchError,
  .MatchSearch_ToolbarCount {
    flex: 0 1 88px;
    width: auto;
    margin-left: 0;
    overflow: hidden;
    font-size: 11px;
    line-height: 1.1;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .MatchSearch_FormGrid {
    margin-top: 6px;
    gap: 6px;
  }

  .MatchSearch_SidePanel {
    padding: 8px;
    box-shadow: none;
  }

  .MatchSearch_SideHead {
    align-items: center;
    margin-bottom: 6px;
    padding-bottom: 5px;
  }

  .MatchSearch_SideHead .Common_Eyebrow {
    display: none;
  }

  .MatchSearch_SideHead h2 {
    font-size: 20px;
    line-height: 1;
  }

  .MatchSearch_SideHead button {
    min-width: 46px;
    min-height: 28px;
    font-size: 11px;
  }

  .MatchSearch_ControlRow,
  .MatchSearch_FilterRow {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }

  .MatchSearch_FieldBlock {
    margin-top: 6px;
    gap: 4px;
  }

  .MatchSearch_ControlRow label,
  .MatchSearch_FieldBlock label,
  .MatchSearch_FieldLabel {
    gap: 2px;
    font-size: 10px;
  }

  .MatchSearch_ControlRow select,
  .MatchSearch_FieldBlock select,
  .MatchSearch_FieldBlock input,
  .MatchSearch_SelectedCard select {
    min-height: 30px;
    font-size: 12px;
  }

  .MatchSearch_FieldBlock input {
    padding: 0 8px;
  }

  .MatchSearch_CardPickerTrigger {
    min-height: 34px;
    padding: 5px 8px;
  }

  .MatchSearch_CardPickerTrigger strong {
    font-size: 12px;
  }

  .MatchSearch_CardPickerTrigger small {
    margin-top: 1px;
    font-size: 10px;
  }

  .MatchSearch_CardPickerTrigger em {
    min-width: 24px;
    font-size: 14px;
  }

  .MatchSearch_SelectedList {
    margin-top: 6px;
    gap: 5px;
  }

  .MatchSearch_SelectedCard {
    padding: 4px;
    grid-template-columns: 32px minmax(0, 1fr) 78px 28px;
    gap: 5px;
  }

  .MatchSearch_CardPick :deep(.Common_ImageFrame),
  .MatchSearch_SelectedCard :deep(.Common_ImageFrame) {
    width: 32px;
    height: 51px;
  }

  .MatchSearch_CardPick strong,
  .MatchSearch_SelectedCard strong {
    font-size: 12px;
  }

  .MatchSearch_CardPick small,
  .MatchSearch_SelectedCard small {
    margin-top: 1px;
    font-size: 10px;
  }

  .MatchSearch_CardPickerBackdrop {
    padding: 0;
    place-items: stretch;
  }

  .MatchSearch_CardPicker {
    width: 100%;
    height: 100svh;
    max-height: none;
    border: 0;
  }

  .MatchSearch_CardPickerHead {
    padding: 5px 8px;
    align-items: center;
  }

  .MatchSearch_CardPickerHead .Common_Eyebrow {
    display: none;
  }

  .MatchSearch_CardPickerHead h2 {
    font-size: 18px;
  }

  .MatchSearch_CardPickerHead button {
    width: 30px;
    height: 30px;
  }

  .MatchSearch_CardPickerControls {
    padding: 5px 8px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
  }

  .MatchSearch_CardPickerControls label {
    grid-column: 1 / -1;
    gap: 2px;
    font-size: 10px;
  }

  .MatchSearch_CardPickerControls input,
  .MatchSearch_CardPickerControls select {
    min-height: 30px;
    font-size: 11px;
  }

  .MatchSearch_CardPickerControls input {
    padding: 0 8px;
  }

  .MatchSearch_CardPickerSelected {
    min-height: 28px;
    padding: 3px 8px;
  }

  .MatchSearch_CardPickerSelected span,
  .MatchSearch_CardPickerSelected button {
    font-size: 10px;
  }

  .MatchSearch_CardPickerGrid {
    padding: 4px 8px 6px;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    align-content: start;
    gap: 5px;
  }

  .MatchSearch_CardPickerGrid .MatchSearch_CardPick {
    position: relative;
    min-height: 0;
    padding: 0;
    grid-template-columns: 1fr;
    gap: 0;
    height: clamp(104px, 34vw, 138px);
    overflow: hidden;
  }

  .MatchSearch_CardPickerGrid .MatchSearch_CardPick :deep(.Common_ImageFrame) {
    width: 100%;
    height: 100%;
  }

  .MatchSearch_CardPickerGrid .MatchSearch_CardPick > * {
    pointer-events: none;
  }

  .MatchSearch_CardPickerGrid .MatchSearch_CardPickText,
  .MatchSearch_CardPickerGrid .MatchSearch_CardPickText small {
    display: none;
  }

  .MatchSearch_CardPickerGrid .MatchSearch_CardPick em {
    display: none;
  }

  .MatchSearch_CardPick_Selected::before {
    position: absolute;
    inset: 0;
    z-index: 2;
    content: "";
    background: rgba(43, 24, 12, 0.46);
  }

  .MatchSearch_CardPick_Selected::after {
    position: absolute;
    right: 4px;
    bottom: 3px;
    z-index: 3;
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    color: #fffaf0;
    background: var(--color-primary);
    border-radius: 999px;
    content: "✓";
    font-family: var(--font-control);
    font-size: 12px;
    font-weight: 900;
  }

  .MatchSearch_CardPick_Selected::before,
  .MatchSearch_CardPick_Selected::after {
    pointer-events: none;
  }

  .MatchSearch_CardPickerFoot {
    padding: 5px 8px max(8px, env(safe-area-inset-bottom));
  }

  .MatchSearch_CardPickerFoot button {
    width: 100%;
    min-height: 34px;
  }

  .MatchSearch_ResultPanel {
    margin-top: 8px;
    padding: 8px;
    overflow-x: hidden;
    scroll-margin-top: 70px;
  }

  .MatchSearch_ResultPanel .Common_SectionHeading {
    align-items: center;
    flex-direction: row;
    gap: 8px;
    margin-bottom: 6px;
    padding-bottom: 6px;
  }

  .MatchSearch_ResultPanel .Common_SectionHeading h2 {
    font-size: 22px;
  }

  .MatchSearch_ResultList {
    gap: 5px;
  }

  .MatchSearch_ResultItem {
    width: 100%;
    padding: 5px;
  }

  .MatchSearch_ResultHead {
    margin-bottom: 4px;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
  }

  .MatchSearch_ResultHead > div {
    grid-template-columns: 1fr;
    gap: 1px;
  }

  .MatchSearch_ResultHead strong {
    font-size: 16px;
  }

  .MatchSearch_ResultHead span {
    font-size: 10px;
  }

  .MatchSearch_ResultHead a {
    min-height: 28px;
    padding: 0 8px;
    justify-content: center;
    font-size: 11px;
  }

  .MatchSearch_ResultSides {
    gap: 4px;
  }

  .MatchSearch_ResultSides section {
    width: 100%;
    gap: 2px;
  }

  .MatchSearch_ResultSideMeta {
    gap: 0;
  }

  .MatchSearch_ResultSideTitle {
    display: flex;
    align-items: baseline;
    gap: 4px;
    font-size: 11px;
    line-height: 1.05;
  }

  .MatchSearch_ResultSideTitle strong {
    flex: 0 0 auto;
  }

  .MatchSearch_ResultSideTitle > span:not(.MatchSearch_ResultHitNote) {
    flex: 0 1 auto;
    max-width: 88px;
  }

  .MatchSearch_ResultHitNote {
    flex: 1 1 auto;
    display: block;
    min-width: 0;
    color: var(--color-muted);
  }

  .MatchSearch_ResultSides p {
    display: none;
  }

  .MatchSearch_ResultSideInline {
    font-size: 9px;
    line-height: 1.05;
    gap: 1px 6px;
  }

  .MatchSearch_ResultSides :deep(.Common_DeckRail_Mini) {
    --Common_DeckRail_SlotHeight: 48px;

    grid-template-columns: none;
    grid-auto-flow: column;
    grid-auto-columns: var(--Common_DeckRail_SlotWidth);
    gap: 2px;
    width: 100%;
    padding: 3px;
    overflow-x: auto;
  }

  .MatchSearch_ResultSides :deep(.Common_DeckRail_Mini .Common_DeckRail_EmptySlot) {
    display: none;
  }

  .MatchSearch_Pager {
    margin-top: 8px;
    gap: 8px;
  }

  .MatchSearch_Pager button {
    min-width: 76px;
    min-height: 30px;
  }
}
</style>
