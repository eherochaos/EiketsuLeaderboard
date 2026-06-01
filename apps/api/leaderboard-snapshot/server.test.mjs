import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createLeaderboardSnapshotServer } from "./server.mjs";
import { smokeLeaderboardSnapshotEndpoint } from "./smoke-snapshot-endpoint.mjs";

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
  const missingFile = resolve("apps/api/leaderboard-snapshot/__missing_snapshot__.json");
  const server = createLeaderboardSnapshotServer({ snapshotFile: missingFile });
  const address = await listen(server);
  const originalConsoleError = console.error;

  try {
    console.error = () => {};
    const response = await fetch(`http://127.0.0.1:${address.port}/api/leaderboard-snapshot`);
    const bodyText = await response.text();
    const body = JSON.parse(bodyText);

    assert.equal(response.status, 500);
    assert.equal(body.error, "leaderboard data is not available");
    assert.equal(bodyText.includes(missingFile), false);
  } finally {
    console.error = originalConsoleError;
    await close(server);
  }
}

async function testMissingRefreshStatusDoesNotExposePath() {
  const missingFile = resolve("apps/api/leaderboard-snapshot/__missing_status__.json");
  const server = createLeaderboardSnapshotServer({ statusFile: missingFile });
  const address = await listen(server);
  const originalConsoleError = console.error;

  try {
    console.error = () => {};
    const response = await fetch(`http://127.0.0.1:${address.port}/api/leaderboard-refresh-status`);
    const bodyText = await response.text();
    const body = JSON.parse(bodyText);

    assert.equal(response.status, 500);
    assert.equal(body.error, "leaderboard refresh status is not available");
    assert.equal(bodyText.includes(missingFile), false);
  } finally {
    console.error = originalConsoleError;
    await close(server);
  }
}

async function testMissingMatchSearchIndexDoesNotExposePath() {
  const missingFile = resolve("apps/api/leaderboard-snapshot/__missing_match_search__.json");
  const server = createLeaderboardSnapshotServer({ matchSearchIndexFile: missingFile });
  const address = await listen(server);
  const originalConsoleError = console.error;

  try {
    console.error = () => {};
    const response = await fetch(`http://127.0.0.1:${address.port}/api/match-search-options`);
    const bodyText = await response.text();
    const body = JSON.parse(bodyText);

    assert.equal(response.status, 500);
    assert.equal(body.error, "match search data is not available");
    assert.equal(bodyText.includes(missingFile), false);
  } finally {
    console.error = originalConsoleError;
    await close(server);
  }
}

function testSnapshot(sourceRunId, summary) {
  return {
    metadata: {
      sourceRunId,
      dateFrom: "2026-05-20",
      dateTo: "2026-05-25",
      updatedAt: "2026-05-25T00:00:00",
      sampleSize: 1
    },
    home: {
      factionShare: [],
      representativeDecks: [],
      featuredCards: [],
      summary,
      tierRows: []
    },
    clusterRows: [],
    tierRows: []
  };
}

function testMatchSearchIndex(matchId, weaponName = "孫子") {
  return {
    schemaVersion: 1,
    metadata: {
      sourceRunId: 1,
      targetVersion: "Ver.test",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-01",
      matchCount: 1,
      videoMatchCount: 1
    },
    cards: [
      {
        cardId: "card-a",
        name: "Alpha",
        faction: "蒼",
        cardCode: "蒼001",
        unitType: "槍兵",
        imageUrl: "",
        imageAlt: "Alpha",
        usageCount: 1
      }
    ],
    weapons: [{ name: weaponName, usageCount: 1, activatedCount: 1, notActivatedCount: 0, unknownCount: 0 }],
    matches: [
      {
        matchId,
        version: "Ver.test",
        mode: "全国対戦",
        playedAt: "2026-06-01 12:00",
        videoUrl: "https://eiketsu.example.test/play/1",
        playUrl: "https://eiketsu.example.test/play/1",
        detailUrl: "",
        m3u8Url: "",
        replayId: "",
        sideA: {
          result: "win",
          playerName: "alice",
          castleRate: "52.1",
          weaponName,
          weaponActivated: "yes",
          weaponSummary: "35c 発動",
          schoolName: "士気",
          cardIds: ["card-a"],
          strategyCounts: { "card-a": 1 }
        },
        sideB: {
          result: "loss",
          playerName: "bob",
          castleRate: "47.9",
          weaponName: "再起",
          weaponActivated: "no",
          weaponSummary: "未発動",
          schoolName: "士気",
          cardIds: [],
          strategyCounts: {}
        }
      }
    ]
  };
}

