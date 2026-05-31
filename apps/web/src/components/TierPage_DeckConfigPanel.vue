<script setup lang="ts">
import { integer, percent } from "../lib/format";
import type {
  DeckConfigItem,
  DeckConfigStats,
  DeckSchoolStageConfigItem,
  DeckStrategyConfigItem,
  DeckUnfavorableMatchupItem
} from "../types";

const props = defineProps<{
  config: DeckConfigStats;
  sampleSize: number;
}>();

type ChoiceGroupKey = "weapons" | "styles" | "souls";

const groups: { key: ChoiceGroupKey; title: string }[] = [
  { key: "weapons", title: "战器选择" },
  { key: "styles", title: "流派选择" },
  { key: "souls", title: "英魂选择" }
];

function groupItems(key: ChoiceGroupKey): DeckConfigItem[] {
  return props.config?.[key] ?? [];
}

function strategyItems(): DeckStrategyConfigItem[] {
  return props.config?.strategies ?? [];
}

function schoolStageItems(): DeckSchoolStageConfigItem[] {
  return props.config?.schoolStages ?? [];
}

function unfavorableMatchups(): DeckUnfavorableMatchupItem[] {
  return props.config?.unfavorableMatchups ?? [];
}

function barWidth(value: number): string {
  return `${Math.min(Math.max(Number(value || 0), 0), 100)}%`;
}

function averageCount(value: number): string {
  return Number(value || 0).toFixed(2);
}
</script>

<template>
  <section class="TierPage_DeckConfigPanel" aria-label="配置情报">
    <header class="TierPage_DeckConfigPanel_Header">
      <div>
        <p class="Common_Eyebrow">Config</p>
        <h3>配置情报</h3>
      </div>
      <span>样本 {{ integer(sampleSize) }}</span>
    </header>

    <div class="TierPage_DeckConfigPanel_Groups">
      <section
        v-for="group in groups"
        :key="group.key"
        class="TierPage_DeckConfigPanel_Group"
      >
        <h4>{{ group.title }}</h4>
        <div v-if="groupItems(group.key).length" class="TierPage_DeckConfigPanel_List">
          <article
            v-for="item in groupItems(group.key)"
            :key="`${group.key}-${item.name}`"
            class="TierPage_DeckConfigPanel_Item"
          >
            <div class="TierPage_DeckConfigPanel_ItemHead">
              <strong>{{ item.name }}</strong>
              <span>{{ percent(item.usageRate) }}</span>
            </div>
            <div class="TierPage_DeckConfigPanel_Bar" aria-hidden="true">
              <i :style="{ width: barWidth(item.usageRate) }"></i>
            </div>
            <div class="TierPage_DeckConfigPanel_ItemMeta">
              <small>样本 {{ integer(item.sampleSize) }}</small>
              <em v-if="item.lowSample">低样本</em>
            </div>
          </article>
        </div>
        <p v-else class="TierPage_DeckConfigPanel_Empty">暂无配置数据</p>
      </section>

      <section class="TierPage_DeckConfigPanel_Group">
        <h4>计略次数</h4>
        <div v-if="strategyItems().length" class="TierPage_DeckConfigPanel_List">
          <article
            v-for="item in strategyItems()"
            :key="`strategy-${item.cardId}`"
            class="TierPage_DeckConfigPanel_Item"
          >
            <div class="TierPage_DeckConfigPanel_ItemHead">
              <strong>{{ item.name }}</strong>
              <span>场均 {{ averageCount(item.averageCount) }}</span>
            </div>
            <div class="TierPage_DeckConfigPanel_Bar" aria-hidden="true">
              <i :style="{ width: barWidth(item.usageRate) }"></i>
            </div>
            <div class="TierPage_DeckConfigPanel_ItemMeta">
              <small>样本 {{ integer(item.sampleSize) }}</small>
            </div>
          </article>
        </div>
        <p v-else class="TierPage_DeckConfigPanel_Empty">暂无计略数据</p>
      </section>

      <section class="TierPage_DeckConfigPanel_Group">
        <h4>流派阶段</h4>
        <div v-if="schoolStageItems().length" class="TierPage_DeckConfigPanel_List">
          <article
            v-for="item in schoolStageItems()"
            :key="`school-${item.stage}-${item.name}`"
            class="TierPage_DeckConfigPanel_Item"
          >
            <div class="TierPage_DeckConfigPanel_ItemHead">
              <a
                v-if="item.highlightMatchUrl"
                class="TierPage_DeckConfigPanel_MatchLink"
                :href="item.highlightMatchUrl"
                :title="item.highlightMatchLabel || '精彩对局'"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ item.name }}
              </a>
              <strong v-else>{{ item.name }}</strong>
              <span>场均 {{ averageCount(item.averageCount) }}</span>
            </div>
            <div class="TierPage_DeckConfigPanel_Bar" aria-hidden="true">
              <i :style="{ width: barWidth(item.usageRate) }"></i>
            </div>
            <div class="TierPage_DeckConfigPanel_ItemMeta">
              <small>启用 {{ integer(item.sampleSize) }} / {{ percent(item.usageRate) }}</small>
              <em v-if="item.lowSample">低样本</em>
            </div>
          </article>
        </div>
        <p v-else class="TierPage_DeckConfigPanel_Empty">暂无流派阶段数据</p>
      </section>

      <section class="TierPage_DeckConfigPanel_Group">
        <h4>劣势对局</h4>
        <div v-if="unfavorableMatchups().length" class="TierPage_DeckConfigPanel_List">
          <article
            v-for="item in unfavorableMatchups()"
            :key="`matchup-${item.deckId}`"
            class="TierPage_DeckConfigPanel_Item"
          >
            <div class="TierPage_DeckConfigPanel_ItemHead">
              <strong>{{ item.deckName }}</strong>
              <span>{{ integer(item.sampleSize) }}局</span>
            </div>
            <div class="TierPage_DeckConfigPanel_Bar" aria-hidden="true">
              <i :style="{ width: barWidth(item.usageRate) }"></i>
            </div>
            <div class="TierPage_DeckConfigPanel_ItemMeta">
              <small>败局占比 {{ percent(item.usageRate) }}</small>
            </div>
          </article>
        </div>
        <p v-else class="TierPage_DeckConfigPanel_Empty">暂无对局数据</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
