<script setup lang="ts">
import { computed } from "vue";
import CommonDeckRail from "./Common_DeckRail.vue";
import CommonImageFrame from "./Common_ImageFrame.vue";
import { integer, percent } from "../lib/format";
import type { CardView, DeckRow } from "../types";

// 代表卡组展示完整构成和核心指标，作为首页到 TierList 的中间层。
const props = defineProps<{
  decks: DeckRow[];
}>();

const rankedDecks = computed(() => props.decks.slice().sort((left, right) => {
  const usageDiff = right.usageRate - left.usageRate;
  return usageDiff ||
    right.rankScore - left.rankScore ||
    Number(left.sourceRank || 0) - Number(right.sourceRank || 0) ||
    right.sampleSize - left.sampleSize ||
    left.deckName.localeCompare(right.deckName, "ja");
}));

// 每个卡组固定渲染 8 个槽位，数据不足时由 CommonDeckRail 负责空槽表现。
function deckSlots(deck: DeckRow): (CardView | null)[] {
  return Array.from({ length: 8 }, (_, index) => deck.deckCards[index] ?? null);
}

function deckMeta(deck: DeckRow): string {
  const parts = [];
  if (deck.categoryName && deck.categoryName !== deck.deckName) parts.push(deck.categoryName);
  parts.push(`样本 ${integer(deck.sampleSize)}`);
  return parts.join(" · ");
}
</script>

<template>
  <section id="representative-decks" class="Common_SectionBlock" aria-labelledby="decks-title">
    <div class="Common_SectionHeading">
      <p class="Common_Eyebrow">Representative Decks</p>
      <h2 id="decks-title">代表卡组</h2>
      <a href="/tier-list/">完整榜单</a>
    </div>
    <div class="Main_RepresentativeDecks_Section_List">
      <article v-for="(deck, index) in rankedDecks" :key="deck.deckId" class="Main_RepresentativeDecks_Section_Card">
        <div class="Main_RepresentativeDecks_Section_Rank">#{{ index + 1 }}</div>
        <div class="Main_RepresentativeDecks_Section_RailBlock">
          <div class="Main_RepresentativeDecks_Section_Summary">
              <span class="Common_FactionPill" :data-faction="deck.faction">{{ deck.faction }}</span>
              <h3>{{ deck.deckName }}</h3>
          </div>
          <!-- <span>卡组构成</span> -->
          <CommonDeckRail :cards="deckSlots(deck)" />
        </div>
        <div class="Main_RepresentativeDecks_Section_Stats">
          <div>
            <span>胜率</span>
            <strong>{{ percent(deck.winRate) }}</strong>
          </div>
          <div>
            <span>使用率</span>
            <strong>{{ percent(deck.usageRate) }}</strong>
          </div>
          <a class="Common_ButtonSecondary" href="/tier-list/">查看构筑</a>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
/* 代表卡组列表：多条卡组情报纵向排列。 */
.Main_RepresentativeDecks_Section_List {
  display: grid;
  gap: 14px;
}

/* 单条卡组情报：排名、构成、指标三栏。 */
.Main_RepresentativeDecks_Section_Card {
  min-height: 148px;
  display: grid;
  grid-template-columns: 50px minmax(0, 1fr) 178px;
  align-items: center;
  gap: var(--space-md);
  padding: 16px 18px;
  border: 1px solid rgba(216, 192, 151, 0.82);
  background: rgba(255, 250, 240, 0.78);
}

/* 卡组排名数字。 */
.Main_RepresentativeDecks_Section_Rank {
  color: var(--color-gold);
  font-family: var(--font-number);
  font-size: 24px;
  font-weight: 900;
  white-space: nowrap;
}

/* 卡组摘要区：预留主卡和文字信息。 */
.Main_RepresentativeDecks_Section_Summary {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  gap: var(--space-md);
  align-items: center;
  min-width: 0;
}

