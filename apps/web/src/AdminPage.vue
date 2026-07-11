<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import CommonHeader from "./components/Common_Header.vue";
import { dateOnly, dateTime, integer } from "./lib/format";
import {
  ADMIN_QUICK_LINKS,
  loadAdminBattleFestivalSnapshot,
  loadAdminLeaderboardSnapshot,
  loadAdminMatchSearchOptions,
  loadAdminRefreshStatus,
  loadAdminTierListSnapshot,
  loadAdminVersionOptions,
} from "./lib/adminOverview";
import type {
  LeaderboardRefreshRun,
  LeaderboardRefreshStatus,
  LeaderboardRefreshUpload,
  LeaderboardSnapshot,
  LeaderboardVersionManifest,
  MatchSearchOptions,
  TierListSnapshot,
} from "./types";

interface AdminSourceState<T> {
  data: T | null;
  loading: boolean;
  error: string;
}

interface AdminSourceCard {
  key: string;
  label: string;
  endpoint: string;
  status: string;
  tone: "ok" | "warn" | "error" | "neutral";
  detail: string;
  meta: string;
  error: string;
}

type AdminSection = "overview" | "invites" | "updates" | "behavior";

interface AdminTab {
  key: AdminSection;
  label: string;
  eyebrow: string;
  description: string;
  frameSrc?: string;
}

const ADMIN_TABS: AdminTab[] = [
  {
    key: "overview",
    label: "运维总览",
    eyebrow: "Overview",
    description: "查看公开数据源、刷新结果与索引覆盖情况。",
  },
  {
    key: "invites",
    label: "邀请码",
    eyebrow: "Invites",
    description: "创建、停用并查看邀请码使用状态。",
    frameSrc: "/admin/invites",
  },
  {
    key: "updates",
    label: "数据更新",
    eyebrow: "Updates",
    description: "进入服务器已有的数据更新与维护操作。",
    frameSrc: "/admin/updates",
  },
  {
    key: "behavior",
    label: "用户行为",
    eyebrow: "Behavior",
    description: "识别站长本机，并查看匿名访客的页面与操作记录。",
    frameSrc: "/admin-stats/?embed=1",
  },
];

function initialSection(): AdminSection {
  if (typeof window === "undefined") return "overview";
  const requested = new URLSearchParams(window.location.search).get("section");
  return ADMIN_TABS.some((tab) => tab.key === requested) ? requested as AdminSection : "overview";
}

function initialSource<T>(): AdminSourceState<T> {
  return { data: null, loading: true, error: "" };
}

const sources = reactive({
  versionOptions: initialSource<LeaderboardVersionManifest>(),
  leaderboard: initialSource<LeaderboardSnapshot>(),
  tierList: initialSource<TierListSnapshot>(),
  battleFestival: initialSource<TierListSnapshot>(),
  matchSearch: initialSource<MatchSearchOptions>(),
  refresh: initialSource<LeaderboardRefreshStatus>(),
});
const activeSection = ref<AdminSection>(initialSection());
const frameLoaded = ref(false);
const frameRevision = ref(0);
const activeTab = computed(() => ADMIN_TABS.find((tab) => tab.key === activeSection.value) || ADMIN_TABS[0]);
const activeFrameSrc = computed(() => activeTab.value.frameSrc || "");

const isLoading = computed(() => Object.values(sources).some((source) => source.loading));
const refreshStatus = computed(() => sources.refresh.data);
const leaderboard = computed(() => sources.leaderboard.data);
const versionOptions = computed(() => sources.versionOptions.data);
const tierList = computed(() => sources.tierList.data);
const battleFestival = computed(() => sources.battleFestival.data);
const matchSearch = computed(() => sources.matchSearch.data);

const snapshotMetadata = computed(() => leaderboard.value?.metadata ?? tierList.value?.metadata ?? null);
const currentVersion = computed(() => (
  versionOptions.value?.currentTargetVersion
  || snapshotMetadata.value?.targetVersion
  || "-"
));
const snapshotSample = computed(() => snapshotMetadata.value?.sampleSize ?? 0);
const leaderboardRows = computed(() => leaderboard.value?.tierRows.length ?? 0);
const leaderboardClusters = computed(() => leaderboard.value?.clusterRows.length ?? 0);
const matchCount = computed(() => matchSearch.value?.metadata.matchCount ?? 0);
const videoMatchCount = computed(() => matchSearch.value?.metadata.videoMatchCount ?? 0);
const recentRuns = computed(() => refreshStatus.value?.recentRuns?.slice(0, 6) ?? []);
const recentUploads = computed(() => refreshStatus.value?.recentUploads?.slice(0, 6) ?? []);

