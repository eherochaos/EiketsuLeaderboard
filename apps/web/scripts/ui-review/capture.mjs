import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { chromium } from "playwright";
import {
  DEFAULT_API_PORT,
  DEFAULT_WEB_PORT,
  DESIGN_DOCS,
  REVIEW_PAGES,
  UI_REVIEW_SCHEMA_VERSION,
  VIEWPORTS,
  createRunId,
  filterByIds,
  parseList,
  pathsFromMetaUrl
} from "./config.mjs";

const paths = pathsFromMetaUrl(import.meta.url);
const args = parseArgs(process.argv.slice(2));
const runId = args.runId || createRunId();
const outputDir = resolve(paths.outputRoot, runId);
const screenshotDir = resolve(outputDir, "screenshots");
const apiPort = Number(args.apiPort || process.env.UI_REVIEW_API_PORT || DEFAULT_API_PORT);
const webPort = Number(args.webPort || process.env.UI_REVIEW_WEB_PORT || DEFAULT_WEB_PORT);
const apiOrigin = args.apiOrigin || `http://127.0.0.1:${apiPort}`;
const webOrigin = args.webOrigin || `http://127.0.0.1:${webPort}`;
const selectedPages = filterByIds(REVIEW_PAGES, parseList(args.pages));
const selectedViewports = filterByIds(VIEWPORTS, parseList(args.viewports));
const selectedScenarios = parseList(args.scenarios);

