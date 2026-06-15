import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshLeaderboardSnapshot } from "./refresh-snapshot.mjs";

const deckA = "legacy-card-a1,card-a2";
const deckB = "card-b1,card-b2";
const battleCardA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const battleCardB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const battleCardC = "cccccccccccccccccccccccccccccccc";
const battleCardD = "dddddddddddddddddddddddddddddddd";
const battleDeckA = `${battleCardA},${battleCardB}`;
const battleDeckB = `${battleCardC},${battleCardD}`;
const battleCampKey = "\u6240\u5c5e\u9663\u55b6";

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
    label: extra.label ?? `${name}(1.0 槍兵)`
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

function matchSide(id, matchId, sideIndex, result, playerName, profile = {}, overrides = {}) {
  return {
    id,
    match_id: matchId,
    side_index: sideIndex,
    role: overrides.role || "player",
    player_name: playerName,
    follow_id: "followId" in overrides ? overrides.followId : String(id),
    result,
    profile_json: {
      ...profile,
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

function deckUnitRows(startId, deckId, deckFingerprint) {
  return String(deckFingerprint || "")
    .split(",")
    .filter(Boolean)
    .map((cardHash, index) => ({
      id: startId + index,
      deck_id: deckId,
      slot: index + 1,
      card_hash: cardHash
    }));
}

async function createLegacyFixture(root, options = {}) {
  const tableRoot = join(root, "tables");
  const cardRoot = join(root, "cards");
  const includeBattleFestival = Boolean(options.includeBattleFestival);
  const includeBattleFestivalMatches = Boolean(options.includeBattleFestivalMatches);
  const includeBattleFestivalCamp = options.includeBattleFestivalCamp !== false;
  const includeBattleFestivalMeritSamples = Boolean(options.includeBattleFestivalMeritSamples);
  const includeBattleFestivalOpenPeriodStartMatch = Boolean(options.includeBattleFestivalOpenPeriodStartMatch);
  const battleFestivalUploadScope = options.battleFestivalUploadScope || null;
  const battleFestivalUploadScopes = options.battleFestivalUploadScopes || (battleFestivalUploadScope ? [battleFestivalUploadScope] : []);
  await mkdir(tableRoot, { recursive: true });
  await mkdir(cardRoot, { recursive: true });
  await writeJsonl(join(tableRoot, "server_share_config.jsonl"), [
    { id: 1, target_version: "Ver.test", updated_at: "2026-05-25T00:00:00" }
  ]);
  if (battleFestivalUploadScopes.length) {
    await writeJsonl(join(tableRoot, "server_uploads.jsonl"), battleFestivalUploadScopes.map((scope, index) => ({
      id: 10 + index,
      status: "completed",
      package_id: `pkg-battle-festival-${index}`,
      target_version: "Ver.test",
      date_from: "2026-06-11",
      date_to: "2026-06-12",
      imported_match_count: 0,
      ...scope.upload
    })));
    await writeJsonl(join(tableRoot, "shared_contribution_packages.jsonl"), battleFestivalUploadScopes.map((scope, index) => ({
      id: 20 + index,
      package_id: `pkg-battle-festival-${index}`,
      target_version: "Ver.test",
      mode_scope: "battle_festival",
      festival_date_from: "2026-06-11",
      festival_date_to: "2026-06-13",
      festival_period_source: "official",
      ...scope.package
    })));
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
    deckRow(2, deckB, [card("card-b1", "緋001", "Gamma"), card("card-b2", "緋002", "Delta", { label: "未识别卡(card-b2)" })], 2, 1, 0),
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
    if (includeBattleFestivalOpenPeriodStartMatch) {
      matches.push({
        id: 9,
        version: "Ver.test",
        mode: matches[matches.length - 1].mode,
        played_at: "2026-05-22 13:00",
        created_at: "2026-05-22 13:00",
        play_url: "https://eiketsu.example.test/play/battle-festival-period-start",
        detail_url: "https://eiketsu.example.test/detail/battle-festival-period-start",
        replay_id: "battle-festival-replay-period-start"
      });
    }
    if (includeBattleFestivalMeritSamples) {
      matches.push(
        {
          id: 3,
          version: "Ver.test",
          mode: "戦祭り",
          played_at: "2026-05-24 19:00",
          created_at: "2026-05-24 19:00",
          play_url: "https://eiketsu.example.test/play/battle-festival-3",
          detail_url: "https://eiketsu.example.test/detail/battle-festival-3",
          replay_id: "battle-festival-replay-3"
        },
        {
          id: 4,
          version: "Ver.test",
          mode: "戦祭り",
          played_at: "2026-05-24 22:00",
          created_at: "2026-05-24 22:00",
          play_url: "https://eiketsu.example.test/play/battle-festival-4",
          detail_url: "https://eiketsu.example.test/detail/battle-festival-4",
          replay_id: "battle-festival-replay-4"
        },
        {
          id: 5,
          version: "Ver.test",
          mode: "戦祭り",
          played_at: "2026-05-24 23:00",
          created_at: "2026-05-24 23:00",
          play_url: "https://eiketsu.example.test/play/battle-festival-5",
          detail_url: "https://eiketsu.example.test/detail/battle-festival-5",
          replay_id: "battle-festival-replay-5"
        },
        {
          id: 6,
          version: "Ver.test",
          mode: "戦祭り",
          played_at: "2026-05-25 01:00",
          created_at: "2026-05-25 01:00",
          play_url: "https://eiketsu.example.test/play/battle-festival-6",
          detail_url: "https://eiketsu.example.test/detail/battle-festival-6",
          replay_id: "battle-festival-replay-6"
        },
        {
          id: 7,
          version: "Ver.test",
          mode: "戦祭り",
          played_at: "2026-05-25 02:00",
          created_at: "2026-05-25 02:00",
          play_url: "https://eiketsu.example.test/play/battle-festival-7",
          detail_url: "https://eiketsu.example.test/detail/battle-festival-7",
          replay_id: "battle-festival-replay-7"
        },
        {
          id: 8,
          version: "Ver.test",
          mode: "戦祭り",
          played_at: "2026-05-25 02:12",
          created_at: "2026-05-25 02:12",
          play_url: "https://eiketsu.example.test/play/battle-festival-8",
          detail_url: "https://eiketsu.example.test/detail/battle-festival-8",
          replay_id: "battle-festival-replay-8"
        }
      );
    }
  }
  await writeJsonl(join(tableRoot, "matches.jsonl"), matches);
  const matchDecks = [
    { id: 1, match_id: 1, side_index: 0, deck_fingerprint: deckA },
    { id: 2, match_id: 1, side_index: 1, deck_fingerprint: deckB }
  ];
  if (includeBattleFestivalMatches) {
    matchDecks.push(
      { id: 3, match_id: 2, side_index: 0, deck_fingerprint: battleDeckA },
      { id: 4, match_id: 2, side_index: 1, deck_fingerprint: battleDeckB }
    );
    if (includeBattleFestivalOpenPeriodStartMatch) {
      matchDecks.push(
        { id: 50, match_id: 9, side_index: 0, deck_fingerprint: battleDeckA },
        { id: 51, match_id: 9, side_index: 1, deck_fingerprint: battleDeckB }
      );
    }
    if (includeBattleFestivalMeritSamples) {
      matchDecks.push(
        { id: 5, match_id: 3, side_index: 0, deck_fingerprint: battleDeckA },
        { id: 6, match_id: 3, side_index: 1, deck_fingerprint: battleDeckB },
        { id: 7, match_id: 4, side_index: 0, deck_fingerprint: battleDeckA },
        { id: 8, match_id: 4, side_index: 1, deck_fingerprint: battleDeckB },
        { id: 9, match_id: 5, side_index: 0, deck_fingerprint: battleDeckA },
        { id: 10, match_id: 5, side_index: 1, deck_fingerprint: battleDeckB },
        { id: 11, match_id: 6, side_index: 0, deck_fingerprint: battleDeckA },
        { id: 12, match_id: 6, side_index: 1, deck_fingerprint: battleDeckA },
        { id: 13, match_id: 7, side_index: 0, deck_fingerprint: battleDeckA },
        { id: 14, match_id: 7, side_index: 1, deck_fingerprint: battleDeckB },
        { id: 15, match_id: 8, side_index: 0, deck_fingerprint: battleDeckA },
        { id: 16, match_id: 8, side_index: 1, deck_fingerprint: battleDeckB }
      );
    }
  }
  await writeJsonl(join(tableRoot, "match_decks.jsonl"), matchDecks);
  const matchSides = [
    matchSide(1, 1, 0, "loss", "alice"),
    matchSide(2, 1, 1, "win", "bob")
  ];
  if (includeBattleFestivalMatches) {
    const campProfiles = includeBattleFestivalCamp
      ? [{ [battleCampKey]: "\u6bb7\u8ecd" }, { [battleCampKey]: "\u5468\u8ecd" }]
      : [{}, {}];
    matchSides.push(
      matchSide(3, 2, 0, "win", "carol", campProfiles[0]),
      matchSide(4, 2, 1, "loss", "dave", campProfiles[1])
    );
    if (includeBattleFestivalOpenPeriodStartMatch) {
      matchSides.push(
        matchSide(50, 9, 0, "win", "period-start-rank", { ...campProfiles[0], "\u6226\u529f": "307822" }),
        matchSide(51, 9, 1, "loss", "period-start-opponent", campProfiles[1])
      );
    }
    if (includeBattleFestivalMeritSamples) {
      const yinCamp = includeBattleFestivalCamp ? { [battleCampKey]: "\u6bb7\u8ecd" } : {};
      const zhouCamp = includeBattleFestivalCamp ? { [battleCampKey]: "\u5468\u8ecd" } : {};
      matchSides.push(
        matchSide(5, 3, 0, "win", "odds-only", { ...yinCamp, "\u6226\u529f\u30aa\u30c3\u30ba": "\u00d79.9" }),
        matchSide(6, 3, 1, "unknown", "\u5929\u304b\u3089\u304a\u5869", { ...zhouCamp, "\u6226\u529f": "2100" }, { role: "enemy", followId: "" }),
        matchSide(7, 4, 0, "loss", "odds-only-2", { ...yinCamp, "\u6226\u529f\u30aa\u30c3\u30ba": "\u00d71.3" }),
        matchSide(8, 4, 1, "unknown", "\u5929\u304b\u3089\u304a\u5869", { ...zhouCamp, "\u6226\u529f": "124194" }, { role: "enemy", followId: "" }),
        matchSide(9, 5, 0, "win", "single-probe", yinCamp),
        matchSide(10, 5, 1, "unknown", "\u5358\u767a\u738b", { ...zhouCamp, "\u6226\u529f": "999999" }, { role: "enemy", followId: "" }),
        matchSide(11, 6, 0, "loss", "odds-only-3", yinCamp),
        matchSide(12, 6, 1, "unknown", "\u5929\u304b\u3089\u304a\u5869", { ...zhouCamp, "\u6226\u529f": "45000" }, { role: "enemy", followId: "" }),
        matchSide(13, 7, 0, "loss", "runner-opponent-1", yinCamp),
        matchSide(14, 7, 1, "unknown", "\u6700\u65b0\u65e5\u30e9\u30f3\u30ca\u30fc", { ...zhouCamp, "\u6226\u529f": "1000" }, { role: "enemy", followId: "" }),
        matchSide(15, 8, 0, "loss", "runner-opponent-2", yinCamp),
        matchSide(16, 8, 1, "unknown", "\u6700\u65b0\u65e5\u30e9\u30f3\u30ca\u30fc", { ...zhouCamp, "\u6226\u529f": "7000" }, { role: "enemy", followId: "" })
      );
    }
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
      ...deckUnitRows(5, 3, battleDeckA),
      ...deckUnitRows(7, 4, battleDeckB)
    );
    if (includeBattleFestivalOpenPeriodStartMatch) {
      matchDeckUnits.push(
        ...deckUnitRows(50, 50, battleDeckA),
        ...deckUnitRows(52, 51, battleDeckB)
      );
    }
    if (includeBattleFestivalMeritSamples) {
      matchDeckUnits.push(
        ...deckUnitRows(9, 5, battleDeckA),
        ...deckUnitRows(11, 6, battleDeckB),
        ...deckUnitRows(13, 7, battleDeckA),
        ...deckUnitRows(15, 8, battleDeckB),
        ...deckUnitRows(17, 9, battleDeckA),
        ...deckUnitRows(19, 10, battleDeckB),
        ...deckUnitRows(21, 11, battleDeckA),
        ...deckUnitRows(23, 12, battleDeckA)
      );
    }
  }
  await writeJsonl(join(tableRoot, "match_deck_units.jsonl"), matchDeckUnits);
  await writeJson(join(cardRoot, "card_catalog.json"), {
    cards: [
      { hash_id: battleCardA, card_code: "BA001", name: "Battle Alpha", faction: "\u84bc", cost: "1.0", unitType: "\u69cd\u5175" },
      { hash_id: battleCardB, card_code: "BA002", name: "Battle Beta", faction: "\u84bc", cost: "1.0", unitType: "\u69cd\u5175" },
      { hash_id: battleCardC, card_code: "BB001", name: "Battle Gamma", faction: "\u7dcb", cost: "1.0", unitType: "\u5f13\u5175" },
      { hash_id: battleCardD, card_code: "BB002", name: "Battle Delta", faction: "\u7dcb", cost: "1.0", unitType: "\u5f13\u5175" },
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
    assert.equal(plCard.name, "Delta");
    assert.equal(plCard.imageAlt, "Delta");
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
    await createLegacyFixture(legacyRoot, {
      includeBattleFestivalMatches: true,
      battleFestivalUploadScope: {
        upload: {
          id: 74,
          package_id: "pkg-battle-source",
          match_count: 4,
          imported_match_count: 2,
          date_from: "2026-05-24",
          date_to: "2026-05-25",
          festival_date_from: "2026-06-14",
          festival_date_to: "2026-06-14",
          created_at: "2026-06-14T02:06:00Z"
        },
        package: {
          package_id: "pkg-battle-source",
          festival_date_from: "2026-05-24",
          festival_date_to: "2026-05-25"
        }
      }
    });
    const { battleFestival } = await refreshLeaderboardSnapshot({ legacyRoot, outputPath, logDiagnostics: false });
    const battleFestivalText = await readFile(join(root, "published", "battle-festival-snapshot.json"), "utf8");
    const battleFestivalSnapshot = JSON.parse(battleFestivalText);

    assert.equal(battleFestival.status, "completed");
    assert.equal(battleFestival.sourceRunId, 0);
    assert.equal(battleFestivalSnapshot.metadata.sourceKind, "battle_festival");
    assert.equal(battleFestivalSnapshot.metadata.sourceUploadId, 74);
    assert.equal(battleFestivalSnapshot.metadata.sourcePackageId, "pkg-battle-source");
    assert.equal(battleFestivalSnapshot.metadata.sourceImportedMatchCount, 2);
    assert.equal(battleFestivalSnapshot.metadata.sourceMatchCount, 4);
    assert.equal(battleFestivalSnapshot.metadata.sourceUploadCreatedAt, "2026-06-14T02:06:00Z");
    assert.equal(battleFestivalSnapshot.metadata.periodSourceUploadId, 74);
    assert.equal(battleFestivalSnapshot.metadata.periodSourcePackageId, "pkg-battle-source");
    assert.equal(battleFestivalSnapshot.metadata.periodStatus, "official");
    assert.equal(battleFestivalSnapshot.metadata.festivalPeriodSource, "official");
    assert.equal(battleFestivalSnapshot.metadata.dateFrom, "2026-05-24");
    assert.equal(battleFestivalSnapshot.metadata.dateTo, "2026-05-25");
    assert.equal(battleFestivalSnapshot.metadata.sampleSize, 2);
    assert.equal(battleFestivalSnapshot.tierRows.length, 2);
    assert.ok(battleFestivalSnapshot.tierRows.some((row) => row.deckId === battleDeckA));
    assert.ok(battleFestivalSnapshot.tierRows.some((row) => row.deckId === battleDeckB));
    const battleDeckRow = battleFestivalSnapshot.tierRows.find((row) => row.deckId === battleDeckA);
    assert.equal(battleDeckRow.imageUrl, `https://image.eiketsu-taisen.net/general/card_small/${battleCardA}.jpg`);
    assert.equal(battleDeckRow.deckCards[0].imageUrl, `https://image.eiketsu-taisen.net/general/card_small/${battleCardA}.jpg`);
    assert.deepEqual(
      battleFestivalSnapshot.battleFestival.campShare.map((item) => item.camp).sort(),
      ["\u5468\u8ecd", "\u6bb7\u8ecd"].sort()
    );
    const yinCamp = battleFestivalSnapshot.battleFestival.campShare.find((item) => item.camp === "\u6bb7\u8ecd");
    const zhouCamp = battleFestivalSnapshot.battleFestival.campShare.find((item) => item.camp === "\u5468\u8ecd");
    assert.equal(yinCamp.sampleSize, 1);
    assert.equal(yinCamp.winRate, 100);
    assert.equal(zhouCamp.sampleSize, 1);
    assert.equal(zhouCamp.winRate, 0);
    const yinRows = battleFestivalSnapshot.battleFestival.rowsByCamp["\u6bb7\u8ecd"].tierRows;
    const zhouRows = battleFestivalSnapshot.battleFestival.rowsByCamp["\u5468\u8ecd"].tierRows;
    assert.equal(yinRows.length, 1);
    assert.equal(zhouRows.length, 1);
    assert.equal(yinRows[0].deckId, battleDeckA);
    assert.equal(yinRows[0].battleCamp, "\u6bb7\u8ecd");
    assert.equal(yinRows[0].winRate, 100);
    assert.equal(zhouRows[0].deckId, battleDeckB);
    assert.equal(zhouRows[0].battleCamp, "\u5468\u8ecd");
    assert.equal(zhouRows[0].winRate, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRefreshSkipsSingleDayBattleFestivalWithoutOfficialPeriod() {
  const root = await mkdtemp(join(tmpdir(), "battle-festival-single-day-skip-refresh-"));
  const legacyRoot = join(root, "legacy-service");
  const outputPath = join(root, "published", "leaderboard-snapshot.json");

  try {
    await createLegacyFixture(legacyRoot, {
      includeBattleFestivalMatches: true,
      includeBattleFestivalOpenPeriodStartMatch: true,
      battleFestivalUploadScope: {
        upload: {
          id: 76,
          package_id: "pkg-battle-single-day",
          match_count: 2,
          imported_match_count: 2,
          date_from: "2026-05-24",
          date_to: "2026-05-24",
          festival_date_from: "",
          festival_date_to: "",
          created_at: "2026-05-24T06:19:12Z"
        },
        package: {
          package_id: "pkg-battle-single-day",
          mode_scope: "battle_festival",
          festival_date_from: "",
          festival_date_to: ""
        }
      }
    });
    const { battleFestival } = await refreshLeaderboardSnapshot({ legacyRoot, outputPath, logDiagnostics: false });

    assert.equal(battleFestival.status, "skipped_missing_official_period");
    assert.equal(battleFestival.reason, "official battle festival period is not available");
    await assert.rejects(
      () => readFile(join(root, "published", "battle-festival-snapshot.json"), "utf8"),
      { code: "ENOENT" }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRefreshSkipsMultiDayBattleFestivalWithoutOfficialSource() {
  const root = await mkdtemp(join(tmpdir(), "battle-festival-untrusted-period-skip-refresh-"));
  const legacyRoot = join(root, "legacy-service");
  const outputPath = join(root, "published", "leaderboard-snapshot.json");

  try {
    await createLegacyFixture(legacyRoot, {
      includeBattleFestivalMatches: true,
      battleFestivalUploadScope: {
        upload: {
          id: 77,
          package_id: "pkg-battle-untrusted-period",
          match_count: 2,
          imported_match_count: 2,
          date_from: "2026-06-12",
          date_to: "2026-06-13",
          festival_date_from: "2026-06-12",
          festival_date_to: "2026-06-13",
          festival_period_source: "",
          created_at: "2026-06-13T06:19:12Z"
        },
        package: {
          package_id: "pkg-battle-untrusted-period",
          mode_scope: "battle_festival",
          festival_date_from: "2026-06-12",
          festival_date_to: "2026-06-13",
          festival_period_source: ""
        }
      }
    });
    const { battleFestival } = await refreshLeaderboardSnapshot({ legacyRoot, outputPath, logDiagnostics: false });

    assert.equal(battleFestival.status, "skipped_missing_official_period");
    assert.equal(battleFestival.reason, "official battle festival period is not available");
    await assert.rejects(
      () => readFile(join(root, "published", "battle-festival-snapshot.json"), "utf8"),
      { code: "ENOENT" }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRefreshUsesEarlierOfficialPeriodForLatestSingleDayBattleFestivalUpload() {
  const root = await mkdtemp(join(tmpdir(), "battle-festival-official-period-refresh-"));
  const legacyRoot = join(root, "legacy-service");
  const outputPath = join(root, "published", "leaderboard-snapshot.json");

  try {
    await createLegacyFixture(legacyRoot, {
      includeBattleFestivalMatches: true,
      includeBattleFestivalOpenPeriodStartMatch: true,
      battleFestivalUploadScopes: [
        {
          upload: {
            id: 78,
            package_id: "pkg-battle-official-period",
            match_count: 2,
            imported_match_count: 2,
            date_from: "2026-05-24",
            date_to: "2026-05-24",
            festival_date_from: "2026-05-22",
            festival_date_to: "2026-05-24",
            created_at: "2026-05-24T05:19:12Z"
          },
          package: {
            package_id: "pkg-battle-official-period",
            mode_scope: "battle_festival",
            festival_date_from: "2026-05-22",
            festival_date_to: "2026-05-24"
          }
        },
        {
          upload: {
            id: 80,
            package_id: "pkg-battle-single-day-manifest",
            match_count: 2,
            imported_match_count: 2,
            date_from: "2026-05-24",
            date_to: "2026-05-24",
            festival_date_from: "2026-05-24",
            festival_date_to: "2026-05-24",
            created_at: "2026-05-24T06:19:12Z"
          },
          package: {
            package_id: "pkg-battle-single-day-manifest",
            mode_scope: "battle_festival",
            festival_date_from: "2026-05-24",
            festival_date_to: "2026-05-24",
            festival_period_source: ""
          }
        }
      ]
    });
    const { battleFestival } = await refreshLeaderboardSnapshot({ legacyRoot, outputPath, logDiagnostics: false });
    const battleFestivalText = await readFile(join(root, "published", "battle-festival-snapshot.json"), "utf8");
    const battleFestivalSnapshot = JSON.parse(battleFestivalText);

    assert.equal(battleFestival.status, "completed");
    assert.equal(battleFestivalSnapshot.metadata.sourceUploadId, 80);
    assert.equal(battleFestivalSnapshot.metadata.sourcePackageId, "pkg-battle-single-day-manifest");
    assert.equal(battleFestivalSnapshot.metadata.periodSourceUploadId, 78);
    assert.equal(battleFestivalSnapshot.metadata.periodSourcePackageId, "pkg-battle-official-period");
    assert.equal(battleFestivalSnapshot.metadata.periodStatus, "official");
    assert.equal(battleFestivalSnapshot.metadata.festivalPeriodSource, "official");
    assert.equal(battleFestivalSnapshot.metadata.dateFrom, "2026-05-22");
    assert.equal(battleFestivalSnapshot.metadata.dateTo, "2026-05-24");
    assert.equal(battleFestivalSnapshot.metadata.sampleSize, 4);
    const periodStartRow = battleFestivalSnapshot.battleFestival.meritRows.find((row) => row.playerName === "period-start-rank");
    assert.ok(periodStartRow);
    assert.equal(periodStartRow.highestMerit, 307822);
    assert.equal(periodStartRow.highestMeritSeenAt, "2026-05-22 13:00");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRefreshBuildsBattleFestivalMeritRows() {
  const root = await mkdtemp(join(tmpdir(), "battle-festival-merit-refresh-"));
  const legacyRoot = join(root, "legacy-service");
  const outputPath = join(root, "published", "leaderboard-snapshot.json");

  try {
    await createLegacyFixture(legacyRoot, {
      includeBattleFestivalMatches: true,
      includeBattleFestivalMeritSamples: true,
      battleFestivalUploadScope: {
        upload: {
          id: 75,
          package_id: "pkg-battle-merit",
          match_count: 12,
          imported_match_count: 12,
          date_from: "2026-05-24",
          date_to: "2026-05-25",
          created_at: "2026-05-25T01:00:00Z"
        },
        package: {
          package_id: "pkg-battle-merit",
          mode_scope: "battle_festival",
          festival_date_from: "2026-05-24",
          festival_date_to: "2026-05-25"
        }
      }
    });
    await refreshLeaderboardSnapshot({ legacyRoot, outputPath, logDiagnostics: false });
    const battleFestivalText = await readFile(join(root, "published", "battle-festival-snapshot.json"), "utf8");
    const battleFestivalSnapshot = JSON.parse(battleFestivalText);
    const meritRows = battleFestivalSnapshot.battleFestival.meritRows;

    assert.ok(Array.isArray(meritRows));
    assert.equal(meritRows[0].playerName, "\u5358\u767a\u738b");
    assert.equal(meritRows[0].camp, "\u5468\u8ecd");
    assert.equal(meritRows[0].highestMerit, 999999);
    assert.equal(meritRows[0].meritSampleCount, 1);
    assert.equal(meritRows[0].observedMatchCount, 1);
    assert.equal(meritRows[0].unknownCount, 1);
    assert.equal(meritRows[0].winRate, 0);
    assert.equal(meritRows[0].decks[0].deckId, battleDeckB);
    assert.equal(meritRows[0].decks[0].sampleSize, 1);
    assert.equal(meritRows.some((row) => row.playerName === "odds-only"), false);
    assert.equal(meritRows.some((row) => row.highestMerit === 9.9), false);
    const saltRowIndex = meritRows.findIndex((row) => row.playerName === "\u5929\u304b\u3089\u304a\u5869");
    assert.ok(saltRowIndex > 0);
    assert.equal(meritRows[saltRowIndex].highestMerit, 124194);
    assert.equal(meritRows[saltRowIndex].highestMeritSeenAt, "2026-05-24 22:00");
    assert.equal(meritRows[saltRowIndex].meritSampleCount, 3);
    assert.equal(meritRows[saltRowIndex].observedMatchCount, 3);
    assert.equal(meritRows[saltRowIndex].unknownCount, 3);
    assert.equal(meritRows[saltRowIndex].winRate, 0);
    assert.equal(meritRows[saltRowIndex].decks.length, 2);
    assert.equal(meritRows[saltRowIndex].decks[0].deckId, battleDeckB);
    assert.equal(meritRows[saltRowIndex].decks[0].sampleSize, 2);
    assert.equal(meritRows[saltRowIndex].decks[0].deckCards[0].cardId, battleCardC);
    assert.equal(meritRows[saltRowIndex].decks[1].deckId, battleDeckA);
    assert.equal(meritRows[saltRowIndex].decks[1].sampleSize, 1);
    assert.equal(meritRows[saltRowIndex].pace.days.length, 2);
    assert.equal(meritRows[saltRowIndex].pace.days[0].date, "2026-05-24");
    assert.equal(meritRows[saltRowIndex].pace.days[0].meritGain, 122094);
    assert.equal(meritRows[saltRowIndex].pace.days[0].observedMinutes, 183);
    assert.equal(meritRows[saltRowIndex].pace.days[0].averageMinutesPerMatch, 91.5);
    assert.equal(meritRows[saltRowIndex].pace.days[0].meritPerHour, 40030.8);
    assert.equal(meritRows[saltRowIndex].pace.days[1].date, "2026-05-25");
    assert.equal(meritRows[saltRowIndex].pace.days[1].meritSampleCount, 1);
    assert.equal(meritRows[saltRowIndex].pace.days[1].observedMinutes, 3);
    assert.equal(meritRows[saltRowIndex].pace.samples[0].firstOfDay, true);
    assert.equal(meritRows[saltRowIndex].pace.samples[0].minutesSincePrevious, 3);
    assert.equal(meritRows[saltRowIndex].pace.samples[1].minutesSincePrevious, 180);
    assert.equal(meritRows[saltRowIndex].pace.samples[1].meritDelta, 122094);
    assert.equal(meritRows[saltRowIndex].pace.projection.basisType, "all_observed");
    assert.equal(meritRows[saltRowIndex].pace.projection.basis.meritPerHour, 39385.2);
    assert.ok(meritRows[saltRowIndex].pace.projection.projectedFinalMerit > 45000);
    const runnerRow = meritRows.find((row) => row.playerName === "\u6700\u65b0\u65e5\u30e9\u30f3\u30ca\u30fc");
    assert.ok(runnerRow);
    assert.equal(runnerRow.pace.days.length, 1);
    assert.equal(runnerRow.pace.days[0].date, "2026-05-25");
    assert.equal(runnerRow.pace.days[0].meritGain, 6000);
    assert.equal(runnerRow.pace.days[0].observedMinutes, 15);
    assert.equal(runnerRow.pace.days[0].averageMinutesPerMatch, 7.5);
    assert.equal(runnerRow.pace.days[0].meritPerHour, 24000);
    assert.equal(runnerRow.pace.samples[0].minutesSincePrevious, 3);
    assert.equal(runnerRow.pace.samples[1].minutesSincePrevious, 12);
    assert.equal(runnerRow.pace.projection.basisType, "latest_day");
    assert.equal(runnerRow.pace.projection.basis.date, "2026-05-25");
    assert.equal(runnerRow.pace.projection.basis.meritPerHour, 24000);
    assert.ok(runnerRow.pace.projection.projectedFinalMerit > 7000);
    assert.equal(battleFestivalSnapshot.battleFestival.meritSummary.highestMerit, 999999);
    assert.equal(battleFestivalSnapshot.battleFestival.meritSummary.topPlayerName, "\u5358\u767a\u738b");
    assert.equal(battleFestivalSnapshot.battleFestival.meritSummary.meritPlayerCount, 3);
    assert.equal(battleFestivalSnapshot.battleFestival.meritSummary.meritSampleCount, 6);
    assert.equal(battleFestivalSnapshot.battleFestival.meritSummary.observedMatchCount, 6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRefreshBuildsBattleFestivalSnapshotWithoutCampField() {
  const root = await mkdtemp(join(tmpdir(), "battle-festival-no-camp-refresh-"));
  const legacyRoot = join(root, "legacy-service");
  const outputPath = join(root, "published", "leaderboard-snapshot.json");

  try {
    await createLegacyFixture(legacyRoot, {
      includeBattleFestivalMatches: true,
      includeBattleFestivalCamp: false,
      battleFestivalUploadScope: {
        upload: {
          id: 76,
          package_id: "pkg-battle-no-camp",
          match_count: 2,
          imported_match_count: 2,
          date_from: "2026-05-24",
          date_to: "2026-05-24",
          created_at: "2026-05-24T18:00:00Z"
        },
        package: {
          package_id: "pkg-battle-no-camp",
          mode_scope: "battle_festival",
          festival_date_from: "2026-05-24",
          festival_date_to: "2026-05-25"
        }
      }
    });
    const { battleFestival } = await refreshLeaderboardSnapshot({ legacyRoot, outputPath, logDiagnostics: false });
    const battleFestivalText = await readFile(join(root, "published", "battle-festival-snapshot.json"), "utf8");
    const battleFestivalSnapshot = JSON.parse(battleFestivalText);

    assert.equal(battleFestival.status, "completed");
    assert.equal(battleFestivalSnapshot.metadata.sourceKind, "battle_festival");
    assert.equal(battleFestivalSnapshot.metadata.sampleSize, 2);
    assert.equal(battleFestivalSnapshot.tierRows.length, 2);
    assert.deepEqual(battleFestivalSnapshot.battleFestival.campShare, []);
    assert.deepEqual(battleFestivalSnapshot.battleFestival.rowsByCamp, {});
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
        upload: {
          id: 74,
          package_id: "pkg-battle-empty",
          mode_scope: "tier_list",
          festival_date_from: "",
          festival_date_to: "",
          match_count: 0,
          imported_match_count: 0,
          created_at: "2026-06-14T01:06:00Z"
        },
        package: {
          package_id: "pkg-battle-empty",
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
    assert.equal(battleFestivalSnapshot.metadata.sourceUploadId, 74);
    assert.equal(battleFestivalSnapshot.metadata.sourcePackageId, "pkg-battle-empty");
    assert.equal(battleFestivalSnapshot.metadata.sourceImportedMatchCount, 0);
    assert.equal(battleFestivalSnapshot.metadata.sourceMatchCount, 0);
    assert.equal(battleFestivalSnapshot.metadata.sourceUploadCreatedAt, "2026-06-14T01:06:00Z");
    assert.equal(battleFestivalSnapshot.metadata.periodSourceUploadId, 74);
    assert.equal(battleFestivalSnapshot.metadata.periodSourcePackageId, "pkg-battle-empty");
    assert.equal(battleFestivalSnapshot.metadata.periodStatus, "official");
    assert.equal(battleFestivalSnapshot.metadata.festivalPeriodSource, "official");
    assert.equal(battleFestivalSnapshot.metadata.dateFrom, "2026-06-11");
    assert.equal(battleFestivalSnapshot.metadata.dateTo, "2026-06-13");
    assert.equal(battleFestivalSnapshot.metadata.sampleSize, 0);
    assert.equal(battleFestivalSnapshot.tierRows.length, 0);
    assert.deepEqual(battleFestivalSnapshot.battleFestival.campShare, []);
    assert.deepEqual(battleFestivalSnapshot.battleFestival.rowsByCamp, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await testRefreshWritesAtomicSnapshot();
await testRefreshWritesBattleFestivalSnapshot();
await testRefreshBuildsBattleFestivalSnapshotFromMatches();
await testRefreshSkipsSingleDayBattleFestivalWithoutOfficialPeriod();
await testRefreshSkipsMultiDayBattleFestivalWithoutOfficialSource();
await testRefreshUsesEarlierOfficialPeriodForLatestSingleDayBattleFestivalUpload();
await testRefreshBuildsBattleFestivalMeritRows();
await testRefreshBuildsBattleFestivalSnapshotWithoutCampField();
await testRefreshWritesManifestOnlyBattleFestivalSnapshot();

console.log("leaderboard snapshot refresh tests passed");