const refreshLabel = computed(() => {
  if (sources.refresh.loading) return "读取中";
  if (sources.refresh.error) return "不可用";
  return statusLabel(refreshStatus.value?.refresh.status);
});

const refreshTone = computed(() => {
  if (sources.refresh.loading) return "neutral";
  if (sources.refresh.error) return "error";
  const status = refreshStatus.value?.refresh.status;
  if (status === "completed") return "ok";
  if (status === "failed") return "error";
  if (status === "running" || status === "skipped") return "warn";
  return "neutral";
});

const refreshMeta = computed(() => {
  if (sources.refresh.error) return sources.refresh.error;
  if (sources.refresh.loading) return "正在读取刷新状态";
  if (!refreshStatus.value) return "暂无刷新状态";
  const generatedAt = dateTime(refreshStatus.value.generatedAt);
  const reason = refreshStatus.value.refresh.error || refreshStatus.value.refresh.reason;
  return reason ? `${generatedAt} · ${reason}` : `生成于 ${generatedAt}`;
});

const sourceCards = computed<AdminSourceCard[]>(() => [
  {
    key: "versionOptions",
    label: "版本清单",
    endpoint: "/api/version-options",
    ...sourcePresentation(sources.versionOptions, versionOptions.value ? `${versionOptions.value.versions.length} 个版本` : "-", versionOptions.value ? `当前 ${currentVersion.value}` : "-"),
  },
  {
    key: "leaderboard",
    label: "榜单快照",
    endpoint: "/api/leaderboard-snapshot",
    ...sourcePresentation(sources.leaderboard, leaderboard.value ? `${integer(leaderboardRows.value)} 行` : "-", leaderboard.value ? `样本 ${integer(snapshotSample.value)} · ${dateTime(leaderboard.value.metadata.updatedAt)}` : "-"),
  },
  {
    key: "tierList",
    label: "TierList 快照",
    endpoint: "/api/tier-list-snapshot",
    ...sourcePresentation(sources.tierList, tierList.value ? `${integer(tierList.value.tierRows.length)} 行` : "-", tierList.value ? `Cluster ${integer(tierList.value.clusterRows.length)} · ${dateTime(tierList.value.metadata.updatedAt)}` : "-"),
  },
  {
    key: "battleFestival",
    label: "战祭快照",
    endpoint: "/api/battle-festival-snapshot",
    ...sourcePresentation(sources.battleFestival, battleFestival.value ? `${integer(battleFestival.value.tierRows.length)} 行` : "-", battleFestival.value ? `样本 ${integer(battleFestival.value.metadata.sampleSize)} · ${dateTime(battleFestival.value.metadata.updatedAt)}` : "-"),
  },
  {
    key: "matchSearch",
    label: "对局索引",
    endpoint: "/api/match-search-options",
    ...sourcePresentation(sources.matchSearch, matchSearch.value ? `${integer(matchCount.value)} 场` : "-", matchSearch.value ? `卡牌 ${integer(matchSearch.value.cards.length)} · 武器 ${integer(matchSearch.value.weapons.length)}` : "-"),
  },
  {
    key: "refresh",
    label: "刷新状态",
    endpoint: "/api/leaderboard-refresh-status",
    ...sourcePresentation(sources.refresh, refreshStatus.value ? `${integer(recentRuns.value.length)} 条 Run` : "-", refreshStatus.value ? `最近生成 ${dateTime(refreshStatus.value.generatedAt)}` : "-"),
  },
]);

async function readSource<T>(source: AdminSourceState<T>, loader: () => Promise<T>): Promise<void> {
  source.loading = true;
  source.error = "";
  try {
    source.data = await loader();
  } catch (caught) {
    source.data = null;
    source.error = caught instanceof Error ? caught.message : "数据读取失败";
  } finally {
    source.loading = false;
  }
}

