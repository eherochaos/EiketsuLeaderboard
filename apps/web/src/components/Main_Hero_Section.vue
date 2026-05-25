<script setup lang="ts">
import CommonImageFrame from "./Common_ImageFrame.vue";
import CommonMetricTags from "./Common_MetricTags.vue";
import { dateOnly, dateTime, integer, percent, topFactionSummary } from "../lib/format";
import type { FactionShare, LeaderboardSnapshot, DeckRow } from "../types";

// 首页首屏负责快速给出环境结论、当前第一和 2~4 名入口信息。
defineProps<{
  metadata: LeaderboardSnapshot["metadata"];
  summary: string;
  factionShare: FactionShare[];
  topDeck: DeckRow | null;
  top4Decks: DeckRow[];
}>();

function deckMeta(deck: DeckRow): string {
  const parts = [];
  if (deck.categoryName && deck.categoryName !== deck.deckName) parts.push(deck.categoryName);
  parts.push(`样本 ${integer(deck.sampleSize)}`);
  return parts.join(" · ");
}
</script>

<template>
  <!-- 首屏只保留读榜决策信息，不承载筛选或验收状态。 -->
  <section class="Main_Hero_Section" aria-labelledby="home-title">
    <div class="Main_Hero_Section_Copy">
      <p class="Common_Eyebrow">环境数据速递</p>
      <h1 id="home-title">英杰大战榜单<br><span>{{ dateOnly(metadata.dateTo) }}</span></h1>
      <p class="Main_Hero_Section_Lead">{{ summary }}</p>
      <div class="Main_Hero_Section_Facts">
        <div>
          <span>更新时间</span>
          <strong>{{ dateTime(metadata.updatedAt) }}</strong>
        </div>
        <div>
          <span>{{ metadata.targetVersion ? "数据版本" : "主导势力" }}</span>
          <strong>{{ metadata.targetVersion || topFactionSummary(factionShare) }}</strong>
        </div>
      </div>
      <div class="Main_Hero_Section_Actions">
        <a class="Common_ButtonPrimary" href="/tier-list/">查看 TierList →</a>
        <nav class="Main_Hero_Section_SoftLinks" aria-label="页面目录">
          <a href="#featured-cards">注目单卡</a>
          <a href="#representative-decks">代表卡组</a>
          <a href="#faction-share">势力占比</a>
        </nav>
      </div>
    </div>

    <aside v-if="topDeck" class="Main_Hero_Section_Rank" aria-label="No.1">
      <div class="Main_Hero_Section_RankCard">
        <CommonImageFrame :src="topDeck.imageUrl" :alt="topDeck.imageAlt" ratio="portrait" />
        <div class="Main_Hero_Section_RankCardBody">
          <span class="Main_Hero_Section_RankKicker">No.1</span>
          <h2>{{ topDeck.deckName }}</h2>
          <p>{{ deckMeta(topDeck) }}</p>
          <CommonMetricTags :tags="topDeck.evidenceTags" />
        </div>
      </div>
      <div class="Main_Hero_Section_Metrics">
        <div>
          <span>综合 Rank</span>
          <strong>{{ topDeck.rankScore }}</strong>
        </div>
        <div>
          <span>胜率</span>
          <strong>{{ percent(topDeck.winRate) }}</strong>
        </div>
        <div>
          <span>使用率</span>
          <strong>{{ percent(topDeck.usageRate) }}</strong>
        </div>
      </div>
      <div class="Main_Hero_Section_Top3List">
        <article v-for="(deck, index) in top4Decks.slice(1, 4)" :key="deck.deckId" class="Main_Hero_Section_Top3Row">
          <span class="Main_Hero_Section_Top3Rank">No.{{ index + 2 }}</span>
          <CommonImageFrame :src="deck.imageUrl" :alt="deck.imageAlt" ratio="portrait" />
          <div>
            <h3>{{ deck.deckName }}</h3>
            <div class="Main_Hero_Section_Metrics">
              <div>
                <span>胜率</span>
                <span> {{  percent(deck.winRate) }}</span>
              </div>
              <div>
                <span>使用率 </span>
                <span> {{  percent(deck.usageRate) }}</span>
              </div>
            </div>
          </div>
        </article>
      </div>
    </aside>
  </section>
