<script setup lang="ts">
import { ref, watch } from "vue";

// 统一外链卡图容器；图片失败时显示文本，避免页面出现破图。
const props = withDefaults(defineProps<{
  src?: string;
  alt: string;
  ratio?: "square" | "portrait";
}>(), {
  src: "",
  ratio: "square"
});

const failed = ref(false);

// 同一组件可能复用为不同卡图，src 变化时需要重新尝试加载。
watch(() => props.src, () => {
  failed.value = false;
});
</script>

<template>
  <span class="Common_ImageFrame" :class="`Common_ImageFrame_${ratio}`" :data-label="alt">
    <img v-if="src && !failed" :src="src" :alt="alt" loading="lazy" @error="failed = true">
    <span v-else class="Common_ImageFrame_Fallback">{{ alt }}</span>
  </span>
</template>

<style scoped>
/* 图片框：统一卡图和头像的外链展示容器。 */
.Common_ImageFrame {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  overflow: hidden;
  border: 1px solid rgba(101, 71, 49, 0.8);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.08), transparent 42%),
    #241913;
  color: #f3e3bf;
  font-family: var(--font-content);
  font-size: 12px;
  font-weight: 800;
  text-align: center;
  box-shadow: inset 0 0 0 1px rgba(255, 248, 235, 0.08);
}

/* 竖卡比例：用于英杰卡图。 */
.Common_ImageFrame.Common_ImageFrame_portrait {
  aspect-ratio: 5 / 8;
  height: auto;
}

/* 正常图片：填满容器。 */
.Common_ImageFrame img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

/* 竖卡图片：完整显示，不裁切卡面。 */
.Common_ImageFrame.Common_ImageFrame_portrait img {
  object-fit: contain;
  background: #1f1611;
}

/* 图片失败态：显示文本名，避免破图。 */
.Common_ImageFrame_Fallback {
  width: 100%;
  max-height: 100%;
  padding: var(--space-xs);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.24;
}
</style>
