import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { buildLeaderboardSnapshot } from "./snapshot-builder.mjs";

const DEFAULT_PORT = 8001;

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
  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/leaderboard-snapshot") {
      try {
        const snapshot = await buildLeaderboardSnapshot({ legacyRoot: options.legacyRoot });
        writeJson(response, 200, snapshot);
      } catch (error) {
        console.error(publicError(error));
        writeJson(response, 500, { error: publicError(error) });
      }
      return;
    }

    writeJson(response, 404, { error: "not found" });
  });
}

export function startLeaderboardSnapshotServer(options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  const port = Number(options.port || env.PORT || DEFAULT_PORT);
  const host = options.host || env.HOST || "127.0.0.1";
  const server = createLeaderboardSnapshotServer({
    legacyRoot: options.legacyRoot || env.LEADERBOARD_LEGACY_ROOT
  });

  server.listen(port, host, () => {
    console.log(`leaderboard snapshot api listening on http://${host}:${port}`);
  });

  return server;
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startLeaderboardSnapshotServer();
}
