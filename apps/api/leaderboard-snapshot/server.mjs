import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MatchSearchRequestError, matchSearchOptions, searchMatchIndex } from "./match-search-index.mjs";
import {
  SiteAnalyticsRequestError,
  appendSiteAnalyticsEvent,
  readSiteAnalyticsSummary
} from "./site-analytics.mjs";
import { VERSION_MANIFEST_SCHEMA_VERSION, versionArtifactPath, versionEntry } from "./version-files.mjs";

const DEFAULT_PORT = 8001;
const DEFAULT_SNAPSHOT_FILE = resolve("apps/api/data/leaderboard-snapshot.json");
const DEFAULT_STATUS_FILE = resolve("apps/api/data/leaderboard-refresh-status.json");
const DEFAULT_MATCH_SEARCH_INDEX_FILE = resolve("apps/api/data/match-search-index.json");
const DEFAULT_TIER_LIST_SNAPSHOT_FILE = resolve("apps/api/data/tier-list-snapshot.json");
const DEFAULT_TIER_LIST_CONFIGS_FILE = resolve("apps/api/data/tier-list-configs.json");
const DEFAULT_BATTLE_FESTIVAL_SNAPSHOT_FILE = resolve("apps/api/data/battle-festival-snapshot.json");
const DEFAULT_BATTLE_FESTIVAL_CONFIGS_FILE = resolve("apps/api/data/battle-festival-configs.json");
const DEFAULT_VERSION_MANIFEST_FILE = resolve("apps/api/data/version-manifest.json");
const DEFAULT_SITE_ANALYTICS_FILE = resolve("apps/api/data/site-analytics-events.jsonl");

function jsonHeaders(extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extra
  };
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, jsonHeaders());
  response.end(`${JSON.stringify(payload)}\n`);
}

function publicError(error, fallback = "leaderboard snapshot failed", missing = "leaderboard data is not available") {
  if (error?.code === "ENOENT") {
    return missing;
  }

  return fallback;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function manifestFromSnapshot(snapshot) {
  const metadata = snapshot?.metadata || {};
  const targetVersion = String(metadata.targetVersion || "").trim();
  const versions = targetVersion ? [{
    targetVersion,
    sourceRunId: Number(metadata.sourceRunId || 0),
    dateFrom: String(metadata.dateFrom || ""),
    dateTo: String(metadata.dateTo || ""),
    updatedAt: String(metadata.updatedAt || ""),
    sampleSize: Number(metadata.sampleSize || 0),
    current: true
  }] : [];

  return {
    schemaVersion: VERSION_MANIFEST_SCHEMA_VERSION,
    currentTargetVersion: targetVersion,
    versions
  };
}

function createJsonFileCache(filePath) {
  let cache = null;

  async function load() {
    const fileStat = await stat(filePath);
    if (
      cache &&
      cache.mtimeMs === fileStat.mtimeMs &&
      cache.size === fileStat.size
    ) {
      return cache.body;
    }

    const body = await readFile(filePath);
    cache = {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      body
    };
    return body;
  }

  function clear() {
    cache = null;
  }

  return { clear, load };
}

function createStaticJsonFileCache(filePath) {
  let cache = null;

  async function load() {
    const fileStat = await stat(filePath);
    if (
      cache &&
      cache.mtimeMs === fileStat.mtimeMs &&
      cache.size === fileStat.size
    ) {
      return cache;
    }

    const body = await readFile(filePath);
    cache = {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      body,
      gzipBody: gzipSync(body),
      etag: `W/"${fileStat.size}-${Math.trunc(fileStat.mtimeMs)}"`,
      lastModified: fileStat.mtime.toUTCString()
    };
    return cache;
  }

  function clear() {
    cache = null;
  }

  return { clear, load };
}

function createParsedJsonFileCache(filePath) {
  let cache = null;

  async function load() {
    const fileStat = await stat(filePath);
    if (
      cache &&
      cache.mtimeMs === fileStat.mtimeMs &&
      cache.size === fileStat.size
    ) {
      return cache.payload;
    }

    const body = await readFile(filePath, "utf8");
    cache = {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      payload: JSON.parse(body)
    };
    return cache.payload;
  }

  function clear() {
    cache = null;
  }

  return { clear, load };
}

async function readJsonBody(request, maxBytes = 64 * 1024, RequestError = MatchSearchRequestError) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new RequestError("request body is too large");
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new RequestError("request body must be valid JSON");
  }
}

