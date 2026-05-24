<script setup lang="ts">
// 指标标签只展示快照派生结论，不承载人工理由。
defineProps<{
  tags: string[];
}>();
</script>

<template>
  <span class="Common_MetricTags">
    <span v-for="tag in tags" :key="tag" class="Common_MetricTags_Item">{{ tag }}</span>
  </span>
</template>

<style scoped>
/* 标签组：承载自动生成的指标依据。 */
.Common_MetricTags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

/* 单个指标标签。 */
.Common_MetricTags_Item {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 9px;
  border: 1px solid rgba(185, 133, 36, 0.55);
  color: #624718;
  background: #fff4d9;
  font-family: var(--font-control);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}
</style>
