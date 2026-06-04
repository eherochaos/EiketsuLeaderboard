import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const UI_REVIEW_SCHEMA_VERSION = 1;
export const DEFAULT_API_PORT = 8001;
export const DEFAULT_WEB_PORT = 4224;
export const DEFAULT_ANNOTATION_PORT = 4327;

export const VIEWPORTS = [
  { id: "desktop-1440x900", width: 1440, height: 900, label: "1440x900" },
  { id: "mobile-390x844", width: 390, height: 844, label: "390x844" },
  { id: "mobile-430x932", width: 430, height: 932, label: "430x932" }
];

export const REVIEW_PAGES = [
  {
    id: "leaderboard",
    label: "Leaderboard",
    path: "/leaderboard/",
    scenarios: [{ id: "top", label: "首屏" }]
  },
  {
    id: "tier-list",
    label: "TierList",
    path: "/tier-list/",
    scenarios: [
      { id: "top", label: "首屏" },
      { id: "ranking", label: "榜单明细", scrollSelector: ".TierPage_TableCard" }
    ]
  },
  {
    id: "match-search",
    label: "对局搜索",
    path: "/match-search/",
    scenarios: [
      { id: "top", label: "首屏" },
      { id: "card-picker", label: "选卡浮层", action: "open-card-picker" },
      { id: "results", label: "搜索结果", action: "search-results", scrollSelector: ".MatchSearch_ResultPanel" }
    ]
  },
  {
    id: "leaderboard-status",
    label: "数据状态",
    path: "/leaderboard-status/",
    scenarios: [{ id: "top", label: "首屏" }]
  }
];

export const DESIGN_DOCS = [
  "docs/003-web-pages/ui-contract.md",
  "docs/003-web-pages/visual-acceptance.md",
  "docs/003-web-pages/design-tokens.md",
  "docs/003-web-pages/component-contract.md",
  "docs/003-web-pages/page-patterns.md"
];

export function pathsFromMetaUrl(metaUrl) {
  const scriptFile = fileURLToPath(metaUrl);
  const scriptDir = dirname(scriptFile);
  const repoRoot = resolve(scriptDir, "../../../..");
  const webRoot = resolve(repoRoot, "apps/web");
  const apiRoot = resolve(repoRoot, "apps/api");
  const outputRoot = resolve(repoRoot, "output/ui-review");
  return { apiRoot, outputRoot, repoRoot, scriptDir, webRoot };
}

export function createRunId(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function filterByIds(items, ids) {
  if (!ids.length) return items;
  const wanted = new Set(ids);
  return items.filter((item) => wanted.has(item.id));
}

export function latestRunDirName(names) {
  return names
    .filter((name) => /^\d{8}T\d{6}Z$/.test(name))
    .sort()
    .at(-1) || "";
}
