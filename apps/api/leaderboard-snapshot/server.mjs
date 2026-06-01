import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MatchSearchRequestError, matchSearchOptions, searchMatchIndex } from "./match-search-index.mjs";

const DEFAULT_PORT = 8001;
const DEFAULT_SNAPSHOT_FILE = resolve("apps/api/data/leaderboard-snapshot.json");
const DEFAULT_STATUS_FILE = resolve("apps/api/data/leaderboard-refresh-status.json");
const DEFAULT_MATCH_SEARCH_INDEX_FILE = resolve("apps/api/data/match-search-index.json");

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

function publicError(error, fallback = "leaderboard snapshot failed") {
  if (error?.code === "ENOENT") {
    return "leaderboard data is not available";
  }

  return fallback;
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

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) {
      throw new MatchSearchRequestError("request body is too large");
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new MatchSearchRequestError("request body must be valid JSON");
  }
}

export function createLeaderboardSnapshotServer(options = {}) {
  const snapshotFile = resolve(options.snapshotFile || DEFAULT_SNAPSHOT_FILE);
  const statusFile = resolve(options.statusFile || DEFAULT_STATUS_FILE);
  const matchSearchIndexFile = resolve(options.matchSearchIndexFile || DEFAULT_MATCH_SEARCH_INDEX_FILE);
  const snapshotCache = createJsonFileCache(snapshotFile);
  const statusCache = createJsonFileCache(statusFile);
  const matchSearchIndexCache = createParsedJsonFileCache(matchSearchIndexFile);

  function writeStaticJson(response, body) {
    response.writeHead(200, jsonHeaders());
    response.end(body);
  }

  async function loadMatchSearchIndex(response) {
    try {
      return await matchSearchIndexCache.load();
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

    if (request.method === "GET" && url.pathname === "/api/leaderboard-snapshot") {
      try {
        writeStaticJson(response, await snapshotCache.load());
      } catch (error) {
        snapshotCache.clear();
        console.error(publicError(error));
        writeJson(response, 500, { error: publicError(error) });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/leaderboard-refresh-status") {
      try {
        writeStaticJson(response, await statusCache.load());
      } catch (error) {
        statusCache.clear();
        const message = publicError(error, "leaderboard refresh status failed");
        console.error(message);
        writeJson(response, 500, { error: error?.code === "ENOENT" ? "leaderboard refresh status is not available" : message });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/match-search-options") {
      const index = await loadMatchSearchIndex(response);
      if (!index) return;
      writeJson(response, 200, matchSearchOptions(index));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/match-search") {
      const index = await loadMatchSearchIndex(response);
      if (!index) return;
      try {
        const payload = await readJsonBody(request);
        writeJson(response, 200, searchMatchIndex(index, payload));
      } catch (error) {
        const isBadRequest = error instanceof MatchSearchRequestError;
        writeJson(response, isBadRequest ? 400 : 500, {
          error: isBadRequest ? error.message : "match search failed"
        });
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
  const server = createLeaderboardSnapshotServer({
    snapshotFile,
    statusFile,
    matchSearchIndexFile
  });

  server.listen(port, host, () => {
    console.log(`leaderboard snapshot api listening on http://${host}:${port}`);
  });

  return server;
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startLeaderboardSnapshotServer();
}
