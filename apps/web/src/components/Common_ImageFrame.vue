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

const UNIT_TYPE_ICON_URLS: Record<string, string> = {
  "槍兵": "https://image.eiketsu-taisen.net/unit_type/icon_white/5772a418a476299306cb90f89362f514.png?260520a",
  "弓兵": "https://image.eiketsu-taisen.net/unit_type/icon_white/3e1dca95300bfd625d55d3f80996937d.png?260520a",
  "騎兵": "https://image.eiketsu-taisen.net/unit_type/icon_white/f847cdd92b25ae6395de15ebb3fe8056.png?260520a",
  "剣豪": "https://image.eiketsu-taisen.net/unit_type/icon_white/4121f72dfaa54327fd8aca68b4f25bc6.png?260520a",
  "鉄砲隊": "https://image.eiketsu-taisen.net/unit_type/icon_white/435f285539ff5862f97f43fd70a2ccab.png?260520a"
};

const UNIT_TYPE_ALIASES: Record<string, string> = {
  "槍": "槍兵",
  "槍兵": "槍兵",
  "枪兵": "槍兵",
  "弓": "弓兵",
  "弓兵": "弓兵",
  "騎": "騎兵",
  "騎兵": "騎兵",
  "骑兵": "騎兵",
  "剣": "剣豪",
  "剣豪": "剣豪",
  "剑豪": "剣豪",
  "鉄": "鉄砲隊",
  "鉄砲": "鉄砲隊",
  "鉄砲隊": "鉄砲隊",
  "铁炮": "鉄砲隊",
  "铁炮队": "鉄砲隊"
};

const COST_ICON_URLS: Record<string, string> = {
  "1.0": "https://image.eiketsu-taisen.net/general/cost/icon/227c4920436bde013efca97dadf846ab.png?260520a",
  "1.5": "https://image.eiketsu-taisen.net/general/cost/icon/3f988d1dbbceadb0a3c3e234d9e0ca76.png?260520a",
  "2.0": "https://image.eiketsu-taisen.net/general/cost/icon/6ef880152454c2e4f40f9e06094a7431.png?260520a",
  "2.5": "https://image.eiketsu-taisen.net/general/cost/icon/4ab6c7bc627bdf1448c4ce60d54d96ec.png?260520a",
  "3.0": "https://image.eiketsu-taisen.net/general/cost/icon/c457c44d0a0f42300ace6298bb2882f9.png?260520a",
  "3.5": "https://image.eiketsu-taisen.net/general/cost/icon/a8110c617df5773102162c3a06a3ac8a.png?260520a",
  "4.0": "https://image.eiketsu-taisen.net/general/cost/icon/bb4251def09373fcf2fa635753d5a0aa.png?260520a"
};

const SKILL_ABBREVIATIONS: Record<string, string> = {
  "伏兵": "伏",
  "防柵": "柵",
  "復活": "活",
  "忍": "忍",
  "気合": "気",
  "狙撃": "狙",
  "昂揚": "昂",
  "技巧": "技",
  "先陣": "先",
  "鬼": "鬼",
  "疾駆": "疾",
  "大兵": "兵",
  "同盟": "盟",
  "槍術": "槍",
  "黄熾": "黄",
  "覇気": "覇",
  "宿星": "星"
};

const props = withDefaults(defineProps<{
  src?: string;
  alt: string;
  ratio?: "square" | "portrait";
  card?: ImageFrameCard | null;
  showDetails?: boolean;
  showOverlays?: boolean;
  density?: "compact" | "full";
}>(), {
  src: "",
  ratio: "square",
  card: null,
  showDetails: false,
  showOverlays: false,
  density: "compact"
});

const failed = ref(false);

