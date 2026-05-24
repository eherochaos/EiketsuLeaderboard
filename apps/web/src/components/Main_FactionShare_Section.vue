<script setup lang="ts">
import type { FactionShare } from "../types";

// 势力占比只展示快照聚合结果；颜色和占比均来自构建产物。
defineProps<{
  factionShare: FactionShare[];
  topShareTotal: number;
  shareNote: string;
}>();

// CSS 宽度直接使用百分比，保持堆叠条和数据一致。
function shareWidth(share: number): string {
  return `${Math.max(0, share)}%`;
}
</script>

<template>
  <section id="faction-share" class="Common_SectionBlock Main_FactionShare_Section" aria-labelledby="share-title">
    <div class="Common_SectionHeading">
      <p class="Common_Eyebrow">Faction Share</p>
      <h2 id="share-title">势力占比</h2>
      <span>Top3 {{ topShareTotal }}%</span>
    </div>
    <p class="Common_SectionNote">{{ shareNote }}</p>
    <div class="Main_FactionShare_Section_Chart" aria-label="势力占比横向堆叠条">
      <div class="Main_FactionShare_Section_Bar">
        <div
          v-for="item in factionShare"
          :key="item.faction"
          class="Main_FactionShare_Section_Segment"
          :style="{ width: shareWidth(item.share), backgroundColor: item.color }"
        >
          <span>{{ item.share < 6 ? item.faction : `${item.faction} ${item.share}%` }}</span>
        </div>
      </div>
    </div>
    <div class="Main_FactionShare_Section_Legends" aria-label="势力代表条目">
      <div v-for="item in factionShare" :key="`${item.faction}-legend`" class="Main_FactionShare_Section_LegendRow">
        <span class="Main_FactionShare_Section_LegendMark" :style="{ backgroundColor: item.color }"></span>
        <strong>{{ item.faction }}</strong>
        <span>{{ item.share }}%</span>
        <p>{{ item.representatives.join(" / ") }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 堆叠图外层：保留为块级容器。 */
.Main_FactionShare_Section_Chart {
  display: block;
}

/* 横向堆叠条：各势力按占比占宽。 */
.Main_FactionShare_Section_Bar {
  height: 74px;
  display: flex;
  overflow: hidden;
  border: 1px solid var(--color-border);
  background: #efe2ca;
}

/* 单个势力分段：居中显示势力和百分比。 */
.Main_FactionShare_Section_Segment {
  min-width: 0;
  display: grid;
  place-items: center;
  border-right: 1px solid rgba(255, 252, 244, 0.8);
  color: #fffaf0;
  font-family: var(--font-control);
  font-size: 15px;
  font-weight: 900;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.34);
}

/* 最后一段不需要右分割线。 */
.Main_FactionShare_Section_Segment:last-child {
  border-right: 0;
}

/* 图例列表：解释每个势力的占比和代表条目。 */
.Main_FactionShare_Section_Legends {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 28px;
  border-top: 1px solid rgba(216, 192, 151, 0.72);
}

/* 单条图例：色标、势力、百分比和代表卡组。 */
.Main_FactionShare_Section_LegendRow {
  min-width: 0;
  display: grid;
  grid-template-columns: 10px 24px 46px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  min-height: 42px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(216, 192, 151, 0.56);
}

/* 图例色标。 */
.Main_FactionShare_Section_LegendMark {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

/* 图例势力名。 */
.Main_FactionShare_Section_LegendRow strong {
  color: var(--color-brown);
  font-family: var(--font-serif);
  font-size: 17px;
  line-height: 1.1;
}

/* 图例百分比。 */
.Main_FactionShare_Section_LegendRow > span:not(.Main_FactionShare_Section_LegendMark) {
  color: var(--color-brown);
  font-family: var(--font-number);
  font-size: 15px;
  font-weight: 900;
  white-space: nowrap;
}

/* 图例代表条目，限制两行。 */
.Main_FactionShare_Section_LegendRow p {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--font-size-sm);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 手机端：堆叠条变矮，图例改一列。 */
@media (max-width: 760px) {
  /* 手机堆叠条高度。 */
  .Main_FactionShare_Section_Bar {
    height: 64px;
  }

  /* 手机分段文字更小。 */
  .Main_FactionShare_Section_Segment {
    font-size: 12px;
  }

  /* 手机分段文字防溢出。 */
  .Main_FactionShare_Section_Segment span {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-align: center;
    line-height: 1.2;
  }

  /* 手机图例改为单列。 */
  .Main_FactionShare_Section_Legends {
    grid-template-columns: 1fr;
    column-gap: 0;
  }
}
</style>