function parseArgs(values) {
  const result = {};
  for (const value of values) {
    const match = /^--([^=]+)=(.*)$/.exec(value);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

async function isHttpReady(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    await fetch(url, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHttp(url, label, timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isHttpReady(url)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`${label} is not ready: ${url}`);
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function startProcessIfNeeded(label, readyUrl, command, commandArgs, cwd, env = {}) {
  if (await isHttpReady(readyUrl)) {
    console.log(`[ui-review] reuse ${label}: ${readyUrl}`);
    return null;
  }

  console.log(`[ui-review] start ${label}`);
  const child = spawn(command, commandArgs, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  await waitForHttp(readyUrl, label);
  return child;
}

async function stopProcess(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    await new Promise((resolveStop) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.on("close", resolveStop);
      killer.on("error", resolveStop);
    });
    return;
  }
  child.kill("SIGTERM");
}

async function applyScenario(page, scenario) {
  if (scenario.action === "search-results") {
    await page.locator(".MatchSearch_CardPickerTrigger").first().click({ timeout: 5000 }).catch(() => {});
    await page.locator(".MatchSearch_CardPicker").first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    await page.locator(".MatchSearch_CardPick").first().click({ timeout: 5000 }).catch(() => {});
    await page.locator(".MatchSearch_CardPickerFoot button").first().click({ timeout: 5000 }).catch(() => {});
    await page.locator(".MatchSearch_SearchButton").first().click({ timeout: 5000 }).catch(() => {});
    await page.locator(".MatchSearch_ResultPanel").first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(900);
  }

  if (scenario.scrollSelector) {
    await page.locator(scenario.scrollSelector).first().scrollIntoViewIfNeeded().catch(async () => {
      await page.evaluate(() => window.scrollTo(0, Math.floor(document.body.scrollHeight * 0.45)));
    });
    await page.waitForTimeout(500);
  }

  if (scenario.action === "open-card-picker") {
    await page.locator(".MatchSearch_CardPickerTrigger").first().click({ timeout: 5000 }).catch(() => {});
    await page.locator(".MatchSearch_CardPicker").first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function collectVisualSignals(page) {
  return await page.evaluate(() => {
    const viewport = {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight
    };

    function rectOf(node) {
      const rect = node.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom)
      };
    }

    function isVisible(node) {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== "hidden"
        && style.display !== "none"
        && Number(style.opacity || 1) > 0.01;
    }

    function labelOf(node) {
      return String(
        node.getAttribute("aria-label")
          || node.getAttribute("alt")
          || node.getAttribute("title")
          || node.textContent
          || ""
      ).replace(/\s+/g, " ").trim().slice(0, 120);
    }

    function classOf(node) {
      return String(node.getAttribute("class") || "").slice(0, 160);
    }

    function summarize(node, kind) {
      return {
        kind,
        tag: node.tagName.toLowerCase(),
        className: classOf(node),
        role: node.getAttribute("role") || "",
        label: labelOf(node),
        disabled: Boolean(node.disabled || node.getAttribute("aria-disabled") === "true"),
        rect: rectOf(node)
      };
    }

    function clippedArea(parentRect, childRect) {
      const left = Math.max(parentRect.x, childRect.x);
      const top = Math.max(parentRect.y, childRect.y);
      const right = Math.min(parentRect.right, childRect.right);
      const bottom = Math.min(parentRect.bottom, childRect.bottom);
      return Math.max(0, right - left) * Math.max(0, bottom - top);
    }

    function childCoverage(node, rect) {
      const children = Array.from(node.children).filter(isVisible).slice(0, 80);
      const area = Math.max(1, rect.width * rect.height);
      const covered = children.reduce((sum, child) => sum + clippedArea(rect, rectOf(child)), 0);
      return Math.min(1, covered / area);
    }

    const interactiveNodes = Array.from(document.querySelectorAll([
      "button",
      "a[href]",
      "input",
      "select",
      "textarea",
      "[role='button']",
      "[tabindex]:not([tabindex='-1'])"
    ].join(","))).filter(isVisible).slice(0, 220);

    const textNodes = Array.from(document.querySelectorAll([
      "button",
      "a",
      "label",
      "h1",
      "h2",
      "h3",
      "p",
      "span",
      "strong",
      "small",
      ".Common_StatusPanel",
      ".Common_SectionHeading",
      ".MatchSearch_SelectedCard",
      ".MatchSearch_ResultSideTitle"
    ].join(","))).filter(isVisible).slice(0, 360);

    const imageNodes = Array.from(document.querySelectorAll("img, .Common_ImageFrame")).filter(isVisible).slice(0, 260);
    const containerNodes = Array.from(document.querySelectorAll([
      "main > section",
      "main article",
      ".Common_PageShell",
      ".Common_TableCard",
      ".Common_StatusPanel",
      ".MatchSearch_Hero",
      ".MatchSearch_Toolbar",
      ".MatchSearch_SidePanel",
      ".MatchSearch_ResultItem",
      ".MatchSearch_CardPicker",
      ".TierPage_TableCard"
    ].join(","))).filter(isVisible).slice(0, 220);

    const controls = interactiveNodes.map((node) => summarize(node, "control"));
    const media = imageNodes.map((node) => ({
      ...summarize(node, "media"),
      src: String(node.currentSrc || node.src || "").slice(0, 240),
      naturalWidth: Number(node.naturalWidth || 0),
      naturalHeight: Number(node.naturalHeight || 0)
    }));

    const textOverflow = textNodes
      .filter((node) => labelOf(node) && (node.scrollWidth > node.clientWidth + 2 || node.scrollHeight > node.clientHeight + 2))
      .map((node) => ({
        ...summarize(node, "text"),
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight
      }))
      .slice(0, 80);

    const largeEmptyContainers = containerNodes
      .map((node) => {
        const rect = rectOf(node);
        return {
          ...summarize(node, "container"),
          childCoverage: Number(childCoverage(node, rect).toFixed(2)),
          textLength: labelOf(node).length
        };
      })
      .filter((item) => {
        const area = item.rect.width * item.rect.height;
        const viewportArea = Math.max(1, viewport.width * viewport.height);
        return area > viewportArea * 0.18 && item.childCoverage < 0.28 && item.textLength < 60;
      })
      .slice(0, 40);

    const overlapCandidates = [
      ...interactiveNodes.map((node) => ({ node, item: summarize(node, "control") })),
      ...imageNodes.map((node) => ({ node, item: summarize(node, "media") }))
    ].slice(0, 180);
    const overlaps = [];
    for (let index = 0; index < overlapCandidates.length; index += 1) {
      for (let next = index + 1; next < overlapCandidates.length; next += 1) {
        const a = overlapCandidates[index];
        const b = overlapCandidates[next];
        if (a.node.contains(b.node) || b.node.contains(a.node)) continue;
        const aRect = a.item.rect;
        const bRect = b.item.rect;
        const area = clippedArea(aRect, bRect);
        if (!area) continue;
        const minArea = Math.max(1, Math.min(aRect.width * aRect.height, bRect.width * bRect.height));
        if (area / minArea >= 0.24 && area >= 80) {
          overlaps.push({
            a: a.item,
            b: b.item,
            overlapArea: Math.round(area)
          });
        }
        if (overlaps.length >= 50) break;
      }
      if (overlaps.length >= 50) break;
    }

    return {
      viewport,
      controls,
      media,
      textOverflow,
      largeEmptyContainers,
      overlaps
    };
  });
}

async function collectDomSummary(page) {
  return await page.evaluate(() => {
    const selectors = [
      "header",
      "nav",
      "main",
      "h1",
      "h2",
      "button",
      "a",
      "input",
      "select",
      ".Common_StatusPanel",
      ".Common_TableCard",
      ".Common_PageShell"
    ];
    const nodes = Array.from(document.querySelectorAll(selectors.join(","))).slice(0, 140);
    return nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        tag: node.tagName.toLowerCase(),
        className: String(node.getAttribute("class") || "").slice(0, 160),
        role: node.getAttribute("role") || "",
        ariaLabel: node.getAttribute("aria-label") || "",
        text: String(node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    });
  });
}

async function collectChecks(page) {
  return await page.evaluate(() => {
    const documentWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const imageFailures = Array.from(document.images)
      .filter((image) => image.complete && image.naturalWidth === 0)
      .map((image) => ({
        src: image.currentSrc || image.src,
        alt: image.alt || "",
        className: image.className || ""
      }))
      .slice(0, 30);
    const mainHeading = document.querySelector("h1");
    const nav = document.querySelector("nav, header");
    return {
      horizontalOverflow: scrollWidth > documentWidth + 1,
      documentWidth,
      scrollWidth,
      imageFailures,
      keyElements: {
        mainHeadingVisible: Boolean(mainHeading && mainHeading.getBoundingClientRect().height > 0),
        navigationVisible: Boolean(nav && nav.getBoundingClientRect().height > 0)
      }
    };
  });
}

async function captureOne(browser, pageConfig, scenario, viewport) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const consoleErrors = [];
  const networkFailures = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    networkFailures.push({
      url: request.url(),
      failure: request.failure()?.errorText || ""
    });
  });

  const url = new URL(pageConfig.path, webOrigin).toString();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("load", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(900);
  await applyScenario(page, scenario);

  const screenshotId = `${pageConfig.id}__${scenario.id}__${viewport.id}`;
  const screenshotPath = `screenshots/${screenshotId}.png`;
  await page.screenshot({ fullPage: false, path: resolve(outputDir, screenshotPath) });
  const checks = await collectChecks(page);
  const domSummary = await collectDomSummary(page);
  const visualSignals = await collectVisualSignals(page);
  await page.close();

  return {
    id: screenshotId,
    pageId: pageConfig.id,
    pageLabel: pageConfig.label,
    path: pageConfig.path,
    url,
    scenario: { id: scenario.id, label: scenario.label },
    viewport,
    screenshotPath,
    consoleErrors,
    networkFailures,
    checks,
    domSummary,
    visualSignals
  };
}

