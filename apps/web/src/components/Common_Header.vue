<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { isBattleFestivalActive, loadBattleFestivalPeriod } from "../lib/battleFestival";
import { trackSiteEvent } from "../lib/siteAnalytics";
import { readVersionParam, versionedPageHref } from "../lib/versionOptions";

const props = defineProps<{
  current: "home" | "tier" | "battleFestival" | "status" | "matchSearch" | "admin" | "adminStats";
}>();

const navItems = [
  { key: "home", label: "首页", href: "/leaderboard/", activeOnly: false },
  { key: "tier", label: "TierList", href: "/tier-list/", activeOnly: false },
  { key: "battleFestival", label: "战祭", href: "/battle-festival/", activeOnly: true },
  { key: "matchSearch", label: "对局搜索", href: "/match-search/", activeOnly: false },
  { key: "status", label: "数据状态", href: "/leaderboard-status/", activeOnly: false }
] as const;

const showBattleFestival = ref(false);
const currentVersion = ref("");

onMounted(async () => {
  currentVersion.value = readVersionParam();
  window.addEventListener("popstate", syncVersionParam);
  window.addEventListener("eiketsu-version-change", syncVersionParam);
  showBattleFestival.value = isBattleFestivalActive(await loadBattleFestivalPeriod());
});

onBeforeUnmount(() => {
  window.removeEventListener("popstate", syncVersionParam);
  window.removeEventListener("eiketsu-version-change", syncVersionParam);
});

function syncVersionParam(): void {
  currentVersion.value = readVersionParam();
}

function navHref(href: string): string {
  return versionedPageHref(href, currentVersion.value);
}

function trackNavClick(key: string, href: string): void {
  trackSiteEvent("nav_click", key, { href });
}
</script>

<template>
  <header class="Common_Header">
    <nav class="Common_Header_Nav" aria-label="主要导航">
      <a class="Common_Header_Brand" :href="navHref('/leaderboard/')" @click="trackNavClick('brand', navHref('/leaderboard/'))">
        <span class="Common_Header_BrandSymbol" aria-hidden="true"></span>
        <span>Eiketsu Leaderboard</span>
      </a>
      <span class="Common_Header_Links">
        <a
          v-for="item in navItems"
          v-show="item.key !== props.current && (!item.activeOnly || showBattleFestival)"
          :key="item.key"
          class="Common_NavPrimary"
          :href="navHref(item.href)"
          @click="trackNavClick(item.key, navHref(item.href))"
        >
          {{ item.label }}
        </a>
      </span>
    </nav>
  </header>
</template>

<style scoped>
.Common_Header {
  position: sticky;
  top: 0;
  z-index: 10;
  height: 64px;
  background: var(--color-brown);
  border-bottom: 2px solid var(--color-gold);
  box-shadow: 0 4px 18px rgba(20, 13, 9, 0.2);
}

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

.Common_Header_Brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  min-width: 0;
  color: #fff7e7;
  font-family: var(--font-serif);
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0;
}

.Common_Header_Brand span:last-child {
  white-space: nowrap;
}

.Common_Header_BrandSymbol {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  transform: rotate(45deg);
  background: linear-gradient(135deg, #f2d67d, var(--color-gold));
  border: 1px solid #f8e8bd;
  box-shadow: 0 0 0 3px rgba(185, 133, 36, 0.18);
}

.Common_Header_Links {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex: 0 0 auto;
}

@media (max-width: 760px) {
  .Common_Header,
  .Common_Header_Nav {
    height: 60px;
  }

  .Common_Header_Nav {
    gap: 10px;
  }

  .Common_Header_Brand {
    font-size: 18px;
  }

  .Common_Header_Links {
    flex: 1 1 auto;
    justify-content: flex-start;
    overflow-x: auto;
    scrollbar-width: none;
    gap: 6px;
  }

  .Common_Header_Links::-webkit-scrollbar {
    display: none;
  }

  .Common_NavPrimary {
    min-height: 44px;
    min-width: 44px;
    padding: 0 10px;
    font-size: 13px;
  }
}

@media (max-width: 430px) {
  .Common_Header,
  .Common_Header_Nav {
    height: 52px;
  }

  .Common_Header_Nav {
    gap: 8px;
  }

  .Common_Header_Brand {
    flex: 0 1 auto;
    gap: 8px;
    flex-shrink: 0;
    font-size: 14px;
  }

  .Common_Header_BrandSymbol {
    width: 14px;
    height: 14px;
  }

  .Common_NavPrimary {
    min-height: 44px;
    min-width: 44px;
    padding: 0 8px;
    font-size: 12px;
  }
}
</style>
