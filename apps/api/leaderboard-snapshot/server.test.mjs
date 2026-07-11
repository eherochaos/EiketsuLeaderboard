import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function testMissingTierListDataDoesNotExposePath() {
  const missingFile = resolve("apps/api/leaderboard-snapshot/__missing_tier_list__.json");
  const server = createLeaderboardSnapshotServer({ tierListSnapshotFile: missingFile });
  const address = await listen(server);
  const originalConsoleError = console.error;

  try {
    console.error = () => {};
    const response = await fetch(`http://127.0.0.1:${address.port}/api/tier-list-snapshot`);
    const bodyText = await response.text();
    const body = JSON.parse(bodyText);

    assert.equal(response.status, 500);
    assert.equal(body.error, "tier list data is not available");
    assert.equal(bodyText.includes(missingFile), false);
  } finally {
    console.error = originalConsoleError;
    await close(server);
  }
}

async function testMissingBattleFestivalDataDoesNotExposePath() {
  const missingFile = resolve("apps/api/leaderboard-snapshot/__missing_battle_festival__.json");
  const server = createLeaderboardSnapshotServer({ battleFestivalSnapshotFile: missingFile });
  const address = await listen(server);
  const originalConsoleError = console.error;

  try {
    console.error = () => {};
    const response = await fetch(`http://127.0.0.1:${address.port}/api/battle-festival-snapshot`);
    const bodyText = await response.text();
    const body = JSON.parse(bodyText);

    assert.equal(response.status, 500);
    assert.equal(body.error, "battle festival data is not available");
    assert.equal(bodyText.includes(missingFile), false);
  } finally {
    console.error = originalConsoleError;
    await close(server);
  }
}