async function refreshAll(): Promise<void> {
  await Promise.all([
    readSource(sources.versionOptions, loadAdminVersionOptions),
    readSource(sources.leaderboard, loadAdminLeaderboardSnapshot),
    readSource(sources.tierList, loadAdminTierListSnapshot),
    readSource(sources.battleFestival, loadAdminBattleFestivalSnapshot),
    readSource(sources.matchSearch, loadAdminMatchSearchOptions),
    readSource(sources.refresh, loadAdminRefreshStatus),
  ]);
}

function selectSection(section: AdminSection): void {
  activeSection.value = section;
  frameLoaded.value = false;

  const url = new URL(window.location.href);
  if (section === "overview") {
    url.searchParams.delete("section");
    if (sources.versionOptions.loading) void refreshAll();
  } else {
    url.searchParams.set("section", section);
  }
  window.history.replaceState({}, "", url);
}

function reloadFrame(): void {
  frameLoaded.value = false;
  frameRevision.value += 1;
}

function sourcePresentation<T>(source: AdminSourceState<T>, detail: string, meta: string): Omit<AdminSourceCard, "key" | "label" | "endpoint"> {
  if (source.loading) {
    return { status: "读取中", tone: "neutral", detail: "读取中", meta: "正在请求数据", error: "" };
  }
  if (source.error) {
    return { status: "不可用", tone: "error", detail: "读取失败", meta: "请查看错误信息", error: source.error };
  }
  return { status: "已就绪", tone: "ok", detail, meta, error: "" };
}

function statusLabel(value?: string): string {
  const labels: Record<string, string> = {
    completed: "完成",
    failed: "失败",
    ready: "就绪",
    running: "运行中",
    skipped: "已跳过",
    building: "构建中",
  };
  return labels[value || ""] || value || "未知";
}

function displayValue<T>(source: AdminSourceState<T>, value: string): string {
  if (source.loading) return "读取中";
  if (source.error) return "-";
  return value;
}

function periodLabel(dateFrom?: string, dateTo?: string): string {
  return `${dateOnly(dateFrom || "")} - ${dateOnly(dateTo || "")}`;
}

function runPeriod(run: LeaderboardRefreshRun): string {
  return periodLabel(run.dateFrom, run.dateTo);
}

function uploadPeriod(upload: LeaderboardRefreshUpload): string {
  return periodLabel(upload.dateFrom, upload.dateTo);
}

function scopeLabel(value?: string): string {
  const labels: Record<string, string> = {
    tier_list: "TierList",
    battle_festival: "战祭",
  };
  return labels[value || ""] || value || "-";
}

function uploadUserLabel(upload: LeaderboardRefreshUpload): string {
  return upload.contributorName || upload.userPublicId || "-";
}

onMounted(() => {
  if (activeSection.value === "overview") void refreshAll();
});
</script>