/* 配置详情面板：承载配置、计略、流派阶段和对局的自动统计。 */
.TierPage_DeckConfigPanel {
  padding: 14px 16px 16px;
  border: 1px solid rgba(216, 192, 151, 0.76);
  background: rgba(255, 248, 235, 0.72);
}

/* 面板标题区：左侧标题，右侧样本数。 */
.TierPage_DeckConfigPanel_Header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid rgba(216, 192, 151, 0.72);
}

.TierPage_DeckConfigPanel_Header .Common_Eyebrow {
  margin-bottom: 2px;
  font-size: 11px;
}

.TierPage_DeckConfigPanel_Header h3 {
  margin: 0;
  color: var(--color-brown);
  font-family: var(--font-serif);
  font-size: 22px;
  line-height: 1.2;
}

.TierPage_DeckConfigPanel_Header > span {
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
}

/* 三栏配置分组：六块信息在桌面端自动排成两行。 */
.TierPage_DeckConfigPanel_Groups {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  padding-top: var(--space-sm);
}

/* 单个配置分组。 */
.TierPage_DeckConfigPanel_Group {
  min-width: 0;
  padding: 12px;
  border: 1px solid rgba(216, 192, 151, 0.58);
  background: rgba(255, 252, 245, 0.74);
}

.TierPage_DeckConfigPanel_Group h4 {
  margin: 0 0 var(--space-sm);
  color: var(--color-brown);
  font-family: var(--font-control);
  font-size: 14px;
  font-weight: 900;
}

/* Top3 列表。 */
.TierPage_DeckConfigPanel_List {
  display: grid;
  gap: var(--space-sm);
}

/* 单个配置项。 */
.TierPage_DeckConfigPanel_Item {
  display: grid;
  gap: 6px;
}

/* 配置项首行：名称和使用率。 */
.TierPage_DeckConfigPanel_ItemHead {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: var(--space-sm);
}

.TierPage_DeckConfigPanel_ItemHead strong,
.TierPage_DeckConfigPanel_MatchLink {
  overflow: hidden;
  color: var(--color-text);
  font-family: var(--font-control);
  font-size: 13px;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.TierPage_DeckConfigPanel_MatchLink {
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

.TierPage_DeckConfigPanel_MatchLink:hover {
  color: var(--color-brown);
}

.TierPage_DeckConfigPanel_ItemHead span {
  color: var(--color-brown);
  font-family: var(--font-number);
  font-size: 15px;
  font-weight: 900;
  white-space: nowrap;
}

/* 使用率条。 */
.TierPage_DeckConfigPanel_Bar {
  height: 8px;
  overflow: hidden;
  border: 1px solid rgba(216, 192, 151, 0.68);
  background: rgba(128, 95, 42, 0.1);
}

.TierPage_DeckConfigPanel_Bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--color-gold), #b98524);
}

/* 样本和低样本标签。 */
.TierPage_DeckConfigPanel_ItemMeta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  min-height: 20px;
}

.TierPage_DeckConfigPanel_ItemMeta small {
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 12px;
  font-weight: 800;
}

.TierPage_DeckConfigPanel_ItemMeta em {
  padding: 2px 6px;
  border: 1px solid rgba(128, 95, 42, 0.34);
  color: #6f654d;
  background: #eee4cc;
  font-family: var(--font-control);
  font-size: 11px;
  font-style: normal;
  font-weight: 900;
}

/* 空状态：仅说明没有自动统计数据。 */
.TierPage_DeckConfigPanel_Empty {
  margin: 0;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 13px;
  font-weight: 800;
}

@media (max-width: 760px) {
  .TierPage_DeckConfigPanel {
    padding: 12px;
  }

  .TierPage_DeckConfigPanel_Header {
    align-items: center;
  }

  .TierPage_DeckConfigPanel_Groups {
    grid-template-columns: 1fr;
  }
}
</style>