function testSnapshot(sourceRunId, summary, targetVersion = "Ver.test") {
  return {
    metadata: {
      sourceRunId,
      targetVersion,
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

function testTierListSnapshot(sourceRunId, deckName, targetVersion = "Ver.test") {
  return {
    schemaVersion: 1,
    metadata: {
      sourceRunId,
      targetVersion,
      dateFrom: "2026-06-01",
      dateTo: "2026-06-02",
      updatedAt: "2026-06-02T00:00:00Z",
      sampleSize: 10
    },
    tierRows: [{ deckId: "deck-a", deckName, deckCards: [], evidenceTags: [] }],
    clusterRows: []
  };
}

function testTierListConfigs() {
  return {
    schemaVersion: 1,
    metadata: { sourceRunId: 1 },
    deckConfigs: {
      "deck-a": {
        weapons: [{ name: "weapon-a", usageRate: 50, sampleSize: 2, lowSample: false }],
        styles: [],
        souls: [],
        strategies: [{ cardId: "card-a", name: "strategy-a", usageRate: 25, sampleSize: 1, strategyCount: 1, averageCount: 1 }],
        schoolStages: [{ name: "stage-a", stage: "1", usageRate: 25, sampleSize: 1, lowSample: false, averageCount: 1 }],
        unfavorableMatchups: [{ deckId: "enemy", deckName: "Enemy", usageRate: 20, sampleSize: 1 }]
      }
    },
    clusterConfigs: {
      "cluster-a": {
        weapons: [],
        styles: [],
        souls: [],
        strategies: [],
        schoolStages: [],
        unfavorableMatchups: []
      }
    }
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

async function testTierListSnapshotUsesStaticCacheHeaders() {
  const root = await mkdtemp(join(tmpdir(), "tier-list-cache-"));
  const tierListSnapshotFile = join(root, "tier-list-snapshot.json");
  const server = createLeaderboardSnapshotServer({ tierListSnapshotFile });

  try {
    await writeFile(tierListSnapshotFile, `${JSON.stringify(testTierListSnapshot(1, "first"))}\n`, "utf8");
    const address = await listen(server);
    const first = await fetch(`http://127.0.0.1:${address.port}/api/tier-list-snapshot`, {
      headers: { "Accept-Encoding": "gzip" }
    });
    const firstBody = await first.json();
    const etag = first.headers.get("etag");

    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "no-cache");
    assert.equal(first.headers.get("content-encoding"), "gzip");
    assert.ok(etag);
    assert.equal(firstBody.metadata.sourceRunId, 1);

    const cached = await fetch(`http://127.0.0.1:${address.port}/api/tier-list-snapshot`, {
      headers: { "If-None-Match": etag }
    });
    assert.equal(cached.status, 304);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
}

async function testTierListDeckConfigEndpointUsesStaticConfigFile() {
  const root = await mkdtemp(join(tmpdir(), "tier-list-config-"));
  const tierListConfigsFile = join(root, "tier-list-configs.json");
  const server = createLeaderboardSnapshotServer({ tierListConfigsFile });

  try {
    await writeFile(tierListConfigsFile, `${JSON.stringify(testTierListConfigs())}\n`, "utf8");
    const address = await listen(server);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/tier-list-deck-config?scope=deck&deckId=deck-a`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.metadata.sourceRunId, 1);
    assert.equal(body.scope, "deck");
    assert.equal(body.deckConfig.strategies[0].name, "strategy-a");

    const missing = await fetch(`http://127.0.0.1:${address.port}/api/tier-list-deck-config?scope=deck&deckId=missing`);
    const missingText = await missing.text();
    assert.equal(missing.status, 404);
    assert.equal(/token|cookie|secret|C:\\|E:\\/.test(missingText), false);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
}

async function testBattleFestivalDeckConfigEndpointUsesStaticConfigFile() {
  const root = await mkdtemp(join(tmpdir(), "battle-festival-config-"));
  const battleFestivalConfigsFile = join(root, "battle-festival-configs.json");
  const server = createLeaderboardSnapshotServer({ battleFestivalConfigsFile });

  try {
    await writeFile(battleFestivalConfigsFile, `${JSON.stringify(testTierListConfigs())}\n`, "utf8");
    const address = await listen(server);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/battle-festival-deck-config?scope=deck&deckId=deck-a`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.metadata.sourceRunId, 1);
    assert.equal(body.scope, "deck");
    assert.equal(body.deckConfig.strategies[0].name, "strategy-a");
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

async function testVersionOptionsFallbackFromSnapshot() {
  const root = await mkdtemp(join(tmpdir(), "version-options-fallback-"));
  const snapshotFile = join(root, "leaderboard-snapshot.json");
  const versionManifestFile = join(root, "missing-version-manifest.json");
  const server = createLeaderboardSnapshotServer({ snapshotFile, versionManifestFile });

  try {
    await writeFile(snapshotFile, `${JSON.stringify(testSnapshot(7, "current", "Ver.current"))}\n`, "utf8");
    const address = await listen(server);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/version-options`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.currentTargetVersion, "Ver.current");
    assert.equal(body.versions.length, 1);
    assert.equal(body.versions[0].targetVersion, "Ver.current");
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
}

async function testVersionedEndpointsUseManifestArtifacts() {
  const root = await mkdtemp(join(tmpdir(), "versioned-server-"));
  const snapshotFile = join(root, "leaderboard-snapshot.json");
  const tierListSnapshotFile = join(root, "tier-list-snapshot.json");
  const tierListConfigsFile = join(root, "tier-list-configs.json");
  const matchSearchIndexFile = join(root, "match-search-index.json");
  const versionManifestFile = join(root, "version-manifest.json");
  const versionOutputDir = join(root, "versions");
  const oldVersionDir = join(versionOutputDir, "Ver.old");
  const server = createLeaderboardSnapshotServer({
    snapshotFile,
    tierListSnapshotFile,
    tierListConfigsFile,
    matchSearchIndexFile,
    versionManifestFile,
    versionOutputDir
  });

  try {
    await writeFile(snapshotFile, `${JSON.stringify(testSnapshot(10, "current", "Ver.current"))}\n`, "utf8");
    await writeFile(tierListSnapshotFile, `${JSON.stringify(testTierListSnapshot(10, "Current Deck"))}\n`, "utf8");
    await writeFile(tierListConfigsFile, `${JSON.stringify(testTierListConfigs())}\n`, "utf8");
    await writeFile(matchSearchIndexFile, `${JSON.stringify(testMatchSearchIndex(10))}\n`, "utf8");
    await writeFile(versionManifestFile, `${JSON.stringify({
      schemaVersion: 1,
      currentTargetVersion: "Ver.current",
      versions: [
        { targetVersion: "Ver.current", sourceRunId: 10, dateFrom: "2026-06-01", dateTo: "2026-06-02", updatedAt: "", sampleSize: 10, current: true },
        { targetVersion: "Ver.old", sourceRunId: 3, dateFrom: "2026-05-01", dateTo: "2026-05-02", updatedAt: "", sampleSize: 4, current: false }
      ]
    })}\n`, "utf8");
    await mkdir(oldVersionDir, { recursive: true });
    await writeFile(join(oldVersionDir, "leaderboard-snapshot.json"), `${JSON.stringify(testSnapshot(3, "old", "Ver.old"))}\n`, "utf8");
    await writeFile(join(oldVersionDir, "tier-list-snapshot.json"), `${JSON.stringify(testTierListSnapshot(3, "Old Deck", "Ver.old"))}\n`, "utf8");
    await writeFile(join(oldVersionDir, "tier-list-configs.json"), `${JSON.stringify(testTierListConfigs())}\n`, "utf8");
    const oldIndex = testMatchSearchIndex(3);
    oldIndex.metadata.targetVersion = "Ver.old";
    oldIndex.matches[0].version = "Ver.old";
    await writeFile(join(oldVersionDir, "match-search-index.json"), `${JSON.stringify(oldIndex)}\n`, "utf8");

    const address = await listen(server);
    const currentLeaderboard = await fetch(`http://127.0.0.1:${address.port}/api/leaderboard-snapshot?version=Ver.current`);
    assert.equal((await currentLeaderboard.json()).metadata.sourceRunId, 10);

    const leaderboard = await fetch(`http://127.0.0.1:${address.port}/api/leaderboard-snapshot?version=Ver.old`);
    assert.equal((await leaderboard.json()).metadata.sourceRunId, 3);

    const tierList = await fetch(`http://127.0.0.1:${address.port}/api/tier-list-snapshot?version=Ver.old`);
    assert.equal((await tierList.json()).tierRows[0].deckName, "Old Deck");

    const deckConfig = await fetch(`http://127.0.0.1:${address.port}/api/tier-list-deck-config?version=Ver.old&scope=deck&deckId=deck-a`);
    assert.equal((await deckConfig.json()).metadata.sourceRunId, 1);

    const options = await fetch(`http://127.0.0.1:${address.port}/api/match-search-options?version=Ver.old`);
    assert.equal((await options.json()).metadata.targetVersion, "Ver.old");

    const search = await fetch(`http://127.0.0.1:${address.port}/api/match-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetVersion: "Ver.old", sideA: { cardIds: ["card-a"] } })
    });
    assert.equal((await search.json()).items[0].version, "Ver.old");

    const missing = await fetch(`http://127.0.0.1:${address.port}/api/leaderboard-snapshot?version=Ver.missing`);
    assert.equal(missing.status, 404);
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

function testAnalyticsEventPayload(overrides = {}) {
  return {
    visitorId: "visitor_123456",
    sessionId: "session_123456",
    eventType: "page_view",
    page: "/leaderboard/",
    target: "leaderboard",
    metadata: { label: "home", token: "secret", path: "E:\\secret\\data.json" },
    deviceType: "desktop",
    viewport: { width: 1440, height: 900 },
    language: "zh-CN",
    referrerOrigin: "http://example.test/path?token=secret",
    occurredAt: "2026-06-03T00:00:00.000Z",
    ...overrides
  };
}

async function testSiteAnalyticsEventAndSummary() {
  const root = await mkdtemp(join(tmpdir(), "site-analytics-"));
  const siteAnalyticsFile = join(root, "site-analytics-events.jsonl");
  const server = createLeaderboardSnapshotServer({
    siteAnalyticsFile,
    siteAnalyticsAdminToken: "admin-token"
  });

  try {
    const address = await listen(server);
    const event = await fetch(`http://127.0.0.1:${address.port}/api/site-analytics-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testAnalyticsEventPayload())
    });
    assert.equal(event.status, 204);

    const ownerEvent = await fetch(`http://127.0.0.1:${address.port}/api/site-analytics-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testAnalyticsEventPayload({
        visitorId: "visitor_owner123",
        sessionId: "session_owner123",
        page: "/tier-list/",
        target: "tier-list"
      }))
    });
    assert.equal(ownerEvent.status, 204);

    const fileText = await readFile(siteAnalyticsFile, "utf8");
    assert.equal(/secret|E:\\|token=|cookie/i.test(fileText), false);
    assert.equal(fileText.includes("\"eventType\":\"page_view\""), true);

    const unauthorized = await fetch(`http://127.0.0.1:${address.port}/api/site-analytics-summary`);
    assert.equal(unauthorized.status, 401);

    const summary = await fetch(`http://127.0.0.1:${address.port}/api/site-analytics-summary?from=2026-06-01&to=2026-06-03`, {
      headers: { Authorization: "Bearer admin-token" }
    });
    const body = await summary.json();
    assert.equal(summary.status, 200);
    assert.equal(body.totals.visitors, 2);
    assert.equal(body.totals.pageViews, 2);
    assert.equal(body.pages[0].page, "/leaderboard/");
    assert.equal(/secret|E:\\|token=|cookie/i.test(JSON.stringify(body)), false);

    const externalSummary = await fetch(`http://127.0.0.1:${address.port}/api/site-analytics-summary?from=2026-06-01&to=2026-06-03&excludeVisitorId=visitor_owner123`, {
      headers: { Authorization: "Bearer admin-token" }
    });
    const externalBody = await externalSummary.json();
    assert.equal(externalSummary.status, 200);
    assert.equal(externalBody.totals.visitors, 1);
    assert.equal(externalBody.totals.pageViews, 1);
    assert.equal(externalBody.pages.length, 1);
    assert.equal(externalBody.pages[0].page, "/leaderboard/");
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
}

async function testSiteAnalyticsRejectsInvalidEvent() {
  const root = await mkdtemp(join(tmpdir(), "site-analytics-invalid-"));
  const siteAnalyticsFile = join(root, "site-analytics-events.jsonl");
  const server = createLeaderboardSnapshotServer({ siteAnalyticsFile });

  try {
    const address = await listen(server);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/site-analytics-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testAnalyticsEventPayload({ eventType: "full_click" }))
    });
    const text = await response.text();

    assert.equal(response.status, 400);
    assert.equal(/E:\\|token|cookie|secret/i.test(text), false);
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
}

async function testSiteAnalyticsSummaryRequiresConfiguredToken() {
  const root = await mkdtemp(join(tmpdir(), "site-analytics-token-"));
  const siteAnalyticsFile = join(root, "site-analytics-events.jsonl");
  const server = createLeaderboardSnapshotServer({ siteAnalyticsFile });

  try {
    const address = await listen(server);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/site-analytics-summary`, {
      headers: { Authorization: "Bearer anything" }
    });
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.error, "site analytics admin token is not configured");
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
}

async function testSiteAnalyticsSummaryReadsFileReplacement() {
  const root = await mkdtemp(join(tmpdir(), "site-analytics-reload-"));
  const siteAnalyticsFile = join(root, "site-analytics-events.jsonl");
  const server = createLeaderboardSnapshotServer({
    siteAnalyticsFile,
    siteAnalyticsAdminToken: "admin-token"
  });

  try {
    await writeFile(siteAnalyticsFile, `${JSON.stringify(testAnalyticsEventPayload({ eventType: "page_view", page: "/leaderboard/" }))}\n`, "utf8");
    const address = await listen(server);
    const first = await fetch(`http://127.0.0.1:${address.port}/api/site-analytics-summary?from=2026-06-01&to=2026-06-03`, {
      headers: { Authorization: "Bearer admin-token" }
    });
    assert.equal((await first.json()).pages[0].page, "/leaderboard/");

    await writeFile(siteAnalyticsFile, `${JSON.stringify(testAnalyticsEventPayload({ eventType: "page_view", page: "/match-search/" }))}\n`, "utf8");
    const second = await fetch(`http://127.0.0.1:${address.port}/api/site-analytics-summary?from=2026-06-01&to=2026-06-03`, {
      headers: { Authorization: "Bearer admin-token" }
    });
    const body = await second.json();

    assert.equal(second.status, 200);
    assert.equal(body.pages[0].page, "/match-search/");
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
await testMissingTierListDataDoesNotExposePath();
await testMissingBattleFestivalDataDoesNotExposePath();
await testSnapshotFileIsServedWithoutBuild();
await testSnapshotFileReplacementIsReloaded();
await testTierListSnapshotUsesStaticCacheHeaders();
await testTierListDeckConfigEndpointUsesStaticConfigFile();
await testBattleFestivalDeckConfigEndpointUsesStaticConfigFile();
await testRefreshStatusFileReplacementIsReloaded();
await testMatchSearchEndpointsUseStaticIndex();
await testVersionOptionsFallbackFromSnapshot();
await testVersionedEndpointsUseManifestArtifacts();
await testMatchSearchIndexReplacementIsReloaded();
await testSiteAnalyticsEventAndSummary();
await testSiteAnalyticsRejectsInvalidEvent();
await testSiteAnalyticsSummaryRequiresConfiguredToken();
await testSiteAnalyticsSummaryReadsFileReplacement();
await testSmokeAcceptsSnapshotEndpoint();
await testSmokeRejectsHtmlFallback();

console.log("leaderboard snapshot api tests passed");
