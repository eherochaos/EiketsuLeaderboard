<script setup lang="ts">
// 顶部只承担页面切换和品牌识别；具体页面入口不在这里扩展。
defineProps<{
  current: "home" | "tier";
}>();
</script>

<template>
  <header class="Common_Header">
    <nav class="Common_Header_Nav" aria-label="主要导航">
      <a class="Common_Header_Brand" href="/leaderboard/">
        <span class="Common_Header_BrandSymbol" aria-hidden="true"></span>
        <span>Eiketsu Leaderboard</span>
      </a>
      <a v-if="current === 'home'" class="Common_NavPrimary" href="/tier-list/">TierList</a>
      <a v-else class="Common_NavPrimary" href="/leaderboard/">首页</a>
    </nav>
  </header>
</template>

<style scoped>
/* 顶部外壳：固定在页面顶部，提供深棕导航底。 */
.Common_Header {
  position: sticky;
  top: 0;
  z-index: 10;
  height: 64px;
  background: var(--color-brown);
  border-bottom: 2px solid var(--color-gold);
  box-shadow: 0 4px 18px rgba(20, 13, 9, 0.2);
}

/* 顶部内容容器：限制宽度并让品牌和入口分居两侧。 */
.Common_Header_Nav {
  width: min(100%, var(--page-max));
  height: 64px;
  margin: 0 auto;
  padding: 0 var(--page-pad);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

/* 品牌文字：使用标题字体，承担产品识别。 */
.Common_Header_Brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  color: #fff7e7;
  font-family: var(--font-serif);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0;
}

/* 品牌菱形：作为轻量家纹感标识。 */
.Common_Header_BrandSymbol {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  transform: rotate(45deg);
  background: linear-gradient(135deg, #f2d67d, var(--color-gold));
  border: 1px solid #f8e8bd;
  box-shadow: 0 0 0 3px rgba(185, 133, 36, 0.18);
}

/* 手机端：降低导航高度和品牌字号。 */
@media (max-width: 760px) {
  .Common_Header,
  .Common_Header_Nav {
    height: 60px;
  }

  .Common_Header_Brand {
    font-size: 18px;
  }

  .Common_NavPrimary {
    min-height: 38px;
    padding: 0 14px;
  }
}
</style>
