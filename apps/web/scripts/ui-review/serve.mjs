import { createReadStream } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import {
  DEFAULT_ANNOTATION_PORT,
  UI_REVIEW_SCHEMA_VERSION,
  latestRunDirName,
  pathsFromMetaUrl
} from "./config.mjs";
import { normalizeAnnotations } from "./packet.mjs";

const paths = pathsFromMetaUrl(import.meta.url);
const args = parseArgs(process.argv.slice(2));
const port = Number(args.port || process.env.UI_REVIEW_ANNOTATION_PORT || DEFAULT_ANNOTATION_PORT);
const host = args.host || "127.0.0.1";

function parseArgs(values) {
  const result = {};
  for (const value of values) {
    const match = /^--([^=]+)=(.*)$/.exec(value);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

async function resolveRunId(requestedRunId = "") {
  if (requestedRunId) return requestedRunId;
  const names = await readdir(paths.outputRoot).catch(() => []);
  return latestRunDirName(names);
}

function runPath(runId, relativePath = "") {
  const root = resolve(paths.outputRoot, runId);
  const target = resolve(root, relativePath);
  if (!target.startsWith(root)) throw new Error("invalid path");
  return target;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readBody(request, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendText(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function contentType(filePath) {
  if (extname(filePath) === ".png") return "image/png";
  if (extname(filePath) === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function sendFile(response, filePath) {
  const fileStat = await stat(filePath);
  response.writeHead(200, {
    "Content-Type": contentType(filePath),
    "Content-Length": String(fileStat.size),
    "Cache-Control": "no-store"
  });
  createReadStream(filePath).pipe(response);
}

function html() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>UI Review Annotator</title>
  <style>
    :root { color-scheme: light; font-family: Arial, "Microsoft YaHei", sans-serif; }
    body { margin: 0; background: #f4efe5; color: #201815; }
    header { position: sticky; top: 0; z-index: 5; display: flex; gap: 12px; align-items: center; padding: 10px 14px; border-bottom: 1px solid #d5bf92; background: rgba(255, 250, 239, 0.96); }
    h1 { margin: 0; font-size: 18px; }
    button, select, input, textarea { font: inherit; }
    button, select, input { min-height: 34px; border: 1px solid #c8aa74; background: #fffaf0; }
    button { padding: 0 12px; cursor: pointer; font-weight: 700; }
    main { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 12px; padding: 12px; }
    .Stage { min-width: 0; overflow: auto; border: 1px solid #d5bf92; background: #fffaf4; }
    .ImageWrap { position: relative; display: inline-block; min-width: 320px; }
    .ImageWrap img { display: block; max-width: none; user-select: none; }
    .Box { position: absolute; border: 2px solid #b43731; background: rgba(180, 55, 49, 0.16); box-sizing: border-box; }
    .Box.Active { border-color: #1f5f8f; background: rgba(31, 95, 143, 0.16); }
    aside { display: grid; gap: 10px; align-content: start; }
    .Panel { border: 1px solid #d5bf92; background: #fffaf0; padding: 10px; }
    .Panel h2 { margin: 0 0 8px; font-size: 15px; }
    label { display: grid; gap: 4px; margin-bottom: 8px; font-size: 12px; font-weight: 700; color: #665342; }
    input, select, textarea { width: 100%; box-sizing: border-box; padding: 6px 8px; }
    textarea { min-height: 76px; resize: vertical; }
    .Row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .Actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .Primary { background: #b43731; color: #fff; border-color: #b43731; }
    .List { display: grid; gap: 8px; max-height: 360px; overflow: auto; }
    .Item { text-align: left; padding: 8px; background: #fff; border: 1px solid #e0c99d; }
    .Item strong { display: block; }
    .Item small { color: #665342; }
    @media (max-width: 900px) {
      main { grid-template-columns: 1fr; }
      aside { order: -1; }
    }
  </style>
</head>
<body>
  <header>
    <h1>UI Review Annotator</h1>
    <select id="shotSelect"></select>
    <button id="reloadButton" type="button">刷新</button>
    <button id="saveButton" class="Primary" type="button">保存标注</button>
    <span id="status"></span>
  </header>
  <main>
    <section class="Stage">
      <div id="imageWrap" class="ImageWrap">
        <img id="shotImage" alt="">
      </div>
    </section>
    <aside>
      <section class="Panel">
        <h2>当前标注</h2>
        <div class="Row">
          <label>严重度
            <select id="severity">
              <option>P2</option><option>P0</option><option>P1</option><option>P3</option>
            </select>
          </label>
          <label>分类
            <select id="category">
              <option>违规实现</option><option>符合规范</option><option>合法变体</option><option>疑似新规范</option>
            </select>
          </label>
        </div>
        <label>组件 <input id="component" placeholder="例如 MatchSearch_CardPicker"></label>
        <label>规则 <input id="rule" placeholder="例如 spacing / state / alignment"></label>
        <label>说明 <textarea id="note" placeholder="描述标注区域的问题"></textarea></label>
        <label>决策
          <select id="decision">
            <option>需要修复</option><option>需要设计师确认</option><option>保持现状</option><option>沉淀新规范</option>
          </select>
        </label>
        <div class="Actions">
          <button id="newButton" type="button">新建</button>
          <button id="deleteButton" type="button">删除</button>
        </div>
      </section>
      <section class="Panel">
        <h2>标注列表</h2>
        <div id="annotationList" class="List"></div>
      </section>
    </aside>
  </main>
  <script>
    const params = new URLSearchParams(location.search);
    const runId = params.get("runId") || "";
    const state = { manifest: null, annotations: [], activeId: "", drag: null };
    const els = {
      shotSelect: document.querySelector("#shotSelect"),
      reloadButton: document.querySelector("#reloadButton"),
      saveButton: document.querySelector("#saveButton"),
      status: document.querySelector("#status"),
      imageWrap: document.querySelector("#imageWrap"),
      shotImage: document.querySelector("#shotImage"),
      severity: document.querySelector("#severity"),
      category: document.querySelector("#category"),
      component: document.querySelector("#component"),
      rule: document.querySelector("#rule"),
      note: document.querySelector("#note"),
      decision: document.querySelector("#decision"),
      newButton: document.querySelector("#newButton"),
      deleteButton: document.querySelector("#deleteButton"),
      annotationList: document.querySelector("#annotationList")
    };

    function api(path) {
      return path + (path.includes("?") ? "&" : "?") + "runId=" + encodeURIComponent(runId);
    }
    function activeShotId() {
      return els.shotSelect.value;
    }
    function activeAnnotation() {
      return state.annotations.find((item) => item.annotationId === state.activeId) || null;
    }
    function updateStatus(text) {
      els.status.textContent = text;
    }
    function shotById(id) {
      return state.manifest.screenshots.find((shot) => shot.id === id);
    }
    function makeId() {
      return "ann-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    }
    function imageRect() {
      return els.shotImage.getBoundingClientRect();
    }
    function readForm() {
      const item = activeAnnotation();
      if (!item) return;
      item.severity = els.severity.value;
      item.category = els.category.value;
      item.component = els.component.value.trim();
      item.rule = els.rule.value.trim();
      item.note = els.note.value.trim();
      item.decision = els.decision.value;
      render();
    }
    function writeForm(item) {
      els.severity.value = item?.severity || "P2";
      els.category.value = item?.category || "违规实现";
      els.component.value = item?.component || "";
      els.rule.value = item?.rule || "";
      els.note.value = item?.note || "";
      els.decision.value = item?.decision || "需要修复";
    }
    function createAnnotation(rect) {
      const item = {
        annotationId: makeId(),
        screenshotId: activeShotId(),
        rect,
        severity: els.severity.value,
        category: els.category.value,
        component: els.component.value.trim(),
        rule: els.rule.value.trim(),
        note: els.note.value.trim(),
        decision: els.decision.value,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.annotations.push(item);
      state.activeId = item.annotationId;
      render();
    }
    function renderBoxes() {
      for (const box of Array.from(els.imageWrap.querySelectorAll(".Box"))) box.remove();
      for (const item of state.annotations.filter((ann) => ann.screenshotId === activeShotId())) {
        const box = document.createElement("button");
        box.type = "button";
        box.className = "Box" + (item.annotationId === state.activeId ? " Active" : "");
        box.style.left = item.rect.x + "px";
        box.style.top = item.rect.y + "px";
        box.style.width = item.rect.width + "px";
        box.style.height = item.rect.height + "px";
        box.title = item.note || item.component || item.severity;
        box.addEventListener("click", () => {
          state.activeId = item.annotationId;
          writeForm(item);
          render();
        });
        els.imageWrap.appendChild(box);
      }
    }
    function renderList() {
      els.annotationList.innerHTML = "";
      for (const item of state.annotations.filter((ann) => ann.screenshotId === activeShotId())) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "Item";
        button.innerHTML = "<strong>" + item.severity + " " + (item.component || "未命名组件") + "</strong><small>" + (item.note || item.category) + "</small>";
        button.addEventListener("click", () => {
          state.activeId = item.annotationId;
          writeForm(item);
          render();
        });
        els.annotationList.appendChild(button);
      }
    }
    function render() {
      renderBoxes();
      renderList();
    }
    async function load() {
      const manifest = await fetch(api("/api/manifest")).then((res) => res.json());
      const annotations = await fetch(api("/api/annotations")).then((res) => res.json());
      state.manifest = manifest;
      state.annotations = annotations.annotations || [];
      els.shotSelect.innerHTML = "";
      for (const shot of manifest.screenshots) {
        const option = document.createElement("option");
        option.value = shot.id;
        option.textContent = shot.id;
        els.shotSelect.appendChild(option);
      }
      selectShot(els.shotSelect.value);
      updateStatus("已加载 " + manifest.runId);
    }
    function selectShot(id) {
      const shot = shotById(id);
      if (!shot) return;
      els.shotImage.src = "/artifact/" + encodeURIComponent(state.manifest.runId) + "/" + shot.screenshotPath;
      state.activeId = "";
      writeForm(null);
      render();
    }
    async function save() {
      readForm();
      const payload = {
        schemaVersion: 1,
        runId: state.manifest.runId,
        updatedAt: new Date().toISOString(),
        annotations: state.annotations
      };
      await fetch(api("/api/annotations"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      updateStatus("已保存 " + new Date().toLocaleTimeString());
    }
    els.shotSelect.addEventListener("change", () => selectShot(els.shotSelect.value));
    els.reloadButton.addEventListener("click", load);
    els.saveButton.addEventListener("click", save);
    for (const input of [els.severity, els.category, els.component, els.rule, els.note, els.decision]) {
      input.addEventListener("input", readForm);
      input.addEventListener("change", readForm);
    }
    els.newButton.addEventListener("click", () => createAnnotation({ x: 20, y: 20, width: 160, height: 90 }));
    els.deleteButton.addEventListener("click", () => {
      state.annotations = state.annotations.filter((item) => item.annotationId !== state.activeId);
      state.activeId = "";
      writeForm(null);
      render();
    });
    els.imageWrap.addEventListener("mousedown", (event) => {
      if (event.target !== els.shotImage) return;
      const rect = imageRect();
      state.drag = {
        x: Math.max(0, Math.round(event.clientX - rect.left)),
        y: Math.max(0, Math.round(event.clientY - rect.top))
      };
    });
    window.addEventListener("mouseup", (event) => {
      if (!state.drag) return;
      const rect = imageRect();
      const endX = Math.max(0, Math.round(event.clientX - rect.left));
      const endY = Math.max(0, Math.round(event.clientY - rect.top));
      const x = Math.min(state.drag.x, endX);
      const y = Math.min(state.drag.y, endY);
      const width = Math.abs(endX - state.drag.x);
      const height = Math.abs(endY - state.drag.y);
      state.drag = null;
      if (width >= 8 && height >= 8) createAnnotation({ x, y, width, height });
    });
    load().catch((error) => updateStatus(error.message));
  </script>
</body>
</html>`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/") {
      sendText(response, 200, html(), "text/html; charset=utf-8");
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/runs") {
      const names = await readdir(paths.outputRoot).catch(() => []);
      sendJson(response, 200, { runs: names.filter((name) => /^\d{8}T\d{6}Z$/.test(name)).sort().reverse() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/manifest") {
      const runId = await resolveRunId(url.searchParams.get("runId") || args.runId || "");
      sendJson(response, 200, await readJson(runPath(runId, "manifest.json"), null));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/annotations") {
      const runId = await resolveRunId(url.searchParams.get("runId") || args.runId || "");
      const fallback = { schemaVersion: UI_REVIEW_SCHEMA_VERSION, runId, updatedAt: new Date().toISOString(), annotations: [] };
      sendJson(response, 200, await readJson(runPath(runId, "annotations.json"), fallback));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/annotations") {
      const runId = await resolveRunId(url.searchParams.get("runId") || args.runId || "");
      const payload = normalizeAnnotations(JSON.parse(await readBody(request)), runId);
      await writeFile(runPath(runId, "annotations.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      sendJson(response, 200, payload);
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/artifact/")) {
      const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
      const runId = parts[1] || "";
      const relativePath = parts.slice(2).join("/");
      await sendFile(response, runPath(runId, relativePath));
      return;
    }
    sendJson(response, 404, { error: "not found" });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "ui review server failed" });
  }
});

server.listen(port, host, () => {
  const query = args.runId ? `?runId=${encodeURIComponent(args.runId)}` : "";
  console.log(`ui review annotator listening on http://${host}:${port}/${query}`);
});
