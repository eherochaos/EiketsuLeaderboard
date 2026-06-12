import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshLeaderboardSnapshot } from "./refresh-snapshot.mjs";

const deckA = "legacy-card-a1,card-a2";
const deckB = "card-b1,card-b2";

async function writeJson(path, payload) {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeJsonl(path, rows) {
  await writeFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function card(cardId, cardCode, name, extra = {}) {
  return {
    ...(cardId === "card-b2" ? { faction: "unknown" } : {}),
    ...extra,
    card_hash: cardId,
    card_code: cardCode,
    force: "",
    intelligence: "",
    image_url: `https://image.example.test/${cardId}.jpg`,
    label: `${name}(1.0 槍兵)`
  };
}

function officialGeneralRow(cardId, name, serial, skillIndexes = [], overrides = {}) {
  const skills = Array.isArray(skillIndexes) ? skillIndexes : String(skillIndexes || "").split(":").filter(Boolean);
  const fields = [
    cardId,
    `ds-${cardId}`,
    `face-${cardId}`,
    name,
    name,
    "0",
    "0",
    "1",
    "1",
    "0",
    "0",
    "0",
    String(serial),
    "0",
    "0",
    "-1",
    "0",
    "6",
    "3",
    skills[0] ?? "-1",
    skills[1] ?? "-1",
    skills[2] ?? "-1",
    "0",
    "0",
    "0",
    "0:4"
  ];
  if (cardId === "card-b2") Object.assign(fields, { 8: "PL", 12: "116" });
  Object.assign(fields, overrides);
  return fields.join(",");
}

function unknownFactionCount(payload) {
  return (JSON.stringify(payload).match(/"faction":"unknown"/g) || []).length;
}

function deckRow(id, deckId, cards, rank, winCount, lossCount, runId = 1) {
  const sampleCount = winCount + lossCount;
  return {
    id,
    run_id: runId,
    row_type: "deck",
    rank_scope: "all",
    cluster_enabled: 0,
    rank,
    sample_count: sampleCount,
    wilson_lower_bound: winCount > lossCount ? 0.9 : 0.1,
    row_json: {
      deck_fingerprint: deckId,
      deck_name: cards.map((item) => item.label).join(" / "),
      sample_count: sampleCount,
      win_count: winCount,
      loss_count: lossCount,
      draw_count: 0,
      win_rate: sampleCount ? winCount / sampleCount : null,
      cards,
      behavior_stats: {
        weapons: [{ name: "孫子", sample_count: sampleCount, usage_rate: 1, low_sample: true }],
        styles: [{ name: "士気", sample_count: sampleCount, usage_rate: 1, low_sample: true }],
        souls: []
      }
    }
  };
}

function archetypeRow(id, title, cards, rank, winCount, lossCount, representativeDeckId = deckB, memberDecks = [], runId = 1) {
  const sampleCount = winCount + lossCount;
  return {
    id,
    run_id: runId,
    row_type: "archetype",
    rank_scope: "all",
    cluster_enabled: 1,
    rank,
    sample_count: sampleCount,
    row_json: {
      archetype_id: `cluster-${id}`,
      title,
      sample_count: sampleCount,
      win_count: winCount,
      loss_count: lossCount,
      draw_count: 0,
      win_rate: sampleCount ? winCount / sampleCount : null,
      core_cards: cards.slice(0, 1),
      representative_deck: {
        deck_fingerprint: representativeDeckId,
        deck_name: cards.map((item) => item.label).join(" / "),
        cards
      },
      member_decks: memberDecks,
      behavior_stats: {
        weapons: [{ name: "瀛瓙", sample_count: sampleCount, usage_rate: 1, low_sample: true }],
        styles: [{ name: "澹皸", sample_count: sampleCount, usage_rate: 1, low_sample: true }],
        souls: []
      }
    }
  };
}

function matchSide(id, matchId, sideIndex, result, playerName) {
  return {
    id,
    match_id: matchId,
    side_index: sideIndex,
    role: "player",
    player_name: playerName,
    follow_id: String(id),
    result,
    profile_json: {
      battle_stats: {
        strategy_count: {
          by_slot: [3, 1]
        }
      }
    },
    selected_json: {
      school: {
        name: "士気",
        summary: "壱之型：発動 弐之型：発動 参之型：発動"
      }
    }
  };
}

async function createLegacyFixture(root, options = {}) {
  const tableRoot = join(root, "tables");
  const cardRoot = join(root, "cards");
  const includeBattleFestival = Boolean(options.includeBattleFestival);
  const includeBattleFestivalMatches = Boolean(options.includeBattleFestivalMatches);
  const battleFestivalUploadScope = options.battleFestivalUploadScope || null;
  await mkdir(tableRoot, { recursive: true });
  await mkdir(cardRoot, { recursive: true });
  await writeJsonl(join(tableRoot, "server_share_config.jsonl"), [
    { id: 1, target_version: "Ver.test", updated_at: "2026-05-25T00:00:00" }
  ]);
  if (battleFestivalUploadScope) {
    await writeJsonl(join(tableRoot, "server_uploads.jsonl"), [
      {
        id: 10,
        status: "completed",
        package_id: "pkg-battle-festival",
        target_version: "Ver.test",
        date_from: "2026-06-11",
        date_to: "2026-06-12",
        imported_match_count: 0,
        ...battleFestivalUploadScope.upload
      }
    ]);
    await writeJsonl(join(tableRoot, "shared_contribution_packages.jsonl"), [
      {
        id: 20,
        package_id: "pkg-battle-festival",
        target_version: "Ver.test",
        mode_scope: "battle_festival",
        festival_date_from: "2026-06-11",
        festival_date_to: "2026-06-13",
        ...battleFestivalUploadScope.package
      }
    ]);
  }
  const runs = [
    {
      id: 1,
      status: "ready",
      target_version: "Ver.test",
      date_from: "2026-05-20",
      date_to: "2026-05-25",
      include_solo: 0,
      include_battle_festival: 0,
      generated_at: "2026-05-25T00:00:00",
      updated_at: "2026-05-25T00:00:00"
    }
  ];
  if (includeBattleFestival) {
    runs.push({
      id: 2,
      status: "ready",
      target_version: "Ver.test",
      date_from: "2026-06-10",
      date_to: "2026-06-14",
      include_solo: 0,
      include_battle_festival: 1,
      generated_at: "2026-06-12T00:00:00",
      updated_at: "2026-06-12T00:00:00"
    });
  }
  await writeJsonl(join(tableRoot, "server_leaderboard_runs.jsonl"), runs);
  const rows = [
    deckRow(1, deckA, [card("legacy-card-a1", "蒼001", "Alpha"), card("card-a2", "蒼002", "Beta")], 1, 0, 1),
    deckRow(2, deckB, [card("card-b1", "緋001", "Gamma"), card("card-b2", "緋002", "Delta")], 2, 1, 0),
    archetypeRow(3, "Published Cluster", [card("card-b1", "緋001", "Gamma"), card("card-b2", "緋002", "Delta")], 1, 4, 1, deckB, [
      { deck_fingerprint: deckA, sample_count: 2 },
      { deck_fingerprint: deckB, sample_count: 3 }
    ]),
    archetypeRow(4, "Published Cluster", [card("card-b1", "緋001", "Gamma"), card("card-a2", "蒼002", "Beta")], 2, 1, 0, deckB, [
      { deck_fingerprint: deckB, sample_count: 1 }
    ]),
    archetypeRow(5, "Late Better Cluster", [card("legacy-card-a1", "蒼001", "Alpha"), card("card-a2", "蒼002", "Beta")], 99, 10, 0, deckA, [
      { deck_fingerprint: deckA, sample_count: 10 }
    ])
  ];
  if (includeBattleFestival) {
    rows.push(deckRow(6, deckA, [card("legacy-card-a1", "蒼001", "Alpha"), card("card-a2", "蒼002", "Beta")], 1, 3, 1, 2));
  }
  await writeJsonl(join(tableRoot, "server_leaderboard_rows.jsonl"), rows);
  const matches = [
    {
      id: 1,
      version: "Ver.test",
      played_at: "2026-05-21 12:00",
      created_at: "2026-05-21 12:00",
      play_url: "https://eiketsu.example.test/play/1",
      detail_url: "https://eiketsu.example.test/detail/1",
      replay_id: "fixture-replay-1"
    }
  ];
  if (includeBattleFestivalMatches) {
    matches.push({
      id: 2,
      version: "Ver.test",
      mode: "戦祭り",
      played_at: "2026-05-24 18:00",
      created_at: "2026-05-24 18:00",
      play_url: "https://eiketsu.example.test/play/battle-festival",
      detail_url: "https://eiketsu.example.test/detail/battle-festival",
      replay_id: "battle-festival-replay"
    });
  }
  await writeJsonl(join(tableRoot, "matches.jsonl"), matches);
  const matchDecks = [
    { id: 1, match_id: 1, side_index: 0, deck_fingerprint: deckA },
    { id: 2, match_id: 1, side_index: 1, deck_fingerprint: deckB }
  ];
  if (includeBattleFestivalMatches) {
    matchDecks.push(
      { id: 3, match_id: 2, side_index: 0, deck_fingerprint: deckA },
      { id: 4, match_id: 2, side_index: 1, deck_fingerprint: deckB }
    );
  }
  await writeJsonl(join(tableRoot, "match_decks.jsonl"), matchDecks);
  const matchSides = [
    matchSide(1, 1, 0, "loss", "alice"),
    matchSide(2, 1, 1, "win", "bob")
  ];
  if (includeBattleFestivalMatches) {
    matchSides.push(
      matchSide(3, 2, 0, "win", "carol"),
      matchSide(4, 2, 1, "loss", "dave")
    );
  }
  await writeJsonl(join(tableRoot, "match_sides.jsonl"), matchSides);
  const matchDeckUnits = [
    { id: 1, deck_id: 1, slot: 1, card_hash: "card-a1" },
    { id: 2, deck_id: 1, slot: 2, card_hash: "card-a2" },
    { id: 3, deck_id: 2, slot: 1, card_hash: "card-b1" },
    { id: 4, deck_id: 2, slot: 2, card_hash: "card-b2" }
  ];
  if (includeBattleFestivalMatches) {
    matchDeckUnits.push(
      { id: 5, deck_id: 3, slot: 1, card_hash: "card-a1" },
      { id: 6, deck_id: 3, slot: 2, card_hash: "card-a2" },
      { id: 7, deck_id: 4, slot: 1, card_hash: "card-b1" },
      { id: 8, deck_id: 4, slot: 2, card_hash: "card-b2" }
    );
  }
  await writeJsonl(join(tableRoot, "match_deck_units.jsonl"), matchDeckUnits);
  await writeJson(join(cardRoot, "card_catalog.json"), {
    cards: [
      { hash_id: "card-a1", card_code: "蒼001", name: "Alpha", faction: "蒼", cost: "1.0", unitType: "妲嶅叺" },
      { hash_id: "card-a2", card_code: "蒼002", name: "Beta", faction: "蒼", cost: "1.0", unitType: "妲嶅叺" },
      { hash_id: "card-b1", card_code: "緋001", name: "Gamma", faction: "緋", cost: "1.0", unitType: "妲嶅叺" },
      { hash_id: "card-b2", card_code: "緋002", name: "Delta", faction: "緋", cost: "1.0", unitType: "妲嶅叺" }
    ]
  });
  await writeJson(join(cardRoot, "card_catalog_overlay.json"), { cards: [] });
  await writeJson(join(cardRoot, "datalist_api_base.json"), {
    color: ["color-a,蒼,30,60,160"],
    period: ["period-a,戦国"],
    cost: ["cost-a,1.0,10"],
    skill: ["skill-a,伏兵,伏,hidden,0", "skill-b,気合,気,grit,0"],
    unitType: ["unit-a,槍兵"],
    general: [
      officialGeneralRow("card-a1", "Alpha", 1, "0:1"),
      officialGeneralRow("card-a2", "Beta", 2),
      officialGeneralRow("card-b1", "Gamma", 3),
      officialGeneralRow("card-b2", "Delta", 4)
    ]
  });
}

async function testRefreshWritesAtomicSnapshot() {
  const root = await mkdtemp(join(tmpdir(), "leaderboard-refresh-"));
  const legacyRoot = join(root, "legacy-service");
  const outputPath = join(root, "published", "leaderboard-snapshot.json");

  try {
    await createLegacyFixture(legacyRoot);
    const logs = [];
    const originalLog = console.log;
    let snapshot;
    let battleFestival;
    try {
      console.log = (...args) => logs.push(args.join(" "));
      ({ snapshot, battleFestival } = await refreshLeaderboardSnapshot({ legacyRoot, outputPath, logDiagnostics: true }));
    } finally {
      console.log = originalLog;
    }
    const outputText = await readFile(outputPath, "utf8");
    const output = JSON.parse(outputText);
    const tierListText = await readFile(join(root, "published", "tier-list-snapshot.json"), "utf8");
    const tierList = JSON.parse(tierListText);
    const tierListConfigsText = await readFile(join(root, "published", "tier-list-configs.json"), "utf8");
    const tierListConfigs = JSON.parse(tierListConfigsText);
    const battleFestivalText = await readFile(join(root, "published", "battle-festival-snapshot.json"), "utf8");
    const battleFestivalSnapshot = JSON.parse(battleFestivalText);
    const battleFestivalConfigsText = await readFile(join(root, "published", "battle-festival-configs.json"), "utf8");
    const battleFestivalConfigs = JSON.parse(battleFestivalConfigsText);

    assert.equal(snapshot.metadata.sourceRunId, 1);
    assert.equal(battleFestival.status, "empty");
    assert.equal(battleFestival.sourceRunId, 0);
    assert.equal(output.metadata.sourceKind, "server_leaderboard");
    assert.equal(output.tierRows.length, 2);
    assert.equal(output.clusterRows.length, 2);
    assert.equal(tierList.tierRows.length, 2);
    assert.equal(tierList.clusterRows.length, 2);
    assert.equal(tierList.tierRows[0].deckConfig, undefined);
    assert.equal(battleFestivalSnapshot.metadata.sourceRunId, 0);
    assert.equal(battleFestivalSnapshot.metadata.sourceKind, "battle_festival");
    assert.equal(battleFestivalSnapshot.metadata.targetVersion, output.metadata.targetVersion);
    assert.equal(battleFestivalSnapshot.metadata.dateFrom, output.metadata.dateFrom);
    assert.equal(battleFestivalSnapshot.metadata.dateTo, output.metadata.dateTo);
    assert.equal(battleFestivalSnapshot.metadata.sampleSize, 0);
    assert.equal(battleFestivalSnapshot.tierRows.length, 0);
    assert.equal(battleFestivalSnapshot.clusterRows.length, 0);
    assert.deepEqual(battleFestivalConfigs.deckConfigs, {});
    assert.deepEqual(battleFestivalConfigs.clusterConfigs, {});
    assert.ok(tierListConfigs.deckConfigs[output.tierRows[0].deckId].strategies.length > 0);
    assert.ok(tierListConfigs.clusterConfigs[output.clusterRows[0].deckId].schoolStages.length > 0);
    assert.equal(output.home.tierRows.length, 2);
    assert.match(output.home.tierRows[0].deckName, /バランスデッキ$/);
    assert.equal(output.home.tierRows[0].sampleSize, 10);
    assert.equal(output.home.tierRows[0].rankScore, 1);
    assert.equal(output.home.tierRows[1].sampleSize, 6);
    assert.equal(output.home.tierRows[1].rankScore, 2);
    assert.ok(output.home.tierRows[0].sourceRank > output.home.tierRows[1].sourceRank);
    const multiVariantCluster = output.clusterRows.find((row) => row.sampleSize === 6);
    assert.ok(multiVariantCluster);
    assert.equal(multiVariantCluster.clusterVariants.length, 2);
    assert.equal(multiVariantCluster.clusterVariants.reduce((sum, row) => sum + row.sampleSize, 0), 6);
    assert.equal(multiVariantCluster.winRate, 83.3);
    assert.equal(multiVariantCluster.playerAverageWinRate, 66.7);
    assert.notEqual(multiVariantCluster.playerAverageWinRate, multiVariantCluster.winRate);
    assert.equal(output.tierRows[0].deckCards[0].cost, "1.0");
    assert.equal(output.tierRows[0].deckCards[0].unitType, "槍兵");
    assert.ok(logs.some((line) => line.includes("repairedCardUnitType value=妲嶅叺 repaired=槍兵")));
    assert.equal(output.tierRows[0].deckCards[0].force, "6");
    assert.equal(output.tierRows[0].deckCards[0].intelligence, "3");
    const skillCard = output.tierRows.flatMap((row) => row.deckCards).find((card) => card.cardId === "legacy-card-a1");
    assert.ok(skillCard);
    assert.deepEqual(skillCard.skills, ["伏兵", "気合"]);
    const noSkillCard = output.tierRows.flatMap((row) => row.deckCards).find((card) => card.cardId === "card-a2");
    assert.ok(noSkillCard);
    assert.deepEqual(noSkillCard.skills, []);
    const plCard = output.tierRows.flatMap((row) => row.deckCards).find((card) => card.cardId === "card-b2");
    assert.ok(plCard);
    assert.equal(plCard.faction, "\u84bc");
    assert.equal(unknownFactionCount(output), 0);
    assert.equal(unknownFactionCount(tierList), 0);
    assert.ok(output.tierRows.some((row) => row.deckConfig.strategies.length > 0));
    assert.ok(output.tierRows.some((row) => row.deckConfig.schoolStages.length > 0));
    assert.ok(output.tierRows.some((row) => row.deckConfig.unfavorableMatchups.length > 0));
    const stageWithMatch = output.tierRows.flatMap((row) => row.deckConfig.schoolStages)
      .find((item) => item.highlightMatchUrl);
    assert.ok(stageWithMatch);
    assert.equal(stageWithMatch.highlightMatchUrl, "https://eiketsu.example.test/play/1");
    assert.match(stageWithMatch.highlightMatchLabel, /2026-05-21/);
    assert.ok(output.clusterRows.some((row) => row.deckConfig.strategies.length > 0));
    assert.ok(output.clusterRows.some((row) => row.deckConfig.schoolStages.length > 0));
    assert.ok(output.clusterRows.some((row) => row.deckConfig.unfavorableMatchups.length > 0));
    assert.ok(output.clusterRows.flatMap((row) => row.deckConfig.schoolStages)
      .some((item) => item.highlightMatchUrl === "https://eiketsu.example.test/play/1"));
    assert.ok(output.home.tierRows.some((row) => row.deckConfig.strategies.length > 0));
    assert.equal(/token|cookie|secret|C:\\|E:\\/.test(outputText), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRefreshWritesBattleFestivalSnapshot() {
  const root = await mkdtemp(join(tmpdir(), "battle-festival-refresh-"));
  const legacyRoot = join(root, "legacy-service");
  const outputPath = join(root, "published", "leaderboard-snapshot.json");

  try {
    await createLegacyFixture(legacyRoot, { includeBattleFestival: true });
    const { snapshot, battleFestival } = await refreshLeaderboardSnapshot({ legacyRoot, outputPath, logDiagnostics: false });
    const battleFestivalText = await readFile(join(root, "published", "battle-festival-snapshot.json"), "utf8");
    const battleFestivalSnapshot = JSON.parse(battleFestivalText);
    const battleFestivalConfigsText = await readFile(join(root, "published", "battle-festival-configs.json"), "utf8");
    const battleFestivalConfigs = JSON.parse(battleFestivalConfigsText);

    assert.equal(snapshot.metadata.sourceRunId, 1);
    assert.equal(battleFestival.status, "completed");
    assert.equal(battleFestival.sourceRunId, 2);
    assert.equal(battleFestivalSnapshot.metadata.sourceRunId, 2);
    assert.equal(battleFestivalSnapshot.metadata.sourceKind, "battle_festival");
    assert.equal(battleFestivalSnapshot.metadata.dateFrom, "2026-06-10");
    assert.equal(battleFestivalSnapshot.metadata.dateTo, "2026-06-14");
    assert.equal(battleFestivalSnapshot.tierRows.length, 1);
    assert.ok(battleFestivalConfigs.deckConfigs[battleFestivalSnapshot.tierRows[0].deckId]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRefreshBuildsBattleFestivalSnapshotFromMatches() {
  const root = await mkdtemp(join(tmpdir(), "battle-festival-matches-refresh-"));
  const legacyRoot = join(root, "legacy-service");
  const outputPath = join(root, "published", "leaderboard-snapshot.json");

  try {
    await createLegacyFixture(legacyRoot, { includeBattleFestivalMatches: true });
    const { battleFestival } = await refreshLeaderboardSnapshot({ legacyRoot, outputPath, logDiagnostics: false });
    const battleFestivalText = await readFile(join(root, "published", "battle-festival-snapshot.json"), "utf8");
    const battleFestivalSnapshot = JSON.parse(battleFestivalText);

    assert.equal(battleFestival.status, "completed");
    assert.equal(battleFestival.sourceRunId, 0);
    assert.equal(battleFestivalSnapshot.metadata.sourceKind, "battle_festival");
    assert.equal(battleFestivalSnapshot.metadata.sampleSize, 2);
    assert.equal(battleFestivalSnapshot.tierRows.length, 2);
    assert.ok(battleFestivalSnapshot.tierRows.some((row) => row.deckId === deckA));
    assert.ok(battleFestivalSnapshot.tierRows.some((row) => row.deckId === deckB));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRefreshWritesManifestOnlyBattleFestivalSnapshot() {
  const root = await mkdtemp(join(tmpdir(), "battle-festival-empty-refresh-"));
  const legacyRoot = join(root, "legacy-service");
  const outputPath = join(root, "published", "leaderboard-snapshot.json");

  try {
    await createLegacyFixture(legacyRoot, {
      battleFestivalUploadScope: {
        upload: { mode_scope: "tier_list", festival_date_from: "", festival_date_to: "" },
        package: {
          mode_scope: "battle_festival",
          festival_date_from: "2026-06-11",
          festival_date_to: "2026-06-13"
        }
      }
    });
    const { battleFestival } = await refreshLeaderboardSnapshot({ legacyRoot, outputPath, logDiagnostics: false });
    const battleFestivalText = await readFile(join(root, "published", "battle-festival-snapshot.json"), "utf8");
    const battleFestivalSnapshot = JSON.parse(battleFestivalText);

    assert.equal(battleFestival.status, "completed");
    assert.equal(battleFestival.sourceRunId, 0);
    assert.equal(battleFestivalSnapshot.metadata.sourceKind, "battle_festival");
    assert.equal(battleFestivalSnapshot.metadata.dateFrom, "2026-06-11");
    assert.equal(battleFestivalSnapshot.metadata.dateTo, "2026-06-13");
    assert.equal(battleFestivalSnapshot.metadata.sampleSize, 0);
    assert.equal(battleFestivalSnapshot.tierRows.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await testRefreshWritesAtomicSnapshot();
await testRefreshWritesBattleFestivalSnapshot();
await testRefreshBuildsBattleFestivalSnapshotFromMatches();
await testRefreshWritesManifestOnlyBattleFestivalSnapshot();

console.log("leaderboard snapshot refresh tests passed");
