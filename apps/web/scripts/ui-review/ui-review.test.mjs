import assert from "node:assert/strict";
import { buildFindings, normalizeFindings } from "./audit.mjs";
import { buildReviewInput, normalizeAnnotations, validateManifest } from "./packet.mjs";

const manifest = {
  schemaVersion: 1,
  runId: "20260604T010203Z",
  generatedAt: "2026-06-04T01:02:03Z",
  webOrigin: "http://127.0.0.1:4224",
  apiOrigin: "http://127.0.0.1:8001",
  screenshots: [
    {
      id: "leaderboard__top__desktop-1440x900",
      pageId: "leaderboard",
      pageLabel: "Leaderboard",
      path: "/leaderboard/",
      scenario: { id: "top", label: "首屏" },
      viewport: { id: "desktop-1440x900", width: 1440, height: 900, label: "1440x900" },
      screenshotPath: "screenshots/leaderboard.png",
      consoleErrors: [],
      networkFailures: [],
      checks: {
        horizontalOverflow: false,
        imageFailures: [],
        keyElements: {
          mainHeadingVisible: true,
          navigationVisible: true
        }
      },
      domSummary: [],
      visualSignals: {
        controls: [
          {
            kind: "control",
            tag: "button",
            className: "Common_Button",
            label: "搜索",
            disabled: false,
            rect: { x: 8, y: 8, width: 28, height: 28 }
          }
        ],
        textOverflow: [
          {
            kind: "text",
            tag: "span",
            className: "MatchSearch_ResultHitNote",
            label: "很长的命中条件",
            rect: { x: 20, y: 30, width: 80, height: 18 },
            clientWidth: 80,
            scrollWidth: 140,
            clientHeight: 18,
            scrollHeight: 18
          }
        ],
        largeEmptyContainers: [],
        overlaps: []
      }
    }
  ]
};

const annotations = normalizeAnnotations({
  annotations: [
    {
      annotationId: "a1",
      screenshotId: "leaderboard__top__desktop-1440x900",
      rect: { x: 10.2, y: 20.8, width: 30.1, height: 40.9 },
      severity: "P1",
      category: "违规实现",
      component: "Common_Button",
      rule: "focus",
      note: "缺少焦点态",
      decision: "需要修复"
    },
    {
      screenshotId: "leaderboard__top__desktop-1440x900",
      rect: { x: -1, y: 0, width: "bad", height: 8 },
      severity: "bad"
    }
  ]
}, manifest.runId);

assert.equal(validateManifest(manifest), true);
assert.equal(annotations.schemaVersion, 1);
assert.equal(annotations.annotations.length, 2);
assert.equal(annotations.annotations[0].rect.x, 10);
assert.equal(annotations.annotations[0].rect.y, 21);
assert.equal(annotations.annotations[1].severity, "P2");
assert.equal(annotations.annotations[1].rect.x, 0);

const findings = buildFindings(manifest);
assert.equal(findings.schemaVersion, 1);
assert.equal(findings.findings.length, 2);
assert.match(findings.findings[0].findingId, /small-target/);
assert.equal(normalizeFindings({ findings: [{ severity: "bad", status: "bad" }] }, manifest.runId).findings[0].severity, "P2");

const reviewInput = await buildReviewInput({
  manifest,
  annotations,
  findings,
  docs: [{ path: "docs/003-web-pages/ui-contract.md", content: "必须使用 spacing scale。" }],
  gitStatus: " M apps/web/src/Foo.vue",
  gitDiffStat: " apps/web/src/Foo.vue | 2 +-",
  runDir: "E:/EiketsuLeaderboard/output/ui-review/20260604T010203Z"
});

assert.match(reviewInput, /Codex UI一致性审查输入/);
assert.match(reviewInput, /UI一致性审查报告/);
assert.match(reviewInput, /自动候选问题/);
assert.match(reviewInput, /可点击区域偏小/);
assert.match(reviewInput, /缺少焦点态/);
assert.match(reviewInput, /leaderboard__top__desktop-1440x900/);

assert.throws(() => validateManifest({ runId: "bad" }), /manifest.screenshots/);

console.log("ui review tests passed");