</template>

<style scoped>
/* Hero 外层：桌面左右两栏，左侧结论，右侧当前第一。 */
.Main_Hero_Section {
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 480px;
  gap: var(--space-lg);
  padding: 28px 34px;
  overflow: hidden;
  position: relative;
}

/* Hero 背景装饰：低对比纸感和山水感，不承载信息。 */
.Main_Hero_Section::before {
  content: "";
  position: absolute;
  left: -8%;
  bottom: -30%;
  width: 58%;
  height: 72%;
  background:
    radial-gradient(ellipse at 25% 70%, rgba(75, 71, 66, 0.14), transparent 50%),
    linear-gradient(145deg, transparent 0 26%, rgba(70, 60, 48, 0.08) 26% 42%, transparent 42% 100%);
  pointer-events: none;
}

/* Hero 内容层：抬到背景装饰之上。 */
.Main_Hero_Section_Copy,
.Main_Hero_Section_Rank {
  position: relative;
}

/* Hero 摘要：限制宽度，避免文字拉得太长。 */
.Main_Hero_Section_Lead {
  max-width: 620px;
  margin-bottom: 22px;
  color: var(--color-brown-soft);
  font-size: 17px;
}

/* Hero 信息卡：展示更新时间和版本/主导势力。 */
.Main_Hero_Section_Facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: var(--space-lg);
}

/* Hero 指标小面板：统一浅色底和细边框。 */
.Main_Hero_Section_Facts div,
.Main_Hero_Section_Metrics div {
  border: 1px solid rgba(216, 192, 151, 0.82);
  background: rgba(255, 248, 235, 0.72);
}

/* Hero 信息卡的内部留白和高度。 */
.Main_Hero_Section_Facts div {
  min-height: 82px;
  padding: 14px;
}

/* Hero 指标标签文字。 */
.Main_Hero_Section_Facts span,
.Main_Hero_Section_Metrics span {
  display: block;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: var(--font-size-sm);
  font-weight: 700;
}

/* Hero 信息卡主值。 */
.Main_Hero_Section_Facts strong {
  display: block;
  margin-top: 8px;
  color: var(--color-brown);
  font-size: 18px;
  font-weight: 800;
}

/* Hero 行动区：主按钮和页内目录同排。 */
.Main_Hero_Section_Actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-md);
}

/* Hero 页内目录：弱化为文字链接。 */
.Main_Hero_Section_SoftLinks {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 14px;
}

/* Hero 目录链接下划线。 */
.Main_Hero_Section_SoftLinks a {
  border-bottom: 1px solid rgba(117, 106, 91, 0.38);
}

/* 右侧榜首区域：当前第一、指标和 2~4 名纵向排列。 */
.Main_Hero_Section_Rank {
  display: grid;
  gap: var(--space-md);
  align-content: start;
}

/* 当前第一卡片：头像和卡组信息两列。 */
.Main_Hero_Section_RankCard {
  padding: 14px;
  display: grid;
  grid-template-columns: 76px 1fr;
  gap: var(--space-md);
  background: var(--color-panel-strong);
  border: 1px solid var(--color-border);
}

/* 当前第一头像尺寸。 */
.Main_Hero_Section_RankCard :deep(.Common_ImageFrame) {
  width: 76px;
  height: auto;
}

/* No.1 标记。 */
.Main_Hero_Section_RankKicker {
  display: inline-flex;
  margin-bottom: var(--space-xs);
  padding: 2px 8px;
  color: #fff7e7;
  background: var(--color-brown);
  font-family: var(--font-control);
  font-size: 12px;
  font-weight: 800;
}