<template>
  <CommonHeader current="admin" />
  <main class="Common_PageShell AdminPage">
    <section class="AdminPage_Intro" aria-labelledby="admin-page-title">
      <div>
        <p class="Common_Eyebrow">Webmaster / Maintenance</p>
        <h1 id="admin-page-title">站长管理</h1>
        <p class="AdminPage_IntroNote">数据维护、邀请码、更新与用户行为统一入口。</p>
      </div>
      <div v-if="activeSection === 'overview'" class="AdminPage_RefreshStatus" :data-tone="refreshTone" aria-live="polite">
        <span>刷新状态</span>
        <strong>{{ refreshLabel }}</strong>
        <small>{{ refreshMeta }}</small>
      </div>
      <div v-else class="AdminPage_RefreshStatus" data-tone="neutral">
        <span>当前模块</span>
        <strong>{{ activeTab.label }}</strong>
        <small>维护操作由服务器管理员会话保护</small>
      </div>
      <button v-if="activeSection === 'overview'" class="AdminPage_RefreshButton" type="button" :disabled="isLoading" @click="refreshAll">
        {{ isLoading ? "读取中..." : "重新读取" }}
      </button>
      <a v-else class="AdminPage_RefreshButton" :href="activeFrameSrc" target="_blank" rel="noreferrer">新窗口打开</a>
    </section>

    <nav class="AdminPage_Tabs" aria-label="站长管理模块">
      <button
        v-for="tab in ADMIN_TABS"
        :key="tab.key"
        type="button"
        :aria-current="activeSection === tab.key ? 'page' : undefined"
        @click="selectSection(tab.key)"
      >
        <small>{{ tab.eyebrow }}</small>
        <strong>{{ tab.label }}</strong>
      </button>
    </nav>

    <template v-if="activeSection === 'overview'">
      <section class="AdminPage_MetricGrid" aria-label="核心数据">
      <article class="AdminPage_Metric" :aria-busy="sources.versionOptions.loading">
        <span>当前版本</span>
        <strong>{{ displayValue(sources.versionOptions, currentVersion) }}</strong>
        <small>{{ versionOptions ? `${versionOptions.versions.length} 个可用版本` : "版本清单" }}</small>
      </article>
      <article class="AdminPage_Metric" :aria-busy="sources.leaderboard.loading">
        <span>榜单样本</span>
        <strong>{{ displayValue(sources.leaderboard, integer(snapshotSample)) }}</strong>
        <small>{{ snapshotMetadata ? periodLabel(snapshotMetadata.dateFrom, snapshotMetadata.dateTo) : "当前快照" }}</small>
      </article>
      <article class="AdminPage_Metric" :aria-busy="sources.leaderboard.loading">
        <span>榜单行数</span>
        <strong>{{ displayValue(sources.leaderboard, integer(leaderboardRows)) }}</strong>
        <small>{{ integer(leaderboardClusters) }} 条 Cluster 行</small>
      </article>
      <article class="AdminPage_Metric" :aria-busy="sources.matchSearch.loading">
        <span>可检索对局</span>
        <strong>{{ displayValue(sources.matchSearch, integer(matchCount)) }}</strong>
        <small>含视频 {{ integer(videoMatchCount) }} 场</small>
      </article>
      </section>

      <section class="Common_SectionBlock AdminPage_Section" aria-labelledby="source-title">
      <div class="Common_SectionHeading">
        <div>
          <p class="Common_Eyebrow">Data Sources</p>
          <h2 id="source-title">数据源健康</h2>
        </div>
        <span>{{ sourceCards.filter((item) => item.status === "已就绪").length }} / {{ sourceCards.length }} 就绪</span>
      </div>
      <div class="AdminPage_SourceGrid">
        <article v-for="card in sourceCards" :key="card.key" class="AdminPage_SourceCard" :data-tone="card.tone">
          <div class="AdminPage_SourceHeader">
            <div>
              <p class="Common_Eyebrow">{{ card.endpoint }}</p>
              <h3>{{ card.label }}</h3>
            </div>
            <span class="AdminPage_StatusBadge">{{ card.status }}</span>
          </div>
          <strong class="AdminPage_SourceDetail">{{ card.detail }}</strong>
          <small>{{ card.meta }}</small>
          <p v-if="card.error" class="AdminPage_SourceError">{{ card.error }}</p>
        </article>
      </div>
      </section>

      <section class="Common_TableCard AdminPage_Section" aria-labelledby="operation-title">
      <div class="Common_SectionHeading">
        <div>
          <p class="Common_Eyebrow">Recent Operations</p>
          <h2 id="operation-title">最近 Run / Upload</h2>
        </div>
        <span v-if="!sources.refresh.loading">{{ recentRuns.length + recentUploads.length }} 条</span>
      </div>
      <p v-if="sources.refresh.loading" class="AdminPage_Empty">正在读取刷新记录...</p>
      <p v-else-if="sources.refresh.error" class="AdminPage_Empty AdminPage_Empty_Error">{{ sources.refresh.error }}</p>
      <div v-else class="AdminPage_OperationGrid">
        <div class="AdminPage_TableViewport">
          <h3>最近 Upload</h3>
          <table class="Common_TableLayout AdminPage_Table">
            <thead>
              <tr>
                <th>ID</th>
                <th>用户</th>
                <th>Scope</th>
                <th>日期</th>
                <th>状态</th>
                <th>导入</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="upload in recentUploads" :key="`upload-${upload.id}`">
                <td class="AdminPage_Number">#{{ upload.id }}</td>
                <td class="AdminPage_User">{{ uploadUserLabel(upload) }}</td>
                <td>{{ scopeLabel(upload.modeScope) }}</td>
                <td>{{ uploadPeriod(upload) }}</td>
                <td>{{ statusLabel(upload.status) }}</td>
                <td class="AdminPage_Number">{{ integer(upload.importedMatchCount) }} / {{ integer(upload.matchCount) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!recentUploads.length" class="AdminPage_Empty">暂无 Upload 记录</p>
        </div>

        <div class="AdminPage_TableViewport">
          <h3>最近 Run</h3>
          <table class="Common_TableLayout AdminPage_Table">
            <thead>
              <tr>
                <th>ID</th>
                <th>版本</th>
                <th>Scope</th>
                <th>日期</th>
                <th>状态</th>
                <th>样本</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="run in recentRuns" :key="`run-${run.id}`">
                <td class="AdminPage_Number">#{{ run.id }}</td>
                <td>{{ run.targetVersion || "-" }}</td>
                <td>{{ scopeLabel(run.modeScope) }}</td>
                <td>{{ runPeriod(run) }}</td>
                <td>{{ statusLabel(run.status) }}</td>
                <td class="AdminPage_Number">{{ integer(run.sideSampleCount) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="!recentRuns.length" class="AdminPage_Empty">暂无 Run 记录</p>
        </div>
      </div>
      </section>

      <section class="Common_SectionBlock AdminPage_Section" aria-labelledby="quick-link-title">
      <div class="Common_SectionHeading">
        <div>
          <p class="Common_Eyebrow">Quick Links</p>
          <h2 id="quick-link-title">快捷入口</h2>
        </div>
      </div>
      <nav class="AdminPage_LinkGrid" aria-label="管理员快捷入口">
        <a v-for="link in ADMIN_QUICK_LINKS" :key="link.href" class="AdminPage_QuickLink" :href="link.href">
          <span>{{ link.label }}</span>
          <span aria-hidden="true">↗</span>
        </a>
      </nav>
      </section>
    </template>

    <section v-else class="Common_SectionBlock AdminPage_FrameSection" aria-labelledby="admin-frame-title">
      <div class="Common_SectionHeading">
        <div>
          <p class="Common_Eyebrow">{{ activeTab.eyebrow }}</p>
          <h2 id="admin-frame-title">{{ activeTab.label }}</h2>
        </div>
        <button class="AdminPage_FrameReload" type="button" @click="reloadFrame">重新加载</button>
      </div>
      <p class="AdminPage_FrameNote">{{ activeTab.description }} 未登录时会先显示服务器管理员登录页。</p>
      <div class="AdminPage_FrameShell" :aria-busy="!frameLoaded">
        <p v-if="!frameLoaded" class="AdminPage_FrameLoading">正在载入 {{ activeTab.label }}...</p>
        <iframe
          :key="frameRevision"
          :src="activeFrameSrc"
          :title="`${activeTab.label}服务器管理页`"
          @load="frameLoaded = true"
        />
      </div>
      <p class="AdminPage_FrameFallback">
        页面若被浏览器拦截，请使用上方“新窗口打开”；登录和写入仍由服务器端校验。
      </p>
    </section>
  </main>
</template>

<style scoped>
.AdminPage {
  padding-top: var(--space-lg);
}

.AdminPage_Intro {
  min-height: 144px;
  padding: var(--space-lg);
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px auto;
  align-items: center;
  gap: var(--space-lg);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}

.AdminPage_Intro h1 {
  margin-bottom: var(--space-sm);
  font-size: var(--h1-size);
  line-height: 1.15;
}

.AdminPage_IntroNote {
  margin-bottom: 0;
  color: var(--color-muted);
}

.AdminPage_RefreshStatus {
  min-width: 0;
  padding-left: var(--space-lg);
  border-left: 1px solid var(--color-border);
}

.AdminPage_RefreshStatus span,
.AdminPage_RefreshStatus small {
  display: block;
  color: var(--color-muted);
  font-family: var(--font-control);
}

.AdminPage_RefreshStatus span {
  font-size: var(--font-size-sm);
  font-weight: 700;
}

.AdminPage_RefreshStatus strong {
  display: block;
  margin: var(--space-xs) 0;
  color: var(--color-brown);
  font-family: var(--font-number);
  font-size: var(--font-size-lg);
}

.AdminPage_RefreshStatus[data-tone="error"] strong,
.AdminPage_RefreshStatus[data-tone="error"] small {
  color: var(--color-primary);
}

.AdminPage_RefreshStatus[data-tone="warn"] strong {
  color: var(--color-gold);
}

.AdminPage_RefreshButton {
  min-height: 44px;
  padding: 0 var(--space-lg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-md);
  color: var(--color-panel-strong);
  background: var(--color-primary);
  font-family: var(--font-control);
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
}

.AdminPage_RefreshButton:hover {
  background: var(--color-red-dark);
}

.AdminPage_RefreshButton:active {
  transform: translateY(1px);
}

.AdminPage_RefreshButton:disabled {
  cursor: wait;
  opacity: 0.58;
}

.AdminPage_RefreshButton:focus-visible,
.AdminPage_QuickLink:focus-visible,
.AdminPage_Tabs button:focus-visible,
.AdminPage_FrameReload:focus-visible {
  outline: 2px solid var(--color-gold);
  outline-offset: 2px;
}

.AdminPage_Tabs {
  margin-top: var(--space-md);
  padding: var(--space-xs);
  display: flex;
  gap: var(--space-xs);
  overflow-x: auto;
  border: 1px solid var(--color-border);
  background: var(--color-panel);
  box-shadow: var(--shadow-tight);
}

.AdminPage_Tabs button {
  min-width: 132px;
  min-height: 58px;
  padding: var(--space-sm) var(--space-md);
  flex: 1 0 132px;
  border: 0;
  border-bottom: 3px solid transparent;
  color: var(--color-muted);
  background: transparent;
  text-align: left;
}

.AdminPage_Tabs button:hover {
  color: var(--color-brown);
  background: var(--color-panel-strong);
}

.AdminPage_Tabs button[aria-current="page"] {
  border-bottom-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-panel-strong);
}

.AdminPage_Tabs small,
.AdminPage_Tabs strong {
  display: block;
  font-family: var(--font-control);
}

.AdminPage_Tabs small {
  margin-bottom: 2px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.AdminPage_Tabs strong {
  font-size: var(--font-size-md);
}

.AdminPage_MetricGrid {
  margin-top: var(--space-lg);
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-md);
}

.AdminPage_Metric {
  min-width: 0;
  padding: var(--space-md);
  border: 1px solid var(--color-border);
  background: var(--color-panel);
  box-shadow: var(--shadow-tight);
}

.AdminPage_Metric span,
.AdminPage_Metric small {
  display: block;
  color: var(--color-muted);
  font-family: var(--font-control);
}

.AdminPage_Metric span {
  font-size: var(--font-size-sm);
  font-weight: 700;
}

.AdminPage_Metric strong {
  display: block;
  margin: var(--space-xs) 0;
  overflow: hidden;
  color: var(--color-brown);
  font-family: var(--font-number);
  font-size: var(--font-size-xl);
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.AdminPage_Section {
  margin-top: var(--space-lg);
}

.AdminPage_SourceGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-md);
}

.AdminPage_SourceCard {
  min-width: 0;
  min-height: 164px;
  padding: var(--space-md);
  border: 1px solid var(--color-border);
  background: var(--color-panel-strong);
}

.AdminPage_SourceCard[data-tone="ok"] {
  border-color: var(--color-gold);
}

.AdminPage_SourceCard[data-tone="error"] {
  border-color: var(--color-primary);
}

.AdminPage_SourceHeader {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--space-md);
}

.AdminPage_SourceHeader .Common_Eyebrow {
  margin-bottom: var(--space-xs);
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.AdminPage_SourceHeader h3,
.AdminPage_TableViewport h3 {
  margin: 0;
  color: var(--color-brown);
  font-family: var(--font-control);
  font-size: var(--card-title-size);
  line-height: 1.25;
}

.AdminPage_StatusBadge {
  flex: 0 0 auto;
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--color-gold-soft);
  border-radius: var(--radius-sm);
  color: var(--color-brown);
  background: var(--color-gold-soft);
  font-family: var(--font-control);
  font-size: var(--font-size-sm);
  font-weight: 700;
  white-space: nowrap;
}

.AdminPage_SourceCard[data-tone="error"] .AdminPage_StatusBadge {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-panel);
}

