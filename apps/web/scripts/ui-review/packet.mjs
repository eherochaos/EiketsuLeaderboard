import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DESIGN_DOCS,
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

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function runGit(args) {
  return new Promise((resolveGit) => {
    execFile("git", args, { cwd: paths.repoRoot, encoding: "utf8" }, (error, stdout, stderr) => {
      resolveGit((stdout || stderr || error?.message || "").trim());
    });
  });
}

function normalizeRect(rect = {}) {
  return {
    x: Math.max(0, Math.round(Number(rect.x) || 0)),
    y: Math.max(0, Math.round(Number(rect.y) || 0)),
    width: Math.max(0, Math.round(Number(rect.width) || 0)),
    height: Math.max(0, Math.round(Number(rect.height) || 0))
  };
}

export function normalizeAnnotations(payload, runId) {
  const annotations = Array.isArray(payload?.annotations) ? payload.annotations : [];
  return {
    schemaVersion: UI_REVIEW_SCHEMA_VERSION,
    runId,
    updatedAt: new Date().toISOString(),
    annotations: annotations.map((item, index) => ({
      annotationId: String(item.annotationId || `annotation-${index + 1}`),
      screenshotId: String(item.screenshotId || ""),
      rect: normalizeRect(item.rect),
      severity: ["P0", "P1", "P2", "P3"].includes(item.severity) ? item.severity : "P2",
      category: String(item.category || "违规实现"),
      component: String(item.component || "").trim(),
      rule: String(item.rule || "").trim(),
      note: String(item.note || "").trim(),
      decision: String(item.decision || "需要修复"),
      createdAt: String(item.createdAt || new Date().toISOString()),
      updatedAt: String(item.updatedAt || new Date().toISOString())
    }))
  };
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") throw new Error("manifest must be an object");
  if (!manifest.runId) throw new Error("manifest.runId is required");
  if (!Array.isArray(manifest.screenshots)) throw new Error("manifest.screenshots must be an array");
  for (const screenshot of manifest.screenshots) {
    if (!screenshot.id) throw new Error("screenshot.id is required");
    if (!screenshot.screenshotPath) throw new Error(`screenshotPath is required: ${screenshot.id}`);
  }
  return true;
}