/* 当前第一和 2~4 名的卡组名。 */
.Main_Hero_Section_RankCardBody h2,
.Main_Hero_Section_Top3Row h3 {
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

/* 当前第一和 2~4 名的辅助说明。 */
.Main_Hero_Section_RankCardBody p,
.Main_Hero_Section_Top3Row p {
  margin-bottom: var(--space-sm);
  color: var(--color-muted);
  font-size: 14px;
}

/* 当前第一三项核心指标。 */
.Main_Hero_Section_Metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-sm);
}

/* Hero 指标格内边距。 */
.Main_Hero_Section_Metrics div {
  padding: 10px 12px;
}

/* Hero 指标数字。 */
.Main_Hero_Section_Metrics strong {
  display: block;
  color: var(--color-brown);
  font-family: var(--font-number);
  font-size: var(--font-size-lg);
  line-height: 1.15;
  white-space: nowrap;
}

/* 2~4 名列表容器。 */
.Main_Hero_Section_Top3List {
  display: grid;
  gap: var(--space-sm);
}

/* 2~4 名单行：排名、头像、卡组信息。 */
.Main_Hero_Section_Top3Row {
  display: grid;
  /*  三列分别是：排名数字、卡图、卡组文字。
    1fr 表示文字列吃掉剩余空间。*/
  grid-template-columns: 42px 64px 1fr;
  gap: var(--space-sm);
  align-items: center;
  padding: 8px 10px;
  border-top: 1px solid rgba(216, 192, 151, 0.72);
  background: rgba(255, 248, 235, 0.44);
}

/* 2~4 名头像尺寸。 */
/*.Main_Hero_Section_Top3Row :deep(.Common_ImageFrame) {
  width: 42px;
  height: auto;
}*/

/* 2~4 名排名数字。 */
.Main_Hero_Section_Top3Rank {
  color: var(--color-gold);
  font-family: var(--font-number);
  font-size: 24px;
  font-weight: 900;
  white-space: nowrap;
}

/* 平板端：Hero 改为单列，右侧信息内部再分栏。 */
@media (max-width: 1099px) {
  /* Hero 主网格收成一列。 */
  .Main_Hero_Section {
    grid-template-columns: 1fr;
    min-height: 0;
    padding: 28px;
  }

  /* 榜首卡和指标区域在平板横向分布。 */
  .Main_Hero_Section_Rank {
    grid-template-columns: 1fr 1fr;
    align-items: start;
  }

  /* 2~4 名横向三列展示。 */
  .Main_Hero_Section_Top3List {
    grid-column: 1 / -1;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  /* 2~4 名行在平板下略收窄排名列。 */
  .Main_Hero_Section_Top3Row {
    grid-template-columns: 36px 42px 1fr;
  }
}

/* 手机端：Hero 所有信息纵向堆叠。 */
@media (max-width: 760px) {
  /* 手机 Hero 间距。 */
  .Main_Hero_Section {
    gap: 12px;
    padding: 20px 28px;
  }

  /* 手机摘要字号略小。 */
  .Main_Hero_Section_Lead {
    margin-bottom: 16px;
    font-size: 15px;
  }

  .Main_Hero_Section_Facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 16px;
  }

  .Main_Hero_Section_Facts div {
    min-height: 64px;
    padding: 10px;
  }

  /* 手机端排名区域纵向堆叠。 */
  .Main_Hero_Section_Rank,
  .Main_Hero_Section_Top3List {
    grid-template-columns: 1fr;
  }

  .Main_Hero_Section_Metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .Main_Hero_Section_Metrics div {
    padding: 8px;
  }

  /* 手机当前第一卡片：头像更窄。 */
  .Main_Hero_Section_RankCard {
    grid-template-columns: 58px 1fr;
    gap: 12px;
    padding: 10px;
  }

  /* 手机当前第一头像尺寸。 */
  .Main_Hero_Section_RankCard :deep(.Common_ImageFrame) {
    width: 58px;
    height: auto;
  }

  /* 手机 2~4 名行列宽。 */
  .Main_Hero_Section_Top3Row {
    grid-template-columns: 36px 42px 1fr;
  }
}
</style>
