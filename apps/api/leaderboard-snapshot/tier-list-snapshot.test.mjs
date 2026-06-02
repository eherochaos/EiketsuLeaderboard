import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTierListSnapshotFiles, writeTierListSnapshotFiles } from "./tier-list-snapshot.mjs";

function testCard(cardId, name) {
  return {
    cardId,
    name,
    faction: "碧",
    imageUrl: `https://example.test/${cardId}.jpg`,
    imageAlt: name
  };
}

function testConfig(name) {
  return {
    weapons: [{ name, usageRate: 50, sampleSize: 2, lowSample: false }],
    styles: [],
    souls: [],
    strategies: [{ cardId: "card-a", name: "計略", usageRate: 25, sampleSize: 1, strategyCount: 1, averageCount: 1 }],
    schoolStages: [{ name: "流派", stage: "1", usageRate: 25, sampleSize: 1, lowSample: false, averageCount: 1 }],
    unfavorableMatchups: [{ deckId: "enemy", deckName: "Enemy", usageRate: 20, sampleSize: 1 }]
  };
}

function testRow(deckId, deckName, sampleSize) {
  return {
    deckId,
    deckName,
    categoryId: "cat",
    categoryName: "号令",
    faction: "碧",
    namingSource: "single",
    rankScore: 1,
    sourceRank: 1,
    winRate: 55,
    playerAverageWinRate: 52,
    usageRate: 10,
    kabukiPoints: 12,
    sampleSize,
    imageUrl: "https://example.test/deck.jpg",
    imageAlt: deckName,
    deckCards: [testCard("card-a", "Alpha")],
    deckConfig: testConfig(deckName),
    evidenceTags: ["tag"],
    clusterVariants: [
      {
        deckId: `${deckId}-variant`,
        deckName: `${deckName} variant`,
        categoryId: "cat",
        categoryName: "号令",
        faction: "碧",
        namingSource: "single",
        rankScore: 2,
        winRate: 50,
        playerAverageWinRate: 49,
        usageRate: 5,
        kabukiPoints: 10,
        sampleSize: 1,
        imageUrl: "https://example.test/variant.jpg",
        imageAlt: "variant",
        deckCards: [testCard("card-b", "Beta")]
      }
    ]
  };
}

function testSnapshot() {
  const tierRow = testRow("deck-1", "Deck One", 10);
  const clusterRow = testRow("cluster-1", "Cluster One", 12);
  return {
    metadata: {
      sourceRunId: 42,
      sourceKind: "server_leaderboard",
      targetVersion: "Ver.test",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-02",
      updatedAt: "2026-06-02T00:00:00Z",
      sampleSize: 22
    },
    home: {
      factionShare: [],
      representativeDecks: [],
      featuredCards: [],
      summary: "",
      tierRows: [clusterRow]
    },
    tierRows: [tierRow],
    clusterRows: [clusterRow]
  };
}

function testBuildTierListFilesSplitsListAndConfigs() {
  const { tierListSnapshot, tierListConfigs } = buildTierListSnapshotFiles(testSnapshot());
  const listText = JSON.stringify(tierListSnapshot);
  const configsText = JSON.stringify(tierListConfigs);

  assert.equal(tierListSnapshot.schemaVersion, 1);
  assert.equal(tierListSnapshot.metadata.sourceRunId, 42);
  assert.equal(tierListSnapshot.tierRows.length, 1);
  assert.equal(tierListSnapshot.clusterRows.length, 1);
  assert.equal(tierListSnapshot.tierRows[0].deckConfig, undefined);
  assert.equal(tierListSnapshot.clusterRows[0].deckConfig, undefined);
  assert.equal(tierListSnapshot.clusterRows[0].clusterVariants[0].deckConfig, undefined);
  assert.equal(tierListConfigs.deckConfigs["deck-1"].strategies.length, 1);
  assert.equal(tierListConfigs.clusterConfigs["cluster-1"].schoolStages.length, 1);
  assert.equal(/token|cookie|secret|C:\\|E:\\/.test(listText), false);
  assert.equal(/token|cookie|secret|C:\\|E:\\/.test(configsText), false);
}

async function testWriteTierListFilesAtomically() {
  const root = await mkdtemp(join(tmpdir(), "tier-list-snapshot-"));
  const snapshotFile = join(root, "tier-list-snapshot.json");
  const configsFile = join(root, "tier-list-configs.json");

  try {
    const result = await writeTierListSnapshotFiles({
      snapshot: testSnapshot(),
      tierListSnapshotFile: snapshotFile,
      tierListConfigsFile: configsFile
    });
    const snapshot = JSON.parse(await readFile(snapshotFile, "utf8"));
    const configs = JSON.parse(await readFile(configsFile, "utf8"));

    assert.equal(result.tierRows, 1);
    assert.equal(result.clusterRows, 1);
    assert.equal(snapshot.tierRows[0].deckId, "deck-1");
    assert.equal(configs.deckConfigs["deck-1"].weapons[0].name, "Deck One");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

testBuildTierListFilesSplitsListAndConfigs();
await testWriteTierListFilesAtomically();

console.log("tier list snapshot tests passed");