async function main() {
  await mkdir(screenshotDir, { recursive: true });
  const apiProcess = await startProcessIfNeeded(
    "leaderboard-api",
    `${apiOrigin}/api/leaderboard-snapshot`,
    "node",
    [resolve(paths.repoRoot, "apps/api/leaderboard-snapshot/server.mjs")],
    paths.repoRoot,
    { PORT: String(apiPort), HOST: "127.0.0.1" }
  );
  const webProcess = await startProcessIfNeeded(
    "vite",
    `${webOrigin}/leaderboard/`,
    npmCommand(),
    ["run", "dev", "--", "--port", String(webPort), "--strictPort"],
    paths.webRoot,
    { VITE_LEADERBOARD_API_ORIGIN: apiOrigin }
  );

  const screenshots = [];
  const browser = await chromium.launch();
  try {
    for (const pageConfig of selectedPages) {
      const scenarios = pageConfig.scenarios.filter((scenario) => !selectedScenarios.length || selectedScenarios.includes(scenario.id));
      for (const scenario of scenarios) {
        for (const viewport of selectedViewports) {
          screenshots.push(await captureOne(browser, pageConfig, scenario, viewport));
          console.log(`[ui-review] captured ${screenshots.at(-1).id}`);
        }
      }
    }
  } finally {
    await browser.close();
    await stopProcess(webProcess);
    await stopProcess(apiProcess);
  }

  const manifest = {
    schemaVersion: UI_REVIEW_SCHEMA_VERSION,
    runId,
    generatedAt: new Date().toISOString(),
    webOrigin,
    apiOrigin,
    designDocs: DESIGN_DOCS,
    pages: selectedPages.map(({ id, label, path }) => ({ id, label, path })),
    viewports: selectedViewports,
    screenshots
  };
  const annotations = {
    schemaVersion: UI_REVIEW_SCHEMA_VERSION,
    runId,
    updatedAt: new Date().toISOString(),
    annotations: []
  };

  await writeFile(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(resolve(outputDir, "annotations.json"), `${JSON.stringify(annotations, null, 2)}\n`, "utf8");
  console.log(`[ui-review] run=${runId}`);
  console.log(`[ui-review] next: npm run ui:review:serve -- --run-id=${runId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