/* 卡组摘要中的主卡尺寸。 */
.Main_RepresentativeDecks_Section_Summary :deep(.Common_ImageFrame) {
  width: 82px;
  height: auto;
}

/* 卡组名称，最多两行。 */
.Main_RepresentativeDecks_Section_Summary h3 {
  margin-bottom: var(--space-xs);
  color: var(--color-brown);
  font-family: var(--font-serif);
  font-size: var(--card-title-size);
  line-height: 1.25;
  letter-spacing: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 卡组辅助信息。 */
.Main_RepresentativeDecks_Section_Summary p {
  margin-bottom: var(--space-sm);
  color: var(--color-muted);
  font-size: 14px;
}

/* 卡组构成区：放置 8 卡 rail。 */
.Main_RepresentativeDecks_Section_RailBlock {
  display: grid;
  align-content: center;
  justify-items: start;
  min-width: 0;
}

/* 卡组构成标签。 */
.Main_RepresentativeDecks_Section_RailBlock > span {
  display: block;
  margin-bottom: var(--space-xs);
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: var(--font-size-sm);
  font-weight: 800;
}

/* 右侧指标区：胜率、使用率和查看按钮。 */
.Main_RepresentativeDecks_Section_Stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  align-content: center;
  justify-items: stretch;
  width: 178px;
}

/* 单个指标格。 */
.Main_RepresentativeDecks_Section_Stats div {
  min-height: 48px;
  padding: 8px 10px;
  text-align: center;
  border: 1px solid rgba(216, 192, 151, 0.82);
  background: rgba(255, 248, 235, 0.72);
}

/* 指标名称。 */
.Main_RepresentativeDecks_Section_Stats span {
  display: block;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: var(--font-size-sm);
  font-weight: 700;
}

/* 指标数字。 */
.Main_RepresentativeDecks_Section_Stats strong {
  display: block;
  color: var(--color-brown);
  font-family: var(--font-number);
  font-size: var(--font-size-lg);
  line-height: 1.15;
  white-space: nowrap;
}

/* 查看构筑按钮独占一整行。 */
.Main_RepresentativeDecks_Section_Stats .Common_ButtonSecondary {
  grid-column: 1 / -1;
  min-height: 38px;
  width: 100%;
}

/* 平板端：指标和构成跟随主内容列换行。 */
@media (max-width: 1099px) {
  /* 卡组卡片从三栏改为两栏。 */
  .Main_RepresentativeDecks_Section_Card {
    grid-template-columns: 56px minmax(0, 1fr);
  }

  /* 构成和指标占据内容列整行。 */
  .Main_RepresentativeDecks_Section_RailBlock,
  .Main_RepresentativeDecks_Section_Stats {
    grid-column: 2 / -1;
  }

  /* 平板指标区铺满内容列。 */
  .Main_RepresentativeDecks_Section_Stats {
    width: 100%;
  }
}

/* 手机端：卡组情报纵向堆叠。 */
@media (max-width: 760px) {
  /* 手机卡片取消固定高度。 */
  .Main_RepresentativeDecks_Section_Card {
    min-height: 0;
    grid-template-columns: 44px minmax(0, 1fr);
    gap: 14px;
    padding: 14px;
  }

  /* 手机摘要区缩小主卡列。 */
  .Main_RepresentativeDecks_Section_Summary {
    grid-template-columns: 62px minmax(0, 1fr);
  }

  /* 手机摘要主卡尺寸。 */
  .Main_RepresentativeDecks_Section_Summary :deep(.Common_ImageFrame) {
    width: 62px;
    height: auto;
  }

  /* 手机构成和指标铺满整张卡。 */
  .Main_RepresentativeDecks_Section_RailBlock,
  .Main_RepresentativeDecks_Section_Stats {
    grid-column: 1 / -1;
  }

  /* 手机指标仍保持两列。 */
  .Main_RepresentativeDecks_Section_Stats {
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
