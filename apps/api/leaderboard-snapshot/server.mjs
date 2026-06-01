import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_PORT = 8001;
const DEFAULT_SNAPSHOT_FILE = resolve("apps/api/data/leaderboard-snapshot.json");
const DEFAULT_STATUS_FILE = resolve("apps/api/data/leaderboard-refresh-status.json");

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

export function createLeaderboardSnapshotServer(options = {}) {
  const snapshotFile = resolve(options.snapshotFile || DEFAULT_SNAPSHOT_FILE);
  const statusFile = resolve(options.statusFile || DEFAULT_STATUS_FILE);
  const snapshotCache = createJsonFileCache(snapshotFile);
  const statusCache = createJsonFileCache(statusFile);

  function writeStaticJson(response, body) {
    response.writeHead(200, jsonHeaders());
    response.end(body);
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
  const server = createLeaderboardSnapshotServer({
    snapshotFile,
    statusFile
  });

  server.listen(port, host, () => {
    console.log(`leaderboard snapshot api listening on http://${host}:${port}`);
  });

  return server;
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startLeaderboardSnapshotServer();
}