function bearerToken(request) {
  const header = String(request.headers.authorization || "");
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : "";
}

export function createLeaderboardSnapshotServer(options = {}) {
  const snapshotFile = resolve(options.snapshotFile || DEFAULT_SNAPSHOT_FILE);
  const statusFile = resolve(options.statusFile || DEFAULT_STATUS_FILE);
  const matchSearchIndexFile = resolve(options.matchSearchIndexFile || DEFAULT_MATCH_SEARCH_INDEX_FILE);
  const tierListSnapshotFile = resolve(options.tierListSnapshotFile || DEFAULT_TIER_LIST_SNAPSHOT_FILE);
  const tierListConfigsFile = resolve(options.tierListConfigsFile || DEFAULT_TIER_LIST_CONFIGS_FILE);
  const battleFestivalSnapshotFile = resolve(options.battleFestivalSnapshotFile || DEFAULT_BATTLE_FESTIVAL_SNAPSHOT_FILE);
  const battleFestivalConfigsFile = resolve(options.battleFestivalConfigsFile || DEFAULT_BATTLE_FESTIVAL_CONFIGS_FILE);
  const versionManifestFile = resolve(options.versionManifestFile || DEFAULT_VERSION_MANIFEST_FILE);
  const versionOutputDir = resolve(options.versionOutputDir || resolve(dirname(snapshotFile), "versions"));
  const siteAnalyticsFile = resolve(options.siteAnalyticsFile || DEFAULT_SITE_ANALYTICS_FILE);
  const siteAnalyticsAdminToken = String(options.siteAnalyticsAdminToken || "");
  const snapshotCache = createStaticJsonFileCache(snapshotFile);
  const statusCache = createJsonFileCache(statusFile);
  const matchSearchIndexCache = createParsedJsonFileCache(matchSearchIndexFile);
  const tierListSnapshotCache = createStaticJsonFileCache(tierListSnapshotFile);
  const tierListConfigsCache = createParsedJsonFileCache(tierListConfigsFile);
  const battleFestivalSnapshotCache = createStaticJsonFileCache(battleFestivalSnapshotFile);
  const battleFestivalConfigsCache = createParsedJsonFileCache(battleFestivalConfigsFile);
  const versionManifestCache = createParsedJsonFileCache(versionManifestFile);
  const versionStaticCaches = new Map();
  const versionParsedCaches = new Map();

  function writeStaticJson(request, response, entry) {
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache",
      "ETag": entry.etag,
      "Last-Modified": entry.lastModified,
      "Vary": "Accept-Encoding"
    };
    const ifNoneMatch = String(request.headers["if-none-match"] || "");
    const ifModifiedSince = Date.parse(String(request.headers["if-modified-since"] || ""));
    const mtimeSecondsMs = Math.floor(entry.mtimeMs / 1000) * 1000;
    if (
      (ifNoneMatch && ifNoneMatch.split(",").map((item) => item.trim()).includes(entry.etag)) ||
      (Number.isFinite(ifModifiedSince) && ifModifiedSince >= mtimeSecondsMs)
    ) {
      response.writeHead(304, headers);
      response.end();
      return;
    }

    const acceptsGzip = String(request.headers["accept-encoding"] || "").includes("gzip");
    const body = acceptsGzip ? entry.gzipBody : entry.body;
    if (acceptsGzip) {
      headers["Content-Encoding"] = "gzip";
    }
    headers["Content-Length"] = String(body.length);
    response.writeHead(200, headers);
    response.end(body);
  }

  function writeNoStoreJsonFile(response, body) {
    response.writeHead(200, jsonHeaders());
    response.end(body);
  }

  function staticCacheFor(filePath) {
    const key = resolve(filePath);
    if (!versionStaticCaches.has(key)) {
      versionStaticCaches.set(key, createStaticJsonFileCache(key));
    }
    return versionStaticCaches.get(key);
  }

  function parsedCacheFor(filePath) {
    const key = resolve(filePath);
    if (!versionParsedCaches.has(key)) {
      versionParsedCaches.set(key, createParsedJsonFileCache(key));
    }
    return versionParsedCaches.get(key);
  }

  async function loadVersionManifest() {
    try {
      return await versionManifestCache.load();
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const entry = await snapshotCache.load();
      return manifestFromSnapshot(JSON.parse(entry.body.toString("utf8")));
    }
  }

  async function versionedFilePath(targetVersion, response, fileName) {
    const requested = String(targetVersion || "").trim();
    if (!requested) return "";
    const manifest = await loadVersionManifest();
    const entry = versionEntry(manifest, requested);
    if (!entry || entry.targetVersion !== requested) {
      writeJson(response, 404, { error: "version is not available" });
      return null;
    }
    if (requested === String(manifest?.currentTargetVersion || "").trim()) {
      return "";
    }
    return versionArtifactPath(versionOutputDir, entry.targetVersion, fileName);
  }

  async function loadVersionedStaticJson(response, targetVersion, defaultCache, fileName) {
    const filePath = await versionedFilePath(targetVersion, response, fileName);
    if (filePath === null) return null;
    if (!filePath) return await defaultCache.load();
    return await staticCacheFor(filePath).load();
  }

  async function loadVersionedParsedJson(response, targetVersion, defaultCache, fileName) {
    const filePath = await versionedFilePath(targetVersion, response, fileName);
    if (filePath === null) return null;
    if (!filePath) return await defaultCache.load();
    return await parsedCacheFor(filePath).load();
  }

  async function loadMatchSearchIndex(response, targetVersion = "") {
    try {
      return await loadVersionedParsedJson(response, targetVersion, matchSearchIndexCache, "match-search-index.json");
    } catch (error) {
      matchSearchIndexCache.clear();
      const message = publicError(error, "match search failed");
      console.error(message);
      writeJson(response, 500, { error: error?.code === "ENOENT" ? "match search data is not available" : message });
      return null;
    }
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/version-options") {
      try {
        writeJson(response, 200, await loadVersionManifest());
      } catch (error) {
        versionManifestCache.clear();
        const message = publicError(error, "version options failed", "version options are not available");
        console.error(message);
        writeJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/leaderboard-snapshot") {
      try {
        const entry = await loadVersionedStaticJson(response, url.searchParams.get("version"), snapshotCache, "leaderboard-snapshot.json");
        if (!entry) return;
        writeStaticJson(request, response, entry);
      } catch (error) {
        snapshotCache.clear();
        console.error(publicError(error));
        writeJson(response, 500, { error: publicError(error) });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/tier-list-snapshot") {
      try {
        const entry = await loadVersionedStaticJson(response, url.searchParams.get("version"), tierListSnapshotCache, "tier-list-snapshot.json");
        if (!entry) return;
        writeStaticJson(request, response, entry);
      } catch (error) {
        tierListSnapshotCache.clear();
        const message = publicError(error, "tier list failed", "tier list data is not available");
        console.error(message);
        writeJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/battle-festival-snapshot") {
      try {
        writeStaticJson(request, response, await battleFestivalSnapshotCache.load());
      } catch (error) {
        battleFestivalSnapshotCache.clear();
        const message = publicError(error, "battle festival failed", "battle festival data is not available");
        console.error(message);
        writeJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/tier-list-deck-config") {
      try {
        const scope = url.searchParams.get("scope") === "cluster" ? "cluster" : "deck";
        const deckId = String(url.searchParams.get("deckId") || "").trim();
        if (!deckId) {
          writeJson(response, 400, { error: "deckId is required" });
          return;
        }
        const payload = await loadVersionedParsedJson(response, url.searchParams.get("version"), tierListConfigsCache, "tier-list-configs.json");
        if (!payload) return;
        const configs = scope === "cluster" ? payload.clusterConfigs : payload.deckConfigs;
        const deckConfig = configs?.[deckId];
        if (!deckConfig) {
          writeJson(response, 404, { error: "tier list deck config is not available" });
          return;
        }
        writeJson(response, 200, {
          metadata: payload.metadata,
          scope,
          deckId,
          deckConfig
        });
      } catch (error) {
        tierListConfigsCache.clear();
        const message = publicError(error, "tier list deck config failed", "tier list deck config data is not available");
        console.error(message);
        writeJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/leaderboard-refresh-status") {
      try {
        writeNoStoreJsonFile(response, await statusCache.load());
      } catch (error) {
        statusCache.clear();
        const message = publicError(error, "leaderboard refresh status failed");
        console.error(message);
        writeJson(response, 500, { error: error?.code === "ENOENT" ? "leaderboard refresh status is not available" : message });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/battle-festival-deck-config") {
      try {
        const scope = url.searchParams.get("scope") === "cluster" ? "cluster" : "deck";
        const deckId = String(url.searchParams.get("deckId") || "").trim();
        if (!deckId) {
          writeJson(response, 400, { error: "deckId is required" });
          return;
        }
        const payload = await battleFestivalConfigsCache.load();
        const configs = scope === "cluster" ? payload.clusterConfigs : payload.deckConfigs;
        const deckConfig = configs?.[deckId];
        if (!deckConfig) {
          writeJson(response, 404, { error: "battle festival deck config is not available" });
          return;
        }
        writeJson(response, 200, {
          metadata: payload.metadata,
          scope,
          deckId,
          deckConfig
        });
      } catch (error) {
        battleFestivalConfigsCache.clear();
        const message = publicError(error, "battle festival deck config failed", "battle festival deck config data is not available");
        console.error(message);
        writeJson(response, 500, { error: message });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/match-search-options") {
      const index = await loadMatchSearchIndex(response, url.searchParams.get("version"));
      if (!index) return;
      writeJson(response, 200, matchSearchOptions(index));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/match-search") {
      try {
        const payload = await readJsonBody(request);
        const targetVersion = firstText(payload.targetVersion, url.searchParams.get("version"));
        const index = await loadMatchSearchIndex(response, targetVersion);
        if (!index) return;
        writeJson(response, 200, searchMatchIndex(index, payload));
      } catch (error) {
        const isBadRequest = error instanceof MatchSearchRequestError;
        writeJson(response, isBadRequest ? 400 : 500, {
          error: isBadRequest ? error.message : "match search failed"
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/site-analytics-event") {
      try {
        const payload = await readJsonBody(request, 16 * 1024, SiteAnalyticsRequestError);
        await appendSiteAnalyticsEvent(siteAnalyticsFile, payload);
        response.writeHead(204);
        response.end();
      } catch (error) {
        const isBadRequest = error instanceof SiteAnalyticsRequestError;
        writeJson(response, isBadRequest ? 400 : 500, {
          error: isBadRequest ? error.message : "site analytics failed"
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/site-analytics-summary") {
      if (!siteAnalyticsAdminToken) {
        writeJson(response, 503, { error: "site analytics admin token is not configured" });
        return;
      }
      if (bearerToken(request) !== siteAnalyticsAdminToken) {
        writeJson(response, 401, { error: "site analytics authorization is required" });
        return;
      }

      try {
        writeJson(response, 200, await readSiteAnalyticsSummary(siteAnalyticsFile, {
          from: url.searchParams.get("from") || "",
          to: url.searchParams.get("to") || "",
          excludeVisitorIds: url.searchParams.getAll("excludeVisitorId")
        }));
      } catch (error) {
        console.error(publicError(error, "site analytics failed"));
        writeJson(response, 500, { error: "site analytics failed" });
      }
      return;
    }

    writeJson(response, 404, { error: "not found" });
  });

  return server;
}

export function startLeaderboardSnapshotServer(options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  const port = Number(options.port || env.PORT || DEFAULT_PORT);
  const host = options.host || env.HOST || "127.0.0.1";
  const snapshotFile = options.snapshotFile || env.LEADERBOARD_SNAPSHOT_FILE;
  const statusFile = options.statusFile || env.LEADERBOARD_REFRESH_STATUS_FILE || (
    snapshotFile ? resolve(dirname(resolve(snapshotFile)), "leaderboard-refresh-status.json") : undefined
  );
  const matchSearchIndexFile = options.matchSearchIndexFile || env.LEADERBOARD_MATCH_SEARCH_INDEX_FILE || (
    snapshotFile ? resolve(dirname(resolve(snapshotFile)), "match-search-index.json") : undefined
  );
  const tierListSnapshotFile = options.tierListSnapshotFile || env.LEADERBOARD_TIER_LIST_SNAPSHOT_FILE || (
    snapshotFile ? resolve(dirname(resolve(snapshotFile)), "tier-list-snapshot.json") : undefined
  );
  const tierListConfigsFile = options.tierListConfigsFile || env.LEADERBOARD_TIER_LIST_CONFIGS_FILE || (
    snapshotFile ? resolve(dirname(resolve(snapshotFile)), "tier-list-configs.json") : undefined
  );
  const battleFestivalSnapshotFile = options.battleFestivalSnapshotFile || env.LEADERBOARD_BATTLE_FESTIVAL_SNAPSHOT_FILE || (
    snapshotFile ? resolve(dirname(resolve(snapshotFile)), "battle-festival-snapshot.json") : undefined
  );
  const battleFestivalConfigsFile = options.battleFestivalConfigsFile || env.LEADERBOARD_BATTLE_FESTIVAL_CONFIGS_FILE || (
    snapshotFile ? resolve(dirname(resolve(snapshotFile)), "battle-festival-configs.json") : undefined
  );
  const versionManifestFile = options.versionManifestFile || env.LEADERBOARD_VERSION_MANIFEST_FILE || (
    snapshotFile ? resolve(dirname(resolve(snapshotFile)), "version-manifest.json") : undefined
  );
  const versionOutputDir = options.versionOutputDir || env.LEADERBOARD_VERSION_OUTPUT_DIR || (
    snapshotFile ? resolve(dirname(resolve(snapshotFile)), "versions") : undefined
  );
  const siteAnalyticsFile = options.siteAnalyticsFile || env.SITE_ANALYTICS_FILE || (
    snapshotFile ? resolve(dirname(resolve(snapshotFile)), "site-analytics-events.jsonl") : undefined
  );
  const siteAnalyticsAdminToken = options.siteAnalyticsAdminToken || env.SITE_ANALYTICS_ADMIN_TOKEN || "";
  const server = createLeaderboardSnapshotServer({
    snapshotFile,
    statusFile,
    matchSearchIndexFile,
    tierListSnapshotFile,
    tierListConfigsFile,
    battleFestivalSnapshotFile,
    battleFestivalConfigsFile,
    versionManifestFile,
    versionOutputDir,
    siteAnalyticsFile,
    siteAnalyticsAdminToken
  });

  server.listen(port, host, () => {
    console.log(`leaderboard snapshot api listening on http://${host}:${port}`);
  });

  return server;
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startLeaderboardSnapshotServer();
}
