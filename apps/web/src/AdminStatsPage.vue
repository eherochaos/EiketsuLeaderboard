<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import CommonHeader from "./components/Common_Header.vue";
import { dateTime, integer } from "./lib/format";
import { loadSiteAnalyticsSummary } from "./lib/siteAnalytics";
import type { SiteAnalyticsSummary } from "./types";

const tokenStorageKey = "eiketsu.adminStats.token";
const summary = ref<SiteAnalyticsSummary | null>(null);
const token = ref("");
const fromDate = ref(defaultFromDate());
const toDate = ref(todayDate());
const loading = ref(false);
const error = ref("");

const hasToken = computed(() => token.value.trim().length > 0);
const totals = computed(() => summary.value?.totals ?? null);
const generatedAt = computed(() => summary.value ? dateTime(summary.value.generatedAt) : "-");

onMounted(() => {
  token.value = window.sessionStorage.getItem(tokenStorageKey) || "";
  if (hasToken.value) {
    void refreshSummary();
  }
});

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultFromDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  return date.toISOString().slice(0, 10);
}

async function refreshSummary(): Promise<void> {
  if (!hasToken.value) {
    error.value = "请输入管理员密钥";
    return;
  }

  loading.value = true;
  error.value = "";
  try {
    window.sessionStorage.setItem(tokenStorageKey, token.value.trim());
    summary.value = await loadSiteAnalyticsSummary(token.value.trim(), fromDate.value, toDate.value);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "站长统计读取失败";
  } finally {
    loading.value = false;
  }
}

function clearToken(): void {
  window.sessionStorage.removeItem(tokenStorageKey);
  token.value = "";
  summary.value = null;
}
</script>

<template>
  <CommonHeader current="adminStats" />
  <main class="Common_PageShell AdminStatsPage">
    <section class="AdminStatsPage_Hero" aria-labelledby="admin-stats-title">
      <div>
        <p class="Common_Eyebrow">Admin</p>
        <h1 id="admin-stats-title">站长统计</h1>
        <p>匿名访客行为统计，不展示 token、cookie、原始 IP 或完整来源 URL。</p>
      </div>
      <strong v-if="summary">{{ generatedAt }}</strong>
    </section>

    <section class="AdminStatsPage_Control" aria-label="统计查询">
      <label>
        管理员密钥
        <input v-model="token" type="password" autocomplete="current-password" placeholder="SITE_ANALYTICS_ADMIN_TOKEN" @keydown.enter="refreshSummary" />
      </label>
      <label>
        From
        <input v-model="fromDate" type="date" />
      </label>
      <label>
        To
        <input v-model="toDate" type="date" />
      </label>
      <button type="button" :disabled="loading" @click="refreshSummary">{{ loading ? "读取中..." : "刷新" }}</button>
      <button type="button" class="AdminStatsPage_SecondaryButton" @click="clearToken">清除密钥</button>
    </section>

    <section v-if="error" class="Common_StatusPanel Common_StatusPanel_Error">{{ error }}</section>
    <section v-else-if="loading" class="Common_StatusPanel">正在读取站长统计...</section>

    <template v-if="summary && totals">
      <section class="AdminStatsPage_SummaryGrid" aria-label="汇总">
        <article>
          <span>访客</span>
          <strong>{{ integer(totals.visitors) }}</strong>
          <small>匿名 visitorId</small>
        </article>
        <article>
          <span>会话</span>
          <strong>{{ integer(totals.sessions) }}</strong>
          <small>{{ summary.range.from }} - {{ summary.range.to }}</small>
        </article>
        <article>
          <span>事件</span>
          <strong>{{ integer(totals.events) }}</strong>
          <small>页面 + 关键操作</small>
        </article>
        <article>
          <span>页面访问</span>
          <strong>{{ integer(totals.pageViews) }}</strong>
          <small>保留 {{ integer(summary.range.retentionDays) }} 天</small>
        </article>
      </section>

      <section class="AdminStatsPage_Grid">
        <article class="Common_TableCard AdminStatsPage_TableCard">
          <div class="Common_SectionHeading Common_SectionHeading_Compact">
            <div>
              <p class="Common_Eyebrow">Pages</p>
              <h2>页面热度</h2>
            </div>
            <span>{{ integer(summary.pages.length) }} 项</span>
          </div>
          <table class="Common_TableLayout AdminStatsPage_Table">
            <thead>
              <tr>
                <th>页面</th>
                <th>访问</th>
                <th>访客</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in summary.pages" :key="item.page">
                <td>{{ item.page }}</td>
                <td>{{ integer(item.count) }}</td>
                <td>{{ integer(item.visitors) }}</td>
              </tr>
            </tbody>
          </table>
        </article>

        <article class="Common_TableCard AdminStatsPage_TableCard">
          <div class="Common_SectionHeading Common_SectionHeading_Compact">
            <div>
              <p class="Common_Eyebrow">Actions</p>
              <h2>操作排行</h2>
            </div>
            <span>{{ integer(summary.events.length) }} 项</span>
          </div>
          <table class="Common_TableLayout AdminStatsPage_Table">
            <thead>
              <tr>
                <th>事件</th>
                <th>次数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in summary.events" :key="item.eventType">
                <td>{{ item.eventType }}</td>
                <td>{{ integer(item.count) }}</td>
              </tr>
            </tbody>
          </table>
        </article>
      </section>

      <section class="AdminStatsPage_Grid">
        <article class="Common_TableCard AdminStatsPage_TableCard">
          <div class="Common_SectionHeading Common_SectionHeading_Compact">
            <div>
              <p class="Common_Eyebrow">Visitors</p>
              <h2>匿名用户</h2>
            </div>
            <span>{{ integer(summary.visitors.length) }} 位</span>
          </div>
          <table class="Common_TableLayout AdminStatsPage_Table">
            <thead>
              <tr>
                <th>visitorId</th>
                <th>事件</th>
                <th>会话</th>
                <th>常看页面</th>
                <th>最后出现</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in summary.visitors" :key="item.visitorId">
                <td class="AdminStatsPage_Mono">{{ item.visitorId }}</td>
                <td>{{ integer(item.events) }}</td>
                <td>{{ integer(item.sessions) }}</td>
                <td>{{ item.topPage }}</td>
                <td>{{ dateTime(item.lastSeen) }}</td>
              </tr>
            </tbody>
          </table>
        </article>

        <article class="Common_TableCard AdminStatsPage_TableCard">
          <div class="Common_SectionHeading Common_SectionHeading_Compact">
            <div>
              <p class="Common_Eyebrow">Recent</p>
              <h2>最近行为</h2>
            </div>
            <span>{{ integer(summary.recent.length) }} 条</span>
          </div>
          <table class="Common_TableLayout AdminStatsPage_Table">
            <thead>
              <tr>
                <th>时间</th>
                <th>事件</th>
                <th>页面</th>
                <th>目标</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in summary.recent" :key="`${item.occurredAt}-${item.visitorId}-${item.eventType}`">
                <td>{{ dateTime(item.occurredAt) }}</td>
                <td>{{ item.eventType }}</td>
                <td>{{ item.page }}</td>
                <td>{{ item.target || "-" }}</td>
              </tr>
            </tbody>
          </table>
        </article>
      </section>

      <section class="Common_TableCard AdminStatsPage_TableCard">
        <div class="Common_SectionHeading Common_SectionHeading_Compact">
          <div>
            <p class="Common_Eyebrow">Devices</p>
            <h2>设备与时间</h2>
          </div>
        </div>
        <div class="AdminStatsPage_DeviceGrid">
          <article v-for="item in summary.devices" :key="item.deviceType">
            <span>{{ item.deviceType }}</span>
            <strong>{{ integer(item.count) }}</strong>
          </article>
          <article v-for="item in summary.hours" :key="item.hour">
            <span>{{ item.hour }}</span>
            <strong>{{ integer(item.count) }}</strong>
          </article>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.AdminStatsPage {
  padding-top: 18px;
}

