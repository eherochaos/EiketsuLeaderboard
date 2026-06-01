<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import CommonHeader from "./components/Common_Header.vue";
import { dateOnly, dateTime, integer } from "./lib/format";
import { loadRefreshStatus } from "./lib/refreshStatus";
import type { LeaderboardRefreshRun, LeaderboardRefreshStatus, LeaderboardRefreshUpload } from "./types";

const status = ref<LeaderboardRefreshStatus | null>(null);
const loading = ref(true);
const error = ref("");

onMounted(async () => {
  try {
    status.value = await loadRefreshStatus();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "数据状态读取失败";
  } finally {
    loading.value = false;
  }
});

const refresh = computed(() => status.value?.refresh ?? null);
const snapshot = computed(() => status.value?.snapshot ?? null);
const latestRun = computed(() => status.value?.latestRun ?? null);
const latestUpload = computed(() => status.value?.latestUpload ?? null);
const recentRuns = computed(() => status.value?.recentRuns ?? []);
const recentUploads = computed(() => status.value?.recentUploads ?? []);
const refreshTone = computed(() => {
  const value = refresh.value?.status || "";
  if (value === "completed") return "ok";
  if (value === "running" || value === "skipped") return "warn";
  if (value === "failed") return "error";
  return "neutral";
});

function statusLabel(value?: string): string {
  const labels: Record<string, string> = {
    completed: "完成",
    failed: "失败",
    ready: "就绪",
    running: "运行中",
    skipped: "已跳过",
    building: "构建中",
  };
  return labels[value || ""] || value || "-";
}