function annotationMarkdown(annotations) {
  if (!annotations.annotations.length) return "暂无人工标注。";
  const rows = annotations.annotations.map((item) => [
    item.screenshotId,
    item.severity,
    item.category,
    item.component || "-",
    item.rule || "-",
    `x=${item.rect.x}, y=${item.rect.y}, w=${item.rect.width}, h=${item.rect.height}`,
    item.decision,
    (item.note || "-").replace(/\|/g, "/")
  ]);
  return [
    "| 截图 | 严重度 | 分类 | 组件 | 规则 | 区域 | 决策 | 说明 |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}

function screenshotMarkdown(manifest, runDir) {
  return manifest.screenshots.map((shot) => {
    const absolutePath = resolve(runDir, shot.screenshotPath);
    const consoleCount = shot.consoleErrors?.length || 0;
    const networkCount = shot.networkFailures?.length || 0;
    const overflow = shot.checks?.horizontalOverflow ? "yes" : "no";
    const imageFailures = shot.checks?.imageFailures?.length || 0;
    return [
      `### ${shot.id}`,
      `- 页面：${shot.pageLabel} ${shot.path}`,
      `- 场景：${shot.scenario?.label || shot.scenario?.id || "-"}`,
      `- 视口：${shot.viewport?.label || `${shot.viewport?.width}x${shot.viewport?.height}`}`,
      `- console error：${consoleCount}`,
      `- failed request：${networkCount}`,
      `- 横向溢出：${overflow}`,
      `- 图片失败：${imageFailures}`,
      `![${shot.id}](${absolutePath.replace(/\\/g, "/")})`
    ].join("\n");
  }).join("\n\n");
}

function checksMarkdown(manifest) {
  const rows = manifest.screenshots.map((shot) => [
    shot.id,
    shot.consoleErrors?.length || 0,
    shot.networkFailures?.length || 0,
    shot.checks?.horizontalOverflow ? "yes" : "no",
    shot.checks?.imageFailures?.length || 0,
    shot.checks?.keyElements?.navigationVisible ? "yes" : "no",
    shot.checks?.keyElements?.mainHeadingVisible ? "yes" : "no"
  ]);
  return [
    "| 截图 | console error | failed request | 横向溢出 | 图片失败 | 导航可见 | H1可见 |",
    "|---|---:|---:|---|---:|---|---|",
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}

function docsMarkdown(docs) {
  return docs.map((doc) => {
    const content = doc.content.trim();
    return [
      `## ${doc.path}`,
      content ? content.slice(0, 6000) : "文件不存在或为空。"
    ].join("\n");
  }).join("\n\n");
}

function reportTemplate() {
  return `# UI一致性审查报告

## 1. 审查范围
- 涉及文件：
- 涉及界面：
- 涉及组件：

## 2. 组件一致性问题
| 组件 | 路径 | 问题 | 严重度 | 建议 |
|---|---|---|---|---|

## 3. 布局一致性问题
| 位置 | 问题 | 违反规则 | 建议 |
|---|---|---|---|

## 4. 交互一致性问题
| 组件 | 问题 | 影响 | 建议 |
|---|---|---|---|

## 5. 未授权组件变体
| 组件 | 异常点 | 可能原因 | 建议归类 |
|---|---|---|---|

## 6. 需要设计师确认
| 问题 | 可选决策 |
|---|---|

## 7. 最终结论
符合规范：X项
合法变体：X项
疑似新规范：X项
违规实现：X项

## 8. 是否建议阻塞合入
结论：
- 阻塞 / 不阻塞

理由：`;
}

export async function buildReviewInput({ manifest, annotations, docs, gitStatus, gitDiffStat, runDir }) {
  validateManifest(manifest);
  const normalizedAnnotations = normalizeAnnotations(annotations, manifest.runId);
  return `# Codex UI一致性审查输入

只输出 UI一致性审查报告，不直接修改代码。

## Run

- runId: ${manifest.runId}
- generatedAt: ${manifest.generatedAt}
- webOrigin: ${manifest.webOrigin}
- apiOrigin: ${manifest.apiOrigin}

## Git

### status

\`\`\`text
${gitStatus || "-"}
\`\`\`

### diff stat

\`\`\`text
${gitDiffStat || "-"}
\`\`\`

## 自动检查

${checksMarkdown(manifest)}

## 人工标注

${annotationMarkdown(normalizedAnnotations)}

## 截图

${screenshotMarkdown(manifest, runDir)}

## 设计规则

${docsMarkdown(docs)}

## 输出格式

\`\`\`markdown
${reportTemplate()}
\`\`\`
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = args.runId || await latestRunId();
  if (!runId) throw new Error("no ui review run found");
  const runDir = resolve(paths.outputRoot, runId);
  const manifest = await readJson(resolve(runDir, "manifest.json"), null);
  const annotations = normalizeAnnotations(await readJson(resolve(runDir, "annotations.json"), {}), runId);
  const docs = await Promise.all(DESIGN_DOCS.map(async (path) => ({
    path,
    content: await readOptionalText(resolve(paths.repoRoot, path))
  })));
  const gitStatus = await runGit(["status", "--short"]);
  const gitDiffStat = await runGit(["diff", "--stat"]);
  const reviewInput = await buildReviewInput({ manifest, annotations, docs, gitStatus, gitDiffStat, runDir });
  await writeFile(resolve(runDir, "annotations.json"), `${JSON.stringify(annotations, null, 2)}\n`, "utf8");
  await writeFile(resolve(runDir, "review-input.md"), reviewInput, "utf8");
  await writeFile(resolve(runDir, "report.md"), `${reportTemplate()}\n`, { encoding: "utf8", flag: "wx" }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  console.log(`[ui-review] wrote ${resolve(runDir, "review-input.md")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