async function testSnapshotFileIsServedWithoutBuild() {
  const root = await mkdtemp(join(tmpdir(), "leaderboard-snapshot-server-"));
  const snapshotFile = join(root, "leaderboard-snapshot.json");
  let buildCount = 0;
  const server = createLeaderboardSnapshotServer({
    snapshotFile,
    async buildLeaderboardSnapshot() {
      buildCount += 1;
      throw new Error("build should not run while serving a static snapshot");
    }
  });

  try {
    await writeFile(snapshotFile, `${JSON.stringify(testSnapshot(1, "ok"))}\n`, "utf8");
    const address = await listen(server);
    const first = await fetch(`http://127.0.0.1:${address.port}/api/leaderboard-snapshot`);
    const second = await fetch(`http://127.0.0.1:${address.port}/api/leaderboard-snapshot`);
    const firstBody = await first.json();
    const secondBody = await second.json();

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(firstBody.metadata.sourceRunId, 1);
    assert.equal(secondBody.home.summary, "ok");
    assert.equal(buildCount, 0);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
}

async function testSnapshotFileReplacementIsReloaded() {
  const root = await mkdtemp(join(tmpdir(), "leaderboard-snapshot-reload-"));
  const snapshotFile = join(root, "leaderboard-snapshot.json");
  const server = createLeaderboardSnapshotServer({ snapshotFile });

  try {
    await writeFile(snapshotFile, `${JSON.stringify(testSnapshot(1, "first"))}\n`, "utf8");
    const address = await listen(server);
    const first = await fetch(`http://127.0.0.1:${address.port}/api/leaderboard-snapshot`);
    assert.equal((await first.json()).metadata.sourceRunId, 1);

    await writeFile(snapshotFile, `${JSON.stringify(testSnapshot(2, "second snapshot"))}\n`, "utf8");
    const second = await fetch(`http://127.0.0.1:${address.port}/api/leaderboard-snapshot`);
    const secondBody = await second.json();

    assert.equal(second.status, 200);
    assert.equal(secondBody.metadata.sourceRunId, 2);
    assert.equal(secondBody.home.summary, "second snapshot");
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
}

async function testRefreshStatusFileReplacementIsReloaded() {
  const root = await mkdtemp(join(tmpdir(), "leaderboard-status-reload-"));
  const statusFile = join(root, "leaderboard-refresh-status.json");
  const server = createLeaderboardSnapshotServer({ statusFile });

  try {
    await writeFile(statusFile, `${JSON.stringify({ refresh: { status: "running" } })}\n`, "utf8");
    const address = await listen(server);
    const first = await fetch(`http://127.0.0.1:${address.port}/api/leaderboard-refresh-status`);
    assert.equal((await first.json()).refresh.status, "running");

    await writeFile(statusFile, `${JSON.stringify({ refresh: { status: "completed" } })}\n`, "utf8");
    const second = await fetch(`http://127.0.0.1:${address.port}/api/leaderboard-refresh-status`);
    const secondBody = await second.json();

    assert.equal(second.status, 200);
    assert.equal(secondBody.refresh.status, "completed");
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
}

async function testMatchSearchEndpointsUseStaticIndex() {
  const root = await mkdtemp(join(tmpdir(), "match-search-server-"));
  const matchSearchIndexFile = join(root, "match-search-index.json");
  const server = createLeaderboardSnapshotServer({ matchSearchIndexFile });

  try {
    await writeFile(matchSearchIndexFile, `${JSON.stringify(testMatchSearchIndex(1))}\n`, "utf8");
    const address = await listen(server);
    const options = await fetch(`http://127.0.0.1:${address.port}/api/match-search-options`);
    const optionsBody = await options.json();
    assert.equal(options.status, 200);
    assert.equal(optionsBody.cards[0].name, "Alpha");

    const search = await fetch(`http://127.0.0.1:${address.port}/api/match-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sideA: { cardIds: ["card-a"], weaponActivated: "yes" } })
    });
    const searchBody = await search.json();
    assert.equal(search.status, 200);
    assert.equal(searchBody.total, 1);
    assert.equal(searchBody.items[0].matchId, 1);

    const badRequest = await fetch(`http://127.0.0.1:${address.port}/api/match-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    assert.equal(badRequest.status, 400);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
}

async function testMatchSearchIndexReplacementIsReloaded() {
  const root = await mkdtemp(join(tmpdir(), "match-search-reload-"));
  const matchSearchIndexFile = join(root, "match-search-index.json");
  const server = createLeaderboardSnapshotServer({ matchSearchIndexFile });

  try {
    await writeFile(matchSearchIndexFile, `${JSON.stringify(testMatchSearchIndex(1, "孫子"))}\n`, "utf8");
    const address = await listen(server);
    const first = await fetch(`http://127.0.0.1:${address.port}/api/match-search-options`);
    assert.equal((await first.json()).weapons[0].name, "孫子");

    await writeFile(matchSearchIndexFile, `${JSON.stringify(testMatchSearchIndex(2, "再起之法"))}\n`, "utf8");
    const second = await fetch(`http://127.0.0.1:${address.port}/api/match-search-options`);
    const secondBody = await second.json();

    assert.equal(second.status, 200);
    assert.equal(secondBody.weapons[0].name, "再起之法");
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
}

async function testSmokeAcceptsSnapshotEndpoint() {
  const root = await mkdtemp(join(tmpdir(), "leaderboard-snapshot-smoke-"));
  const snapshotFile = join(root, "leaderboard-snapshot.json");
  const server = createLeaderboardSnapshotServer({ snapshotFile });

  try {
    await writeFile(snapshotFile, `${JSON.stringify(testSnapshot(3, "smoke"))}\n`, "utf8");
    const address = await listen(server);
    const result = await smokeLeaderboardSnapshotEndpoint(`http://127.0.0.1:${address.port}/api/leaderboard-snapshot`);

    assert.equal(result.sourceRunId, 3);
    assert.equal(result.clusterRows, 0);
    assert.equal(result.tierRows, 0);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
}

async function testSmokeRejectsHtmlFallback() {
  const server = createHttpServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body>Vite fallback</body></html>");
  });
  const address = await listen(server);

  try {
    await assert.rejects(
      () => smokeLeaderboardSnapshotEndpoint(`http://127.0.0.1:${address.port}/api/leaderboard-snapshot`),
      /application\/json/
    );
  } finally {
    await close(server);
  }
}

await testMissingDataDoesNotExposePath();
await testMissingRefreshStatusDoesNotExposePath();
await testMissingMatchSearchIndexDoesNotExposePath();
await testSnapshotFileIsServedWithoutBuild();
await testSnapshotFileReplacementIsReloaded();
await testRefreshStatusFileReplacementIsReloaded();
await testMatchSearchEndpointsUseStaticIndex();
await testMatchSearchIndexReplacementIsReloaded();
await testSmokeAcceptsSnapshotEndpoint();
await testSmokeRejectsHtmlFallback();

console.log("leaderboard snapshot api tests passed");
