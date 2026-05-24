import assert from "node:assert/strict";
import { once } from "node:events";
import { resolve } from "node:path";
import { createLeaderboardSnapshotServer } from "./server.mjs";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address();
}

async function close(server) {
  server.close();
  await once(server, "close");
}

async function testMissingDataDoesNotExposePath() {
  const missingRoot = resolve("apps/api/leaderboard-snapshot/__missing_data__");
  const server = createLeaderboardSnapshotServer({ legacyRoot: missingRoot });
  const address = await listen(server);
  const originalConsoleError = console.error;

  try {
    console.error = () => {};
    const response = await fetch(`http://127.0.0.1:${address.port}/api/leaderboard-snapshot`);
    const bodyText = await response.text();
    const body = JSON.parse(bodyText);

    assert.equal(response.status, 500);
    assert.equal(body.error, "leaderboard data is not available");
    assert.equal(bodyText.includes(missingRoot), false);
  } finally {
    console.error = originalConsoleError;
    await close(server);
  }
}

await testMissingDataDoesNotExposePath();

console.log("leaderboard snapshot api tests passed");