.AdminPage_SourceDetail {
  display: block;
  margin-top: var(--space-lg);
  color: var(--color-brown);
  font-family: var(--font-number);
  font-size: var(--font-size-lg);
}

.AdminPage_SourceCard small {
  display: block;
  margin-top: var(--space-xs);
  color: var(--color-muted);
}

.AdminPage_SourceError {
  margin: var(--space-md) 0 0;
  color: var(--color-primary);
  font-size: var(--font-size-sm);
  overflow-wrap: anywhere;
}

.AdminPage_OperationGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-lg);
}

.AdminPage_TableViewport {
  min-width: 0;
  overflow-x: auto;
}

.AdminPage_TableViewport h3 {
  margin-bottom: var(--space-md);
}

.AdminPage_Table {
  min-width: 660px;
}

.AdminPage_Table th,
.AdminPage_Table td {
  white-space: nowrap;
}

.AdminPage_Table th:nth-child(1),
.AdminPage_Table td:nth-child(1) {
  width: 64px;
}

.AdminPage_Table th:nth-last-child(1),
.AdminPage_Table td:nth-last-child(1) {
  text-align: right;
}

.AdminPage_Number {
  color: var(--color-brown);
  font-family: var(--font-number);
  text-align: right;
}

.AdminPage_User {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.AdminPage_Empty {
  margin: var(--space-md) 0 0;
  color: var(--color-muted);
}

.AdminPage_Empty_Error {
  color: var(--color-primary);
}

.AdminPage_LinkGrid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-md);
}