.AdminStatsPage_Hero {
  min-height: 132px;
  padding: 20px 28px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-lg);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}

.AdminStatsPage_Hero h1 {
  margin-bottom: 8px;
  color: var(--color-brown);
  font-family: var(--font-serif);
  font-size: 42px;
  line-height: 1.15;
}

.AdminStatsPage_Hero p {
  color: var(--color-muted);
  font-family: var(--font-control);
  font-weight: 700;
}

.AdminStatsPage_Hero strong {
  color: var(--color-gold);
  font-family: var(--font-control);
  font-size: 18px;
}

.AdminStatsPage_Control {
  margin-top: var(--space-md);
  padding: 14px;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 150px 150px auto auto;
  gap: 10px;
  align-items: end;
  border: 1px solid var(--color-border);
  background: rgba(255, 250, 240, 0.82);
}

.AdminStatsPage_Control label {
  display: grid;
  gap: 6px;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}

.AdminStatsPage_Control input,
.AdminStatsPage_Control button {
  min-height: 42px;
  border: 1px solid var(--color-border);
  font-family: var(--font-control);
  font-weight: 900;
}

.AdminStatsPage_Control input {
  padding: 0 12px;
  color: var(--color-ink);
  background: #fffaf0;
}

.AdminStatsPage_Control button {
  padding: 0 18px;
  color: #fffaf0;
  background: var(--color-primary);
}

.AdminStatsPage_Control button:disabled {
  opacity: 0.6;
}

.AdminStatsPage_SecondaryButton {
  color: var(--color-brown) !important;
  background: #fffaf0 !important;
}

.AdminStatsPage_SummaryGrid {
  margin-top: var(--space-md);
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-sm);
}

.AdminStatsPage_SummaryGrid article,
.AdminStatsPage_DeviceGrid article {
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  background: rgba(255, 250, 240, 0.88);
  box-shadow: var(--shadow-card);
}

.AdminStatsPage_SummaryGrid span,
.AdminStatsPage_DeviceGrid span {
  display: block;
  color: var(--color-muted);
  font-family: var(--font-control);
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}

.AdminStatsPage_SummaryGrid strong,
.AdminStatsPage_DeviceGrid strong {
  display: block;
  margin-top: 4px;
  color: var(--color-brown);
  font-family: var(--font-control);
  font-size: 28px;
}

.AdminStatsPage_SummaryGrid small {
  color: var(--color-muted);
  font-family: var(--font-control);
  font-weight: 700;
}

.AdminStatsPage_Grid {
  margin-top: var(--space-md);
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-md);
}

.AdminStatsPage_TableCard {
  overflow: auto;
}

.AdminStatsPage_Table {
  min-width: 460px;
}

.AdminStatsPage_Table th,
.AdminStatsPage_Table td {
  white-space: nowrap;
}

.AdminStatsPage_Mono {
  font-family: Consolas, "SFMono-Regular", monospace;
  font-size: 12px;
}

.AdminStatsPage_DeviceGrid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: var(--space-sm);
}

@media (max-width: 900px) {
  .AdminStatsPage_Control,
  .AdminStatsPage_SummaryGrid,
  .AdminStatsPage_Grid,
  .AdminStatsPage_DeviceGrid {
    grid-template-columns: 1fr;
  }

  .AdminStatsPage_Hero {
    grid-template-columns: 1fr;
    padding: 16px;
  }

  .AdminStatsPage_Hero h1 {
    font-size: 34px;
  }
}
</style>
