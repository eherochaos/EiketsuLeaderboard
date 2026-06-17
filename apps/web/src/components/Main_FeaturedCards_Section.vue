<script setup lang="ts">
import CommonImageFrame from "./Common_ImageFrame.vue";
import CommonMetricTags from "./Common_MetricTags.vue";
import { integer, percent } from "../lib/format";
import type { FeaturedCard } from "../types";

// 注目单卡来自高使用率卡组核心卡，桌面按单行表格扫描。
defineProps<{
  cards: FeaturedCard[];
}>();
</script>

<template>
  <section id="featured-cards" class="Common_SectionBlock" aria-labelledby="cards-title">
    <div class="Common_SectionHeading">
      <p class="Common_Eyebrow">Featured Cards</p>
      <h2 id="cards-title">注目单卡</h2>
    </div>
    <table class="Common_TableLayout Main_FeaturedCards_Section_Table">
      <colgroup>
        <col class="Common_TableColumn Common_TableColumn_Fixed" style="--Common_TableColumnWidth: var(--Main_FeaturedCards_Section_RankColumn)">
        <col class="Common_TableColumn Common_TableColumn_Flex" style="--Common_TableColumnRatio: var(--Main_FeaturedCards_Section_MainColumnRatio)">
        <col class="Common_TableColumn Common_TableColumn_Fixed" style="--Common_TableColumnWidth: var(--Main_FeaturedCards_Section_ImageColumn)">
        <col class="Common_TableColumn Common_TableColumn_Fixed" style="--Common_TableColumnWidth: var(--Main_FeaturedCards_Section_MetricColumn)">
        <col class="Common_TableColumn Common_TableColumn_Fixed" style="--Common_TableColumnWidth: var(--Main_FeaturedCards_Section_MetricColumn)">
        <col class="Common_TableColumn Common_TableColumn_Fixed" style="--Common_TableColumnWidth: var(--Main_FeaturedCards_Section_MetricColumn)">
        <col class="Common_TableColumn Common_TableColumn_Flex" style="--Common_TableColumnRatio: var(--Main_FeaturedCards_Section_EvidenceColumnRatio)">
      </colgroup>
      <thead>
        <tr>
          <th>Rank</th>
          <th>卡名</th>
          <th>卡图</th>
          <th>使用率</th>
          <th>胜率</th>
          <th>样本</th>
          <th>指标依据</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(card, index) in cards" :key="card.cardId">
          <td class="Main_FeaturedCards_Section_Rank">#{{ index + 1 }}</td>
          <td class="Main_FeaturedCards_Section_CardMain">
            <span class="Main_FeaturedCards_Section_CardMainInner">
              <span class="Common_FactionPill">{{ card.faction }}</span>
              <h3>{{ card.name }}</h3>
            </span>
          </td>
          <td>
            <CommonImageFrame :src="card.imageUrl" :alt="card.imageAlt" :card="card" show-details density="full" ratio="portrait" />
          </td>
          <td class="Common_MetricNumber">{{ percent(card.usageRate) }}</td>
          <td class="Common_MetricNumber">{{ percent(card.winRate) }}</td>
          <td class="Common_MetricNumber">{{ integer(card.sampleSize) }}</td>
          <td><CommonMetricTags :tags="card.evidenceTags" /></td>
        </tr>
      </tbody>
    </table>

    <div class="Common_MobileCardList Main_FeaturedCards_Section_MobileList">
      <article v-for="(card, index) in cards" :key="`${card.cardId}-mobile`" class="Main_FeaturedCards_Section_MobileRow">
        <div class="Main_FeaturedCards_Section_Rank">#{{ index + 1 }}</div>
        <CommonImageFrame :src="card.imageUrl" :alt="card.imageAlt" :card="card" show-details density="full" ratio="portrait" />
        <div class="Main_FeaturedCards_Section_CardMain">
          <span class="Main_FeaturedCards_Section_CardMainInner">
            <span class="Common_FactionPill">{{ card.faction }}</span>
            <h3>{{ card.name }}</h3>
          </span>
        </div>
        <div class="Main_FeaturedCards_Section_InlineMetrics">
          <span><b>{{ percent(card.usageRate) }}</b>使用</span>
          <span><b>{{ percent(card.winRate) }}</b>胜率</span>
          <span><b>{{ integer(card.sampleSize) }}</b>样本</span>
        </div>
        <CommonMetricTags :tags="card.evidenceTags" />
      </article>
    </div>
  </section>
</template>