.AdminPage_QuickLink {
  min-height: 42px;
  padding: 0 var(--space-md);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-brown);
  background: var(--color-panel);
  font-family: var(--font-control);
  font-weight: 700;
}

.AdminPage_QuickLink:hover {
  border-color: var(--color-gold);
  color: var(--color-primary);
  background: var(--color-panel-strong);
}

.AdminPage_FrameSection {
  margin-top: var(--space-lg);
}

.AdminPage_FrameNote,
.AdminPage_FrameFallback {
  color: var(--color-muted);
}

.AdminPage_FrameNote {
  margin: 0 0 var(--space-md);
}

.AdminPage_FrameFallback {
  margin: var(--space-sm) 0 0;
  font-size: var(--font-size-sm);
}

.AdminPage_FrameReload {
  min-height: 42px;
  padding: 0 var(--space-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-brown);
  background: var(--color-panel);
  font-family: var(--font-control);
  font-weight: 700;
}

.AdminPage_FrameReload:hover {
  border-color: var(--color-gold);
  color: var(--color-primary);
}

.AdminPage_FrameShell {
  position: relative;
  min-height: 760px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  background: var(--color-panel-strong);
}

.AdminPage_FrameShell iframe {
  width: 100%;
  height: 760px;
  display: block;
  border: 0;
  background: var(--color-panel-strong);
}

