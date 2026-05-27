<script setup lang="ts">
import { computed, ref, watch } from "vue";

type ImageFrameCard = {
  name?: string;
  faction?: string;
  cardCode?: string;
  cost?: string;
  unitType?: string;
  force?: string | number;
  intelligence?: string | number;
  era?: string;
  skills?: string[];
};

const props = withDefaults(defineProps<{
  src?: string;
  alt: string;
  ratio?: "square" | "portrait";
  card?: ImageFrameCard | null;
  showDetails?: boolean;
  density?: "compact" | "full";
}>(), {
  src: "",
  ratio: "square",
  card: null,
  showDetails: false,
  density: "compact"
});

const failed = ref(false);

watch(() => props.src, () => {
  failed.value = false;
});

function text(value: unknown): string {
  return String(value ?? "").trim();
}

const detailCard = computed(() => props.card ?? null);
const hasDetails = computed(() => Boolean(props.showDetails && detailCard.value));
const displayName = computed(() => text(detailCard.value?.name) || props.alt);
const unitType = computed(() => text(detailCard.value?.unitType));
const force = computed(() => text(detailCard.value?.force));
const intelligence = computed(() => text(detailCard.value?.intelligence));
const skillLabels = computed(() => (detailCard.value?.skills ?? []).map(text).filter(Boolean).slice(0, 4));
const statItems = computed(() => [
  unitType.value ? { label: "兵", value: unitType.value, kind: "unit" } : null,
  force.value ? { label: "武", value: force.value, kind: "number" } : null,
  intelligence.value ? { label: "知", value: intelligence.value, kind: "number" } : null
].filter((item): item is { label: string; value: string; kind: string } => Boolean(item)));
const hasStats = computed(() => hasDetails.value && statItems.value.length > 0);
const detailRows = computed(() => [
  { label: "勢力", value: text(detailCard.value?.faction) },
  { label: "兵種", value: unitType.value },
  { label: "武力", value: force.value },
  { label: "知力", value: intelligence.value },
  { label: "Cost", value: text(detailCard.value?.cost) },
  { label: "時代", value: text(detailCard.value?.era) },
  { label: "No.", value: text(detailCard.value?.cardCode) }
].filter((row) => row.value));
const hasPopover = computed(() => hasDetails.value && (detailRows.value.length > 0 || skillLabels.value.length > 0));
const detailTitle = computed(() => {
  if (!hasPopover.value) return displayName.value;
  const rows = detailRows.value.map((row) => `${row.label}: ${row.value}`);
  if (skillLabels.value.length) rows.push(`特技: ${skillLabels.value.join(" / ")}`);
  return [displayName.value, ...rows].join("\n");
});
</script>

<template>
  <span
    class="Common_ImageFrame"
    :class="[
      `Common_ImageFrame_${ratio}`,
      `Common_ImageFrame_${density}`,
      { Common_ImageFrame_HasDetails: hasDetails }
    ]"
    :title="detailTitle"
    :aria-label="detailTitle"
    :tabindex="hasDetails ? 0 : undefined"
    :data-label="alt"
  >
    <span class="Common_ImageFrame_Canvas">
      <img v-if="src && !failed" :src="src" :alt="alt" loading="lazy" @error="failed = true">
      <span v-else class="Common_ImageFrame_Fallback">{{ alt }}</span>
      <span v-if="hasStats" class="Common_ImageFrame_Stats" aria-hidden="true">
        <span
          v-for="item in statItems"
          :key="`${item.label}:${item.value}`"
          class="Common_ImageFrame_Stat"
          :class="{ Common_ImageFrame_StatUnit: item.kind === 'unit' }"
        >
          <span class="Common_ImageFrame_StatLabel">{{ item.label }}</span>
          <span class="Common_ImageFrame_StatValue">{{ item.value }}</span>
        </span>
      </span>
    </span>

    <span v-if="hasPopover" class="Common_ImageFrame_Popover" aria-hidden="true">
      <span class="Common_ImageFrame_PopoverName">{{ displayName }}</span>
      <span class="Common_ImageFrame_PopoverRows">
        <span v-for="row in detailRows" :key="row.label" class="Common_ImageFrame_PopoverRow">
          <span>{{ row.label }}</span>
          <strong>{{ row.value }}</strong>
        </span>
      </span>
      <span v-if="skillLabels.length" class="Common_ImageFrame_Skills">
        <span v-for="skill in skillLabels" :key="skill">{{ skill }}</span>
      </span>
    </span>
  </span>
</template>

