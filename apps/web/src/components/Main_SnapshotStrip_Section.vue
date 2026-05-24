<script setup lang="ts">
import { dateOnly } from "../lib/format";
import type { LeaderboardSnapshot } from "../types";

// 快照范围是静态说明，不是可交互筛选器。
defineProps<{
  metadata: LeaderboardSnapshot["metadata"];
}>();
</script>

<template>
  <section class="Main_SnapshotStrip_Section" aria-label="快照范围">
    <div class="Main_SnapshotStrip_Section_Meta">
      <span>全部势力</span>
      <span>全部段位</span>
      <span>{{ dateOnly(metadata.dateFrom) }} - {{ dateOnly(metadata.dateTo) }}</span>
    </div>
  </section>
</template>

<style scoped>
/* 快照信息条：展示数据范围，不做交互。 */
.Main_SnapshotStrip_Section {
  margin-top: var(--section-gap);
  min-height: 58px;
  padding: 12px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

/* 快照内容：桌面端靠右排列。 */
.Main_SnapshotStrip_Section_Meta {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

/* 快照文本。 */
.Main_SnapshotStrip_Section_Meta span {
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 14px;
  font-weight: 800;
}

/* 手机端：快照信息改为纵向工具条。 */
@media (max-width: 760px) {
  /* 手机外层纵向排列。 */
  .Main_SnapshotStrip_Section {
    align-items: stretch;
    flex-direction: column;
    gap: var(--space-sm);
    padding: 14px var(--space-md);
  }

  /* 手机内容从左开始换行。 */
  .Main_SnapshotStrip_Section_Meta {
    align-items: stretch;
    justify-content: flex-start;
  }

  /* 手机单项增加浅色边框，便于扫读。 */
  .Main_SnapshotStrip_Section_Meta span {
    padding: 7px 10px;
    border: 1px solid rgba(216, 192, 151, 0.62);
    background: rgba(255, 248, 235, 0.52);
  }
}
</style>