function durationLabel(value?: number): string {
  if (!value) return "-";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function sampleLabel(value?: number): string {
  return value === undefined || value === null ? "-" : integer(value);
}

function periodLabel(dateFrom?: string, dateTo?: string): string {
  const from = dateOnly(dateFrom || "");
  const to = dateOnly(dateTo || "");
  return `${from} - ${to}`;
}

function runPeriod(run: LeaderboardRefreshRun): string {
  return periodLabel(run.dateFrom, run.dateTo);
}

function uploadPeriod(upload: LeaderboardRefreshUpload): string {
  return periodLabel(upload.dateFrom, upload.dateTo);
}
</script>

<template>
  <CommonHeader current="status" />
  <main class="Common_PageShell StatusPage">
    <section v-if="loading" class="Common_StatusPanel">正在读取数据状态...</section>
    <section v-else-if="error" class="Common_StatusPanel Common_StatusPanel_Error">{{ error }}</section>
    <template v-else-if="status && refresh && snapshot">
      <section class="StatusPage_Hero" aria-labelledby="status-title">
        <div>
          <p class="Common_Eyebrow">Status</p>
          <h1 id="status-title">数据状态</h1>
          <p class="StatusPage_MetaLine">
            <span>生成 {{ dateTime(status.generatedAt) }}</span>
            <span>刷新 {{ statusLabel(refresh.status) }}</span>
            <span>耗时 {{ durationLabel(refresh.durationMs) }}</span>
          </p>
        </div>
        <strong class="StatusPage_State" :data-tone="refreshTone">{{ statusLabel(refresh.status) }}</strong>
      </section>

      <section v-if="refresh.error || refresh.reason" class="StatusPage_Notice" :data-tone="refreshTone">
        {{ refresh.error || refresh.reason }}
      </section>

      <section class="StatusPage_SummaryGrid" aria-label="数据摘要">
        <article>
          <span>当前快照</span>
          <strong>Run {{ snapshot.sourceRunId || "-" }}</strong>
          <small>{{ snapshot.targetVersion || "-" }} / {{ periodLabel(snapshot.dateFrom, snapshot.dateTo) }}</small>
        </article>
        <article>
          <span>样本</span>
          <strong>{{ sampleLabel(snapshot.sampleSize) }}</strong>
          <small>Tier {{ sampleLabel(snapshot.tierRows) }} / Cluster {{ sampleLabel(snapshot.clusterRows) }}</small>
        </article>
        <article>
          <span>最后上传</span>
          <strong>#{{ latestUpload?.id || "-" }}</strong>
          <small>{{ latestUpload ? uploadPeriod(latestUpload) : "-" }}</small>
        </article>
        <article>
          <span>最后 Run</span>
          <strong>#{{ latestRun?.id || "-" }}</strong>
          <small>{{ latestRun ? `${statusLabel(latestRun.status)} / ${runPeriod(latestRun)}` : "-" }}</small>
        </article>
      </section>

      <section class="Common_TableCard StatusPage_TableCard" aria-labelledby="status-upload-title">
        <div class="Common_SectionHeading Common_SectionHeading_Compact">
          <div>
            <p class="Common_Eyebrow">Uploads</p>
            <h2 id="status-upload-title">最近上传</h2>
          </div>
          <span>{{ integer(recentUploads.length) }} 条</span>
        </div>
        <table class="Common_TableLayout StatusPage_Table">
          <thead>
            <tr>
              <th>ID</th>
              <th>版本</th>
              <th>日期</th>
              <th>状态</th>
              <th>导入</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="upload in recentUploads" :key="upload.id">
              <td class="Common_RankCell">#{{ upload.id }}</td>
              <td>{{ upload.targetVersion || "-" }}</td>
              <td>{{ uploadPeriod(upload) }}</td>
              <td>{{ statusLabel(upload.status) }}</td>
              <td>{{ sampleLabel(upload.importedMatchCount) }} / {{ sampleLabel(upload.matchCount) }}</td>
              <td>{{ dateTime(upload.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="Common_TableCard StatusPage_TableCard" aria-labelledby="status-run-title">
        <div class="Common_SectionHeading Common_SectionHeading_Compact">
          <div>
            <p class="Common_Eyebrow">Runs</p>
            <h2 id="status-run-title">最近 Run</h2>
          </div>
          <span>{{ integer(recentRuns.length) }} 条</span>
        </div>
        <table class="Common_TableLayout StatusPage_Table">
          <thead>
            <tr>
              <th>ID</th>
              <th>版本</th>
              <th>日期</th>
              <th>状态</th>
              <th>上传水位</th>
              <th>样本</th>
              <th>生成</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="run in recentRuns" :key="run.id">
              <td class="Common_RankCell">#{{ run.id }}</td>
              <td>{{ run.targetVersion || "-" }}</td>
              <td>{{ runPeriod(run) }}</td>
              <td>{{ statusLabel(run.status) }}</td>
              <td>{{ sampleLabel(run.uploadWatermark) }}</td>
              <td>{{ sampleLabel(run.sideSampleCount) }}</td>
              <td>{{ dateTime(run.generatedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </main>
</template>

<style scoped>
.StatusPage {
  padding-top: 18px;
}

.StatusPage_Hero {
  min-height: 136px;
  padding: 20px 28px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-lg);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}

.StatusPage_Hero h1 {
  margin-bottom: 8px;
  color: var(--color-brown);
  font-family: var(--font-serif);
  font-size: 42px;
  line-height: 1.15;
}

.StatusPage_MetaLine {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 14px;
  font-weight: 700;
}

.StatusPage_State {
  min-width: 108px;
  padding: 12px 16px;
  color: #fffaf0;
  background: var(--color-muted);
  font-family: var(--font-control);
  text-align: center;
}

.StatusPage_State[data-tone="ok"] {
  background: #52704a;
}

.StatusPage_State[data-tone="warn"] {
  background: #9a6b22;
}

.StatusPage_State[data-tone="error"] {
  background: var(--color-primary);
}

.StatusPage_Notice {
  margin-top: var(--space-md);
  padding: 14px 18px;
  border: 1px solid rgba(185, 133, 36, 0.48);
  color: #76521c;
  background: rgba(255, 244, 217, 0.72);
  font-family: var(--font-control);
  font-weight: 800;
}

.StatusPage_Notice[data-tone="error"] {
  border-color: rgba(169, 59, 52, 0.42);
  color: var(--color-primary);
  background: rgba(255, 239, 235, 0.78);
}

.StatusPage_SummaryGrid {
  margin-top: var(--space-md);
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.StatusPage_SummaryGrid article {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--color-border);
  background: rgba(255, 250, 240, 0.78);
  box-shadow: var(--shadow-tight);
}

.StatusPage_SummaryGrid span,
.StatusPage_SummaryGrid small {
  display: block;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 13px;
  font-weight: 800;
}

.StatusPage_SummaryGrid strong {
  display: block;
  margin: 6px 0;
  color: var(--color-brown);
  font-family: var(--font-number);
  font-size: 26px;
  line-height: 1.1;
}

.StatusPage_TableCard {
  margin-top: var(--space-md);
}

.StatusPage_Table {
  min-width: 840px;
}

.StatusPage_Table th,
.StatusPage_Table td {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(216, 192, 151, 0.62);
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 14px;
  font-weight: 800;
  text-align: left;
  vertical-align: middle;
}

.StatusPage_Table th {
  color: var(--color-brown);
  background: rgba(255, 244, 217, 0.58);
}

.StatusPage_Table td:first-child {
  color: var(--color-gold);
}

@media (max-width: 760px) {
  .StatusPage_Hero {
    min-height: 0;
    padding: var(--space-md);
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .StatusPage_Hero h1 {
    font-size: 32px;
  }

  .StatusPage_State {
    width: 100%;
  }

  .StatusPage_SummaryGrid {
    grid-template-columns: 1fr;
  }

  .StatusPage_SummaryGrid article {
    padding: 14px;
  }
}
</style>
