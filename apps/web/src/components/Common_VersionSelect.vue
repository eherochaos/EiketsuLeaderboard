<script setup lang="ts">
import { dateOnly, integer } from "../lib/format";
import type { LeaderboardVersionOption } from "../types";

const props = defineProps<{
  modelValue: string;
  versions: LeaderboardVersionOption[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

function optionLabel(option: LeaderboardVersionOption): string {
  const sample = option.sampleSize ? ` / ${integer(option.sampleSize)}` : "";
  const range = option.dateFrom || option.dateTo ? ` / ${dateOnly(option.dateFrom)}-${dateOnly(option.dateTo)}` : "";
  return `${option.targetVersion}${range}${sample}`;
}

function onChange(event: Event): void {
  const select = event.target as HTMLSelectElement;
  emit("update:modelValue", select.value);
}
</script>

<template>
  <label class="Common_VersionSelect">
    <span>版本</span>
    <select :value="props.modelValue" :disabled="props.disabled || props.versions.length <= 1" @change="onChange">
      <option v-for="option in props.versions" :key="option.targetVersion" :value="option.targetVersion">
        {{ optionLabel(option) }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.Common_VersionSelect {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: min(100%, 320px);
  color: var(--color-muted);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0;
}

.Common_VersionSelect select {
  min-width: 220px;
  height: 44px;
  padding: 0 32px 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-panel);
  color: var(--color-text);
  font: inherit;
  letter-spacing: 0;
}

.Common_VersionSelect select:focus {
  outline: 2px solid var(--color-gold);
  outline-offset: 2px;
}

.Common_VersionSelect select:disabled {
  opacity: 0.72;
  cursor: not-allowed;
}

@media (max-width: 520px) {
  .Common_VersionSelect {
    width: 100%;
    align-items: flex-start;
    flex-direction: column;
  }

  .Common_VersionSelect select {
    width: 100%;
    min-width: 0;
  }
}
</style>
