<script setup lang="ts">
import CommonImageFrame from "./Common_ImageFrame.vue";
import type { CardView } from "../types";

// 统一 8 卡构成槽位；空槽只保留视觉占位，不显示文字。
withDefaults(defineProps<{
  cards: (CardView | null)[];
  railClass?: string;
  showCardDetails?: boolean;
  showCardOverlays?: boolean;
  cardDensity?: "mini" | "compact" | "full";
}>(), {
  railClass: "Common_DeckRail",
  showCardDetails: true,
  showCardOverlays: false,
  cardDensity: "compact"
});
</script>

<template>
  <div :class="railClass">
    <template v-for="(card, cardIndex) in cards" :key="card?.cardId || `empty-${cardIndex}`">
      <CommonImageFrame
        v-if="card"
        :src="card.imageUrl"
        :alt="card.imageAlt"
        :card="card"
        :show-details="showCardDetails"
        :show-overlays="showCardOverlays"
        :density="cardDensity"
        ratio="portrait"
      />
      <span v-else class="Common_DeckRail_EmptySlot" aria-label="空卡位"></span>
    </template>
  </div>
</template>

<style scoped>
/* 卡组构成轨道：桌面端按 8 个卡槽横向排列。 */
.Common_DeckRail,
.Common_DeckRail_Mini {
  --Common_DeckRail_SlotHeight: 82px;
  --Common_DeckRail_SlotWidth: calc(var(--Common_DeckRail_SlotHeight) * 5 / 8);

  display: grid;
  grid-template-columns: repeat(8, var(--Common_DeckRail_SlotWidth));
  grid-auto-rows: var(--Common_DeckRail_SlotHeight);
  gap: 5px;
  box-sizing: border-box;
  width: max-content;
  max-width: 100%;
  padding: 7px;
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid #654731;
  background: #211711;
}

/* 首页代表卡组使用的完整轨道宽度。 */
.Common_DeckRail {
  --Common_DeckRail_SlotHeight: 100px;
}

/* TierList 表格中使用的紧凑轨道宽度。 */
.Common_DeckRail_Mini {
  --Common_DeckRail_SlotHeight: 70px;

  gap: 5px;
  max-width: none;
  padding: 6px;
  overflow-x: hidden;
}

/* 卡槽内的卡图和空槽共用竖卡比例。 */
.Common_DeckRail :deep(.Common_ImageFrame),
.Common_DeckRail .Common_DeckRail_EmptySlot,
.Common_DeckRail_Mini :deep(.Common_ImageFrame),
.Common_DeckRail_Mini .Common_DeckRail_EmptySlot {
  width: 100%;
  height: 100%;
  aspect-ratio: auto;
}

/* 竖卡图跟随卡槽高度，不再被父级宽度轻易压缩。 */
.Common_DeckRail :deep(.Common_ImageFrame.Common_ImageFrame_portrait),
.Common_DeckRail_Mini :deep(.Common_ImageFrame.Common_ImageFrame_portrait) {
  height: 100%;
  aspect-ratio: auto;
}

/* 空槽：只保留占位框，不显示文字内容。 */
.Common_DeckRail_EmptySlot {
  display: grid;
  place-items: center;
  border: 1px dashed rgba(243, 227, 191, 0.34);
  color: rgba(243, 227, 191, 0.64);
  background: rgba(0, 0, 0, 0.16);
  font-family: var(--font-control);
  font-size: 11px;
  font-weight: 800;
}

/* 手机端：8 卡改为 4x2。 */
@media (max-width: 760px) {
  .Common_DeckRail,
  .Common_DeckRail_Mobile {
    grid-template-columns: repeat(4, var(--Common_DeckRail_SlotWidth));
  }
}

@media (max-width: 430px) {
  .Common_DeckRail_TierCompact {
    --Common_DeckRail_SlotHeight: 51px;

    width: 100%;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    grid-auto-rows: var(--Common_DeckRail_SlotHeight);
    gap: 3px;
    padding: 4px;
    overflow: hidden;
  }
}
</style>