<style scoped>
/* 注目单卡排名数字。 */
.Main_FeaturedCards_Section_Rank {
  color: var(--color-gold);
  font-family: var(--font-number);
  font-size: 24px;
  font-weight: 900;
  white-space: nowrap;
}

/* 单卡主信息区：放势力和卡名。 */
.Main_FeaturedCards_Section_CardMain {
  min-width: 0;
}

/* 单卡主信息内部平铺：不改变 td 的 table-cell 对齐。 */
.Main_FeaturedCards_Section_CardMainInner {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}

/* 平铺时取消势力标签底部外边距，避免视觉上偏上。 */
.Main_FeaturedCards_Section_CardMainInner .Common_FactionPill {
  flex: 0 0 auto;
  margin-bottom: 0;
}

/* 桌面表格固定列宽，保证一行读完。 */
.Main_FeaturedCards_Section_Table {
  --Common_TableFixedWidth: calc(var(--Main_FeaturedCards_Section_RankColumn) + var(--Main_FeaturedCards_Section_ImageColumn) + var(--Main_FeaturedCards_Section_MetricColumn) * 3);
  --Common_TableFlexTotal: 2;
  --Main_FeaturedCards_Section_RankColumn: 72px;
  --Main_FeaturedCards_Section_MainColumnRatio: 1;
  --Main_FeaturedCards_Section_ImageColumn: 72px;
  --Main_FeaturedCards_Section_MetricColumn: 96px;
  --Main_FeaturedCards_Section_EvidenceColumnRatio: 1;
}

/* 表格卡图尺寸。 */
.Main_FeaturedCards_Section_Table :deep(.Common_ImageFrame) {
  width: 48px;
  height: auto;
}

/* 表格单元格更紧凑。 */
.Main_FeaturedCards_Section_Table th,
.Main_FeaturedCards_Section_Table td {
  padding: 8px 10px;
}

/* 表格行高。 */
.Main_FeaturedCards_Section_Table tbody tr {
  height: 64px;
}

/* 单卡名称，最多两行。 */
.Main_FeaturedCards_Section_CardMain h3,
.Main_FeaturedCards_Section_MobileRow h3 {
  margin: 0;
  color: var(--color-brown);
  font-family: var(--font-serif);
  font-size: 19px;
  line-height: 1.25;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  min-width: 0;
}

/* 单卡辅助文本。 */
.Main_FeaturedCards_Section_CardMain p,
.Main_FeaturedCards_Section_MobileRow p {
  margin-bottom: 0;
  color: var(--color-muted);
  font-size: 14px;
  display: grid;
  white-space: nowrap;
}

/* 移动端单卡列表默认隐藏。 */
.Main_FeaturedCards_Section_MobileList {
  display: none;
}

/* 移动端单卡行：排名、卡图、名称三列起步。 */
.Main_FeaturedCards_Section_MobileRow {
  display: grid;
  grid-template-columns: 42px 54px minmax(0, 1fr);
  gap: 10px 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid rgba(216, 192, 151, 0.82);
  background: rgba(255, 250, 240, 0.76);
}

/* 移动端卡图尺寸。 */
.Main_FeaturedCards_Section_MobileRow :deep(.Common_ImageFrame) {
  width: 54px;
  height: auto;
}

/* 移动端指标和标签从第三列开始对齐。 */
.Main_FeaturedCards_Section_MobileRow :deep(.Common_MetricTags),
.Main_FeaturedCards_Section_InlineMetrics {
  grid-column: 1 / -1;
}

/* 移动端内联指标。 */
.Main_FeaturedCards_Section_InlineMetrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: var(--font-size-sm);
  font-weight: 800;
}

.Main_FeaturedCards_Section_InlineMetrics span {
  min-width: 0;
  padding: 8px;
  overflow: hidden;
  border: 1px solid rgba(216, 192, 151, 0.82);
  background: rgba(255, 248, 235, 0.72);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.Main_FeaturedCards_Section_InlineMetrics b {
  display: block;
  color: var(--color-brown);
  font-family: var(--font-number);
  font-size: 16px;
  line-height: 1.15;
}

/* 手机端：隐藏桌面表格，显示卡片列表。 */
@media (max-width: 760px) {
  /* 手机隐藏桌面表格。 */
  .Main_FeaturedCards_Section_Table {
    display: none;
  }

  /* 手机显示单卡行块。 */
  .Main_FeaturedCards_Section_MobileList {
    display: grid;
    gap: 12px;
  }

  .Main_FeaturedCards_Section_MobileRow h3 {
    font-size: 16px;
  }
}
</style>