watch(() => props.src, () => {
  failed.value = false;
});

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function toHalfWidth(value: string): string {
  return value.replace(/[０-９．]/g, (char) => char === "．" ? "." : String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function normalizedCost(value: unknown): string {
  const match = toHalfWidth(text(value)).match(/\d+(?:\.\d+)?/);
  if (!match) return "";
  const costValue = Number(match[0]);
  return Number.isFinite(costValue) ? costValue.toFixed(1) : "";
}

function normalizedUnitType(value: unknown): string {
  const normalized = text(value).replace(/\s+/g, "");
  return UNIT_TYPE_ALIASES[normalized] ?? normalized;
}

function skillAbbreviation(value: string): string {
  return SKILL_ABBREVIATIONS[value] ?? Array.from(value)[0] ?? "";
}

const detailCard = computed(() => props.card ?? null);
const hasDetails = computed(() => Boolean(props.showDetails && detailCard.value));
const displayName = computed(() => text(detailCard.value?.name) || props.alt);
const unitType = computed(() => normalizedUnitType(detailCard.value?.unitType));
const cost = computed(() => normalizedCost(detailCard.value?.cost));
const force = computed(() => text(detailCard.value?.force));
const intelligence = computed(() => text(detailCard.value?.intelligence));
const unitTypeIconUrl = computed(() => UNIT_TYPE_ICON_URLS[unitType.value] ?? "");
const costIconUrl = computed(() => COST_ICON_URLS[cost.value] ?? "");
const skillLabels = computed(() => (detailCard.value?.skills ?? []).map(text).filter(Boolean).slice(0, 3));
const hasOverlays = computed(() => Boolean((props.showDetails || props.showOverlays) && detailCard.value));
const skillBadges = computed(() => skillLabels.value.map((label) => ({
  label,
  abbreviation: skillAbbreviation(label)
})).filter((skill) => hasOverlays.value && skill.abbreviation));
const hasPowerStats = computed(() => hasOverlays.value);
const detailRows = computed(() => [
  { label: "勢力", value: text(detailCard.value?.faction) },
  { label: "兵種", value: unitType.value },
  { label: "武力", value: force.value },
  { label: "知力", value: intelligence.value },
  { label: "Cost", value: cost.value },
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
    :aria-label="detailTitle"
    :tabindex="hasDetails ? 0 : undefined"
    :data-label="alt"
  >
    <span class="Common_ImageFrame_Canvas">
      <img v-if="src && !failed" class="Common_ImageFrame_Image" :src="src" :alt="alt" loading="lazy" @error="failed = true">
      <span v-else class="Common_ImageFrame_Fallback">{{ alt }}</span>

      <span v-if="hasOverlays && unitTypeIconUrl" class="Common_ImageFrame_UnitIcon" aria-hidden="true">
        <img :src="unitTypeIconUrl" alt="" loading="lazy">
      </span>
      <span v-if="hasOverlays && costIconUrl" class="Common_ImageFrame_CostIcon" aria-hidden="true">
        <img :src="costIconUrl" alt="" loading="lazy">
      </span>
      <span v-if="hasPowerStats" class="Common_ImageFrame_PowerStats" aria-hidden="true">
        <span class="Common_ImageFrame_PowerValue">{{ force || "-" }}</span>
        <span class="Common_ImageFrame_PowerValue">{{ intelligence || "-" }}</span>
      </span>
      <span v-if="skillBadges.length" class="Common_ImageFrame_SkillBadges" aria-hidden="true">
        <span v-for="skill in skillBadges" :key="skill.label" class="Common_ImageFrame_SkillBadge">
          {{ skill.abbreviation }}
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
  --Common_ImageFrame_UnitOffsetX: 0px;
  --Common_ImageFrame_UnitOffsetY: 0px;
  --Common_ImageFrame_CostOffsetX: 0px;
  --Common_ImageFrame_CostOffsetY: 0px;
  --Common_ImageFrame_StatsOffsetX: 0px;
  --Common_ImageFrame_StatsOffsetY: 0px;
  --Common_ImageFrame_SkillOffsetX: 0px;
  --Common_ImageFrame_SkillOffsetY: 0px;
  --Common_ImageFrame_OverlayMask: color-mix(in srgb, var(--color-panel-strong) 20%, transparent);
  --Common_ImageFrame_UnitSize: clamp(17px, 35%, 24px);
  --Common_ImageFrame_CostWidth: clamp(25px, 60%, 40px);
  --Common_ImageFrame_StatSize: clamp(14px, 30%, 19px);
  --Common_ImageFrame_SkillSize: 17px;

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

.Common_ImageFrame.Common_ImageFrame_compact {
  --Common_ImageFrame_UnitOffsetX: -3px;
  --Common_ImageFrame_UnitOffsetY: -1px;
  --Common_ImageFrame_CostOffsetX: 8px;
  --Common_ImageFrame_CostOffsetY: -1px;
  --Common_ImageFrame_StatsOffsetX: -3px;
  --Common_ImageFrame_StatsOffsetY: 2px;
  --Common_ImageFrame_SkillOffsetX: 3px;
  --Common_ImageFrame_SkillOffsetY: 2px;
  --Common_ImageFrame_UnitSize: clamp(15px, 34%, 21px);
  --Common_ImageFrame_CostWidth: clamp(23px, 90%, 50px);
  --Common_ImageFrame_StatSize: clamp(13px, 29%, 17px);
  --Common_ImageFrame_SkillSize: 14px;
}

.Common_ImageFrame.Common_ImageFrame_full {
  --Common_ImageFrame_UnitOffsetX: -4px;
  --Common_ImageFrame_UnitOffsetY: -2px;
  --Common_ImageFrame_CostOffsetX: 10px;
  --Common_ImageFrame_CostOffsetY: -2px;
  --Common_ImageFrame_StatsOffsetX: -4px;
  --Common_ImageFrame_StatsOffsetY: 2px;
  --Common_ImageFrame_SkillOffsetX: 4px;
  --Common_ImageFrame_SkillOffsetY: 2px;
  --Common_ImageFrame_UnitSize: clamp(18px, 36%, 26px);
  --Common_ImageFrame_CostWidth: clamp(26px, 70%, 50px);
  --Common_ImageFrame_StatSize: clamp(15px, 32%, 20px);
  --Common_ImageFrame_SkillSize: 18px;
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

.Common_ImageFrame_Image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.Common_ImageFrame.Common_ImageFrame_portrait .Common_ImageFrame_Image {
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

.Common_ImageFrame_UnitIcon,
.Common_ImageFrame_CostIcon,
.Common_ImageFrame_PowerStats,
.Common_ImageFrame_SkillBadges {
  position: absolute;
  z-index: 2;
  pointer-events: none;
}

.Common_ImageFrame_UnitIcon {
  top: 0;
  left: 0;
  width: var(--Common_ImageFrame_UnitSize);
  background: var(--Common_ImageFrame_OverlayMask);
  border-radius: 0 0 var(--radius-sm) 0;
  filter: drop-shadow(0 1px 1px color-mix(in srgb, var(--color-brown) 86%, transparent));
  transform: translate(var(--Common_ImageFrame_UnitOffsetX), var(--Common_ImageFrame_UnitOffsetY));
}

.Common_ImageFrame_CostIcon {
  top: 0;
  right: 0;
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
  width: var(--Common_ImageFrame_CostWidth);
  background: var(--Common_ImageFrame_OverlayMask);
  border-radius: 0 0 0 var(--radius-sm);
  filter: drop-shadow(0 1px 1px color-mix(in srgb, var(--color-brown) 76%, transparent));
  transform: translate(var(--Common_ImageFrame_CostOffsetX), var(--Common_ImageFrame_CostOffsetY));
}

.Common_ImageFrame_UnitIcon img {
  display: block;
  width: 100%;
  height: auto;
  object-fit: contain;
}

.Common_ImageFrame_CostIcon img {
  display: block;
  width: auto;
  max-width: 100%;
  height: auto;
  margin-left: auto;
  object-fit: contain;
}

.Common_ImageFrame_PowerStats {
  left: 0;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(2, var(--Common_ImageFrame_StatSize));
  gap: 1px;
  padding: 1px;
  background: var(--Common_ImageFrame_OverlayMask);
  border-radius: 0 var(--radius-sm) 0 0;
  transform: translate(var(--Common_ImageFrame_StatsOffsetX), var(--Common_ImageFrame_StatsOffsetY));
}

.Common_ImageFrame_PowerValue {
  display: grid;
  place-items: center;
  width: var(--Common_ImageFrame_StatSize);
  height: var(--Common_ImageFrame_StatSize);
  color: var(--color-panel-strong);
  background: color-mix(in srgb, var(--color-brown) 64%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-gold) 38%, transparent);
  border-radius: var(--radius-sm);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-panel-strong) 10%, transparent);
  font-family: var(--font-number);
  font-size: calc(var(--Common_ImageFrame_StatSize) * 1.0);
  font-weight: 800;
  line-height: 1;
}

.Common_ImageFrame_SkillBadges {
  right: 0;
  bottom: 0;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 1px;
  padding: 1px;
  background: var(--Common_ImageFrame_OverlayMask);
  border-radius: var(--radius-sm) 0 0 0;
  transform: translate(var(--Common_ImageFrame_SkillOffsetX), var(--Common_ImageFrame_SkillOffsetY));
}

.Common_ImageFrame_SkillBadge {
  display: grid;
  place-items: center;
  width: var(--Common_ImageFrame_SkillSize);
  height: var(--Common_ImageFrame_SkillSize);
  color: var(--color-brown);
  background: color-mix(in srgb, var(--color-panel-strong) 82%, transparent);
  border-radius: var(--radius-sm);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-brown) 20%, transparent);
  font-family: var(--font-serif);
  font-size: calc(var(--Common_ImageFrame_SkillSize) * 0.82);
  font-weight: 800;
  line-height: 1;
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
</style>