.AdminPage_FrameLoading {
  position: absolute;
  inset: 0;
  z-index: 1;
  margin: 0;
  display: grid;
  place-items: center;
  color: var(--color-muted);
  background: var(--color-panel-strong);
  font-family: var(--font-control);
  font-weight: 700;
}

@media (max-width: 1024px) {
  .AdminPage_Intro {
    grid-template-columns: minmax(0, 1fr) 190px;
  }

  .AdminPage_RefreshButton {
    grid-column: 2;
    grid-row: 1;
  }

  .AdminPage_MetricGrid,
  .AdminPage_SourceGrid,
  .AdminPage_LinkGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .AdminPage_Intro {
    min-height: 0;
    grid-template-columns: 1fr;
    gap: var(--space-md);
  }

  .AdminPage_RefreshStatus {
    padding: var(--space-md) 0 0;
    border-top: 1px solid var(--color-border);
    border-left: 0;
  }

  .AdminPage_RefreshButton {
    grid-column: auto;
    grid-row: auto;
    width: 100%;
  }

  .AdminPage_MetricGrid,
  .AdminPage_SourceGrid,
  .AdminPage_OperationGrid,
  .AdminPage_LinkGrid {
    grid-template-columns: 1fr;
  }

  .AdminPage_Metric strong {
    font-size: var(--font-size-lg);
  }

  .AdminPage_Tabs {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    overflow: visible;
  }

  .AdminPage_Tabs button {
    min-width: 0;
    padding: var(--space-sm) 5px;
    font-size: 14px;
  }

  .AdminPage_Tabs small {
    font-size: 9px;
    letter-spacing: 0.02em;
  }

  .AdminPage_FrameShell,
  .AdminPage_FrameShell iframe {
    min-height: 680px;
    height: 680px;
  }
}
</style>
