import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  UI_REVIEW_SCHEMA_VERSION,
  latestRunDirName,
  pathsFromMetaUrl
} from "./config.mjs";

const paths = pathsFromMetaUrl(import.meta.url);

function parseArgs(values) {
  const result = {};
  for (const value of values) {
    const match = /^--([^=]+)=(.*)$/.exec(value);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

async function latestRunId() {
  const names = await readdir(paths.outputRoot).catch(() => []);
  return latestRunDirName(names);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function safeText(value, maxLength = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function rectFrom(value = {}) {
  return {
    x: Math.max(0, Math.round(Number(value.x) || 0)),
    y: Math.max(0, Math.round(Number(value.y) || 0)),
    width: Math.max(0, Math.round(Number(value.width) || 0)),
    height: Math.max(0, Math.round(Number(value.height) || 0))
  };
}

function componentName(item = {}) {
  const className = safeText(item.className, 160);
  const match = className.match(/(?:Common|MatchSearch|TierPage|Leaderboard|AdminStats)_[A-Za-z0-9_-]+/);
  if (match) return match[0];
  return item.role || item.tag || item.kind || "page";
}

function isMobileShot(shot) {
  return Number(shot.viewport?.width || 9999) <= 760;
}

function titleFromElement(item, fallback) {
  const label = safeText(item.label || item.text);
  const component = componentName(item);
  return label ? `${component}: ${label}` : `${component}: ${fallback}`;
}

function uniqueBy(items, keyFn, limit) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function urlWithoutQuery(url = "") {
  return String(url).split("?")[0];
}

function isImageRequest(url = "") {
  return /image\.eiketsu-taisen\.net|\.png$|\.jpe?g$|\.webp$/i.test(urlWithoutQuery(url));
}

function normalizeFinding(item, index, runId) {
  const status = ["open", "confirmed", "false-positive", "variant", "new-standard", "needs-decision"].includes(item.status)
    ? item.status
    : "needs-decision";
  return {
    findingId: String(item.findingId || `finding-${index + 1}`),
    runId,
    screenshotId: String(item.screenshotId || ""),
    source: String(item.source || "auto"),
    severity: ["P0", "P1", "P2", "P3"].includes(item.severity) ? item.severity : "P2",
    category: ["符合规范", "合法变体", "疑似新规范", "违规实现"].includes(item.category) ? item.category : "违规实现",
    component: safeText(item.component || "page", 80),
    rule: safeText(item.rule || "visual", 80),
    title: safeText(item.title || "候选 UI 问题", 120),
    detail: safeText(item.detail || "", 360),
    rect: rectFrom(item.rect),
    status,
    decision: safeText(item.decision || "需要判断", 80),
    createdAt: String(item.createdAt || new Date().toISOString()),
    updatedAt: String(item.updatedAt || new Date().toISOString())
  };
}

export function normalizeFindings(payload, runId) {
  const findings = Array.isArray(payload?.findings) ? payload.findings : [];
  return {
    schemaVersion: UI_REVIEW_SCHEMA_VERSION,
    runId,
    generatedAt: String(payload?.generatedAt || new Date().toISOString()),
    findings: findings.map((item, index) => normalizeFinding(item, index, runId))
  };
}

function normalizeTheme(item, index, runId) {
  const status = ["open", "confirmed", "false-positive", "variant", "new-standard", "needs-decision"].includes(item.status)
    ? item.status
    : "needs-decision";
  return {
    themeId: String(item.themeId || `theme-${index + 1}`),
    runId,
    source: String(item.source || "auto"),
    severity: ["P0", "P1", "P2", "P3"].includes(item.severity) ? item.severity : "P2",
    category: ["符合规范", "合法变体", "疑似新规范", "违规实现"].includes(item.category) ? item.category : "违规实现",
    component: safeText(item.component || "page", 80),
    rule: safeText(item.rule || "visual", 80),
    title: safeText(item.title || "候选 UI 主题", 120),
    detail: safeText(item.detail || "", 420),
    status,
    decision: safeText(item.decision || "需要判断", 80),
    evidenceCount: Math.max(0, Math.round(Number(item.evidenceCount) || 0)),
    findingIds: Array.isArray(item.findingIds) ? item.findingIds.map(String).slice(0, 200) : [],
    screenshotIds: Array.isArray(item.screenshotIds) ? item.screenshotIds.map(String).slice(0, 80) : [],
    createdAt: String(item.createdAt || new Date().toISOString()),
    updatedAt: String(item.updatedAt || new Date().toISOString())
  };
}

export function normalizeThemes(payload, runId) {
  const themes = Array.isArray(payload?.themes) ? payload.themes : [];
  return {
    schemaVersion: UI_REVIEW_SCHEMA_VERSION,
    runId,
    generatedAt: String(payload?.generatedAt || new Date().toISOString()),
    themes: themes.map((item, index) => normalizeTheme(item, index, runId))
  };
}

function createFinding(shot, rule, partial) {
  const idBase = `${shot.id}__${rule}`;
  const key = partial.findingKey ?? "main";
  return {
    findingId: `${idBase}__${key}`,
    runId: shot.runId || "",
    screenshotId: shot.id,
    source: "auto",
    category: "违规实现",
    status: "needs-decision",
    decision: "需要判断",
    rule,
    rect: { x: 0, y: 0, width: shot.viewport?.width || 0, height: Math.min(80, shot.viewport?.height || 80) },
    ...partial
  };
}

function findingsFromChecks(shot) {
  const findings = [];
  const consoleErrors = uniqueBy(shot.consoleErrors || [], (message) => safeText(message, 220), 2);
  for (const [index, message] of consoleErrors.entries()) {
    findings.push(createFinding(shot, "console-error", {
      findingKey: index,
      severity: "P0",
      component: "page",
      title: "控制台出现 error",
      detail: safeText(message, 280)
    }));
  }
  const allNetworkFailures = shot.networkFailures || [];
  const imageNetworkFailures = allNetworkFailures.filter((request) => isImageRequest(request.url));
  if (imageNetworkFailures.length) {
    findings.push(createFinding(shot, "network-failure", {
      findingKey: "image-assets",
      severity: "P1",
      component: "image-assets",
      title: "外部图片资源请求失败",
      detail: `图片请求失败 ${imageNetworkFailures.length} 个，样例：${safeText(imageNetworkFailures[0]?.url, 180)}`
    }));
  }
  const networkFailures = uniqueBy(allNetworkFailures.filter((request) => !isImageRequest(request.url)), (request) => urlWithoutQuery(request.url), 3);
  for (const [index, request] of networkFailures.entries()) {
    findings.push(createFinding(shot, "network-failure", {
      findingKey: index,
      severity: "P1",
      component: "page",
      title: "页面请求失败",
      detail: safeText(`${request.failure || "request failed"} ${request.url || ""}`, 280)
    }));
  }
  const responseFailures = uniqueBy(shot.responseFailures || [], (response) => `${response.status}:${urlWithoutQuery(response.url)}`, 5);
  for (const [index, response] of responseFailures.entries()) {
    findings.push(createFinding(shot, "http-error", {
      findingKey: index,
      severity: response.status >= 500 ? "P1" : "P2",
      component: "page-request",
      title: "页面请求返回错误状态",
      detail: `${response.status} ${response.statusText || ""} ${safeText(response.url, 220)}`
    }));
  }
  const imageFailures = uniqueBy(shot.checks?.imageFailures || [], (image) => urlWithoutQuery(image.src) || image.className || image.alt, 40);
  if (imageFailures.length) {
    const image = imageFailures[0];
    findings.push(createFinding(shot, "image-failure", {
      findingKey: "image-assets",
      severity: "P1",
      component: componentName(image),
      title: "图片加载失败",
      detail: `图片失败 ${imageFailures.length} 个，样例：${safeText(image.alt || image.className || image.src, 180)}`
    }));
  }
  if (shot.checks?.horizontalOverflow) {
    findings.push(createFinding(shot, "horizontal-overflow", {
      severity: isMobileShot(shot) ? "P1" : "P2",
      component: "page",
      title: "页面存在横向溢出",
      detail: `documentWidth=${shot.checks.documentWidth}, scrollWidth=${shot.checks.scrollWidth}`
    }));
  }
  if (shot.checks?.keyElements && !shot.checks.keyElements.navigationVisible) {
    findings.push(createFinding(shot, "missing-navigation", {
      severity: "P1",
      component: "navigation",
      title: "导航首屏不可见",
      detail: "截图中没有可见 header 或 nav。"
    }));
  }
  if (shot.checks?.keyElements && !shot.checks.keyElements.mainHeadingVisible) {
    findings.push(createFinding(shot, "missing-heading", {
      severity: "P1",
      component: "heading",
      title: "主标题首屏不可见",
      detail: "截图中没有可见 h1。"
    }));
  }
  return findings;
}

function findingsFromVisualSignals(shot) {
  const findings = [];
  const signals = shot.visualSignals || {};
  const minTargetSize = isMobileShot(shot) ? 44 : 32;

  const smallTargets = [];
  for (const [index, control] of (signals.controls || []).entries()) {
    const rect = rectFrom(control.rect);
    if (control.disabled) continue;
    if (!isMobileShot(shot) && control.tag === "a") continue;
    if (rect.width > 0 && rect.height > 0 && (rect.width < minTargetSize || rect.height < minTargetSize)) {
      smallTargets.push(createFinding(shot, "small-target", {
        findingKey: index,
        severity: isMobileShot(shot) ? "P2" : "P3",
        component: componentName(control),
        title: "可点击区域偏小",
        detail: `${titleFromElement(control, "control")} 尺寸 ${rect.width}x${rect.height}，低于 ${minTargetSize}px。`,
        rect
      }));
    }
  }
  findings.push(...smallTargets.slice(0, isMobileShot(shot) ? 5 : 2));

  const textOverflow = (signals.textOverflow || []).filter((item) => {
    const component = componentName(item);
    const rect = rectFrom(item.rect);
    const widthDelta = Number(item.scrollWidth || 0) - Number(item.clientWidth || 0);
    const heightDelta = Number(item.scrollHeight || 0) - Number(item.clientHeight || 0);
    if (component.startsWith("Common_ImageFrame")) return false;
    if (component.startsWith("Common_DeckRail")) return false;
    if (safeText(item.label).length <= 2) return false;
    if (rect.width <= 0 || rect.height <= 0) return false;
    return widthDelta > 8 || heightDelta > 8;
  }).slice(0, 10);
  for (const [index, item] of textOverflow.entries()) {
    findings.push(createFinding(shot, "text-overflow", {
      findingKey: index,
      severity: "P2",
      component: componentName(item),
      title: "文本发生溢出或裁切",
      detail: `${titleFromElement(item, "text")} client=${item.clientWidth}x${item.clientHeight}, scroll=${item.scrollWidth}x${item.scrollHeight}`,
      rect: rectFrom(item.rect)
    }));
  }

  for (const [index, item] of (signals.largeEmptyContainers || []).slice(0, 4).entries()) {
    findings.push(createFinding(shot, "large-empty-container", {
      findingKey: index,
      severity: "P3",
      component: componentName(item),
      title: "候选大块空白容器",
      detail: `${titleFromElement(item, "container")} childCoverage=${item.childCoverage}`,
      rect: rectFrom(item.rect)
    }));
  }

  const overlaps = (signals.overlaps || []).filter((item) => {
    const aComponent = componentName(item.a || {});
    const bComponent = componentName(item.b || {});
    if (aComponent.startsWith("Common_ImageFrame") && bComponent.startsWith("Common_ImageFrame")) return false;
    return true;
  }).slice(0, 8);
  for (const [index, item] of overlaps.entries()) {
    const a = item.a || {};
    const b = item.b || {};
    findings.push(createFinding(shot, "element-overlap", {
      findingKey: index,
      severity: "P2",
      component: `${componentName(a)} / ${componentName(b)}`,
      title: "元素疑似重叠",
      detail: `${titleFromElement(a, "A")} 与 ${titleFromElement(b, "B")} overlapArea=${item.overlapArea}`,
      rect: rectFrom(a.rect)
    }));
  }

  return findings;
}

function pageFamilyFromScreenshotId(screenshotId = "") {
  return String(screenshotId).split("__")[0] || "page";
}

function uniqueStrings(values, limit = 80) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = safeText(value, 160);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function severityRank(value) {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[value] ?? 2;
}

function highestSeverity(items) {
  return items.reduce((result, item) => (
    severityRank(item.severity) < severityRank(result) ? item.severity : result
  ), "P3");
}

function themeId(runId, key) {
  const normalizedKey = String(key || "theme")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "theme";
  return `${runId}__theme__${normalizedKey}`;
}

function createTheme(runId, key, partial, findings) {
  return {
    themeId: themeId(runId, key),
    runId,
    source: "auto",
    category: "违规实现",
    status: "needs-decision",
    decision: "需要判断",
    evidenceCount: findings.length,
    findingIds: findings.map((finding) => finding.findingId),
    screenshotIds: uniqueStrings(findings.map((finding) => finding.screenshotId)),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial
  };
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function summarizePages(findings) {
  return uniqueStrings(findings.map((finding) => pageFamilyFromScreenshotId(finding.screenshotId)), 8).join("、");
}

function screenshotIdsWithImageFailures(manifest) {
  const result = new Set();
  for (const shot of manifest.screenshots || []) {
    const hasImageNetworkFailure = (shot.networkFailures || []).some((request) => isImageRequest(request.url));
    const hasImageFailure = Boolean(shot.checks?.imageFailures?.length);
    if (hasImageNetworkFailure || hasImageFailure) result.add(shot.id);
  }
  return result;
}

export function buildThemes(manifest, findingsPayload) {
  const runId = manifest?.runId || findingsPayload?.runId || "";
  const findings = normalizeFindings(findingsPayload, runId).findings;
  const imageShotIds = screenshotIdsWithImageFailures(manifest || {});
  const usedFindingIds = new Set();
  const themes = [];

  const imageFindings = findings.filter((finding) => (
    finding.rule === "image-failure"
    || (finding.rule === "network-failure" && finding.component === "image-assets")
    || (finding.rule === "console-error" && imageShotIds.has(finding.screenshotId))
  ));
  if (imageFindings.length) {
    for (const finding of imageFindings) usedFindingIds.add(finding.findingId);
    themes.push(createTheme(runId, "external-image-assets", {
      severity: "P1",
      component: "image-assets",
      rule: "external-image-failure",
      title: "外部卡图资源在本地审查环境不可达",
      detail: `影响 ${summarizePages(imageFindings)}，共 ${imageFindings.length} 条证据。该主题优先判断为审查环境前置问题；不要把同类图片失败逐条交给用户裁决。`
    }, imageFindings));
  }

  const remaining = findings.filter((finding) => !usedFindingIds.has(finding.findingId));
  const headerTargets = remaining.filter((finding) => (
    finding.rule === "small-target"
    && /Common_Header_Brand|Common_NavPrimary/.test(finding.component)
  ));
  if (headerTargets.length) {
    for (const finding of headerTargets) usedFindingIds.add(finding.findingId);
    themes.push(createTheme(runId, "mobile-header-touch-targets", {
      severity: highestSeverity(headerTargets),
      component: "Common_Header",
      rule: "small-target",
      title: "移动端 Header 点击区偏小",
      detail: `影响 ${summarizePages(headerTargets)}，共 ${headerTargets.length} 条证据。建议作为全站 Header 单独议题处理。`
    }, headerTargets));
  }

  const grouped = groupBy(
    findings.filter((finding) => !usedFindingIds.has(finding.findingId)),
    (finding) => `${pageFamilyFromScreenshotId(finding.screenshotId)}:${finding.rule}`
  );
  for (const [key, group] of grouped.entries()) {
    const [pageFamily, rule] = key.split(":");
    const titles = {
      "console-error": `${pageFamily} 控制台错误`,
      "network-failure": `${pageFamily} 页面请求失败`,
      "http-error": `${pageFamily} API/资源返回错误状态`,
      "small-target": `${pageFamily} 可点击区域偏小`,
      "text-overflow": `${pageFamily} 文本溢出或裁切`,
      "large-empty-container": `${pageFamily} 存在大块空白容器`,
      "element-overlap": `${pageFamily} 元素疑似重叠`,
      "horizontal-overflow": `${pageFamily} 横向溢出`,
      "missing-navigation": `${pageFamily} 首屏导航缺失`,
      "missing-heading": `${pageFamily} 首屏标题缺失`
    };
    themes.push(createTheme(runId, `${pageFamily}-${rule}`, {
      severity: highestSeverity(group),
      component: uniqueStrings(group.map((finding) => finding.component), 3).join(" / ") || "page",
      rule,
      title: titles[rule] || `${pageFamily} ${rule}`,
      detail: `共 ${group.length} 条证据，涉及 ${uniqueStrings(group.map((finding) => finding.screenshotId), 4).join("、")}。`
    }, group));
  }

  const sortedThemes = themes
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.evidenceCount - a.evidenceCount)
    .slice(0, 10);
  return normalizeThemes({
    schemaVersion: UI_REVIEW_SCHEMA_VERSION,
    runId,
    generatedAt: new Date().toISOString(),
    themes: sortedThemes
  }, runId);
}

export function buildFindings(manifest) {
  if (!manifest || !Array.isArray(manifest.screenshots)) {
    throw new Error("manifest.screenshots is required");
  }
  const runId = manifest.runId || "";
  const findings = [];
  for (const shot of manifest.screenshots) {
    findings.push(...findingsFromChecks({ ...shot, runId }));
    findings.push(...findingsFromVisualSignals({ ...shot, runId }));
  }
  return normalizeFindings({
    schemaVersion: UI_REVIEW_SCHEMA_VERSION,
    runId,
    generatedAt: new Date().toISOString(),
    findings
  }, runId);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = args.runId || await latestRunId();
  if (!runId) throw new Error("no ui review run found");
  const runDir = resolve(paths.outputRoot, runId);
  const manifest = await readJson(resolve(runDir, "manifest.json"), null);
  const output = buildFindings(manifest);
  const themes = buildThemes(manifest, output);
  await writeFile(resolve(runDir, "findings.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(resolve(runDir, "themes.json"), `${JSON.stringify(themes, null, 2)}\n`, "utf8");
  console.log(`[ui-review] findings=${output.findings.length}`);
  console.log(`[ui-review] themes=${themes.themes.length}`);
  console.log(`[ui-review] wrote ${resolve(runDir, "findings.json")}`);
  console.log(`[ui-review] wrote ${resolve(runDir, "themes.json")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