<style scoped>
.Common_ImageFrame {
  position: relative;
  display: inline-block;
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  color: var(--color-panel-strong);
  font-family: var(--font-content);
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  outline: none;
}

.Common_ImageFrame.Common_ImageFrame_portrait {
  aspect-ratio: 5 / 8;
  height: auto;
}

.Common_ImageFrame_Canvas {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-border) 72%, var(--color-brown));
  border-radius: var(--radius-sm);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--color-panel-strong) 12%, transparent), transparent 42%),
    var(--color-brown);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-panel-strong) 14%, transparent);
  transition: border-color 160ms ease, filter 160ms ease;
}

.Common_ImageFrame img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.Common_ImageFrame.Common_ImageFrame_portrait img {
  object-fit: contain;
  background: var(--color-brown);
}

.Common_ImageFrame_Fallback {
  width: 100%;
  max-height: 100%;
  padding: var(--space-xs);
  display: -webkit-box;
  overflow: hidden;
  line-height: 1.24;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.Common_ImageFrame_HasDetails:hover .Common_ImageFrame_Canvas,
.Common_ImageFrame_HasDetails:focus-visible .Common_ImageFrame_Canvas,
.Common_ImageFrame_HasDetails:focus-within .Common_ImageFrame_Canvas {
  border-color: var(--color-gold);
  filter: saturate(1.04) contrast(1.03);
}

.Common_ImageFrame_HasDetails:hover,
.Common_ImageFrame_HasDetails:focus-visible,
.Common_ImageFrame_HasDetails:focus-within {
  z-index: 30;
}

.Common_ImageFrame_Stats {
  position: absolute;
  right: 3px;
  bottom: 3px;
  left: 3px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 0;
  padding: 3px;
  background: color-mix(in srgb, var(--color-brown) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-gold) 52%, transparent);
  border-radius: var(--radius-sm);
}

.Common_ImageFrame_Stat {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  color: var(--color-brown);
  background: var(--color-panel-strong);
  border-radius: var(--radius-sm);
  font-family: var(--font-number);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.15;
}

.Common_ImageFrame_StatLabel {
  flex: 0 0 auto;
  padding: 1px 2px;
  color: var(--color-panel-strong);
  background: var(--color-brown);
}

.Common_ImageFrame_StatValue {
  min-width: 0;
  padding: 1px 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.Common_ImageFrame_StatUnit {
  max-width: 100%;
}

.Common_ImageFrame_Popover {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  z-index: 20;
  width: min(220px, 72vw);
  padding: var(--space-sm);
  display: grid;
  gap: var(--space-xs);
  color: var(--color-text);
  text-align: left;
  background: var(--color-panel-strong);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-pop);
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%) translateY(-4px);
  transition: opacity 140ms ease, transform 140ms ease;
}

.Common_ImageFrame_Popover::after {
  content: "";
  position: absolute;
  bottom: 100%;
  left: 50%;
  width: 8px;
  height: 8px;
  background: var(--color-panel-strong);
  border-top: 1px solid var(--color-border);
  border-left: 1px solid var(--color-border);
  transform: translate(-50%, 4px) rotate(45deg);
}

.Common_ImageFrame_HasDetails:hover .Common_ImageFrame_Popover,
.Common_ImageFrame_HasDetails:focus-visible .Common_ImageFrame_Popover,
.Common_ImageFrame_HasDetails:focus-within .Common_ImageFrame_Popover {
  opacity: 1;
  transform: translateX(-50%);
}

.Common_ImageFrame_PopoverName {
  overflow: hidden;
  color: var(--color-brown);
  font-family: var(--font-serif);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.Common_ImageFrame_PopoverRows {
  display: grid;
  gap: 2px;
}

.Common_ImageFrame_PopoverRow {
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.35;
}

.Common_ImageFrame_PopoverRow strong {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-weight: 700;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.Common_ImageFrame_Skills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.Common_ImageFrame_Skills span {
  max-width: 100%;
  padding: 2px 5px;
  overflow: hidden;
  color: var(--color-brown);
  background: var(--color-panel-strong);
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.Common_ImageFrame_Compact .Common_ImageFrame_Stats {
  right: 2px;
  bottom: 2px;
  left: 2px;
  gap: 2px;
  padding: 2px;
}

.Common_ImageFrame_Compact .Common_ImageFrame_Stat {
  font-size: 9px;
}

.Common_ImageFrame_Compact .Common_ImageFrame_StatLabel {
  padding: 1px 2px;
}

.Common_ImageFrame_Compact .Common_ImageFrame_StatValue {
  padding: 1px 2px;
}
</style>
