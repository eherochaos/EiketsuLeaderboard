<script setup lang="ts">
// 静态趋势线只做轻量视觉提示，不表示真实时间序列。
const props = defineProps<{
  score: number;
}>();

// score 只影响折线高度，避免组件依赖额外接口字段。
const high = Math.max(28, Math.min(68, 28 + props.score * 0.42));
const points = `4,30 24,${72 - high} 44,24 74,${72 - Math.min(70, high + 8)}`;
</script>

<template>
  <svg class="Common_Sparkline" viewBox="0 0 78 36" aria-hidden="true">
    <polyline points="4,30 24,22 44,24 74,14" fill="none" stroke="rgba(185, 133, 36, 0.22)" stroke-width="6" stroke-linecap="round"></polyline>
    <polyline :points="points" fill="none" stroke="#a83b34" stroke-width="3" stroke-linecap="round"></polyline>
  </svg>
</template>

<style scoped>
/* 小趋势线：固定尺寸，避免表格列宽跳动。 */
.Common_Sparkline {
  width: 78px;
  height: 36px;
  display: block;
}
</style>
