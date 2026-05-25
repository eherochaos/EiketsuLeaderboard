import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_PORT = 8001;
const DEFAULT_SNAPSHOT_FILE = resolve("apps/api/data/leaderboard-snapshot.json");

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

function publicError(error) {
  if (error?.code === "ENOENT") {
    return "leaderboard data is not available";
  }

  return "leaderboard snapshot failed";
}

export function createLeaderboardSnapshotServer(options = {}) {
  const snapshotFile = resolve(options.snapshotFile || DEFAULT_SNAPSHOT_FILE);
  let snapshotCache = null;

  function loadSnapshot() {
    return stat(snapshotFile).then(async (snapshotStat) => {
      if (
        snapshotCache &&
        snapshotCache.mtimeMs === snapshotStat.mtimeMs &&
        snapshotCache.size === snapshotStat.size
      ) {
        return snapshotCache.body;
      }

      const body = await readFile(snapshotFile);
      snapshotCache = {
        mtimeMs: snapshotStat.mtimeMs,
        size: snapshotStat.size,
        body
      };
      return body;
    });
  }

  function writeSnapshot(response, body) {
    response.writeHead(200, jsonHeaders());
    response.end(body);
  }

  function clearSnapshotCache() {
    snapshotCache = null;
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/leaderboard-snapshot") {
      try {
        writeSnapshot(response, await loadSnapshot());
      } catch (error) {
        clearSnapshotCache();
        console.error(publicError(error));
        writeJson(response, 500, { error: publicError(error) });
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
  const server = createLeaderboardSnapshotServer({
    snapshotFile: options.snapshotFile || env.LEADERBOARD_SNAPSHOT_FILE
  });

  server.listen(port, host, () => {
    console.log(`leaderboard snapshot api listening on http://${host}:${port}`);
  });

  return server;
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startLeaderboardSnapshotServer();
}
