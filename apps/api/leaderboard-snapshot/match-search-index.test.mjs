import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMatchSearchIndex, refreshMatchSearchIndex, searchMatchIndex } from "./match-search-index.mjs";

async function writeJson(path, payload) {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeJsonl(path, rows) {
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function side(id, matchId, sideIndex, role, result, weaponName, weaponSummary, strategyCounts) {
  return {
    id,
    match_id: matchId,
    side_index: sideIndex,
    role,
    result,
    player_name: `${role}-${matchId}`,
    castle_rate: "53.2",
    selected_json: {
      weapon: {
        name: weaponName,
        summary: weaponSummary,
      },
      school: {
        name: "士気",
      },
    },
    profile_json: {
      battle_stats: {
        strategy_count: {
          by_slot: strategyCounts,
        },
      },
    },
  };
}

function officialGeneralRow(overrides = {}) {
  const fields = Array.from({ length: 25 }, () => "");
  Object.assign(fields, {
    0: "card-b",
    1: "card-b-ds",
    2: "card-b-face",
    3: "Beta",
    5: "0",
    6: "0",
    8: "ST",
    12: "2",
    13: "0",
    15: "0",
    17: "6",
    18: "3",
    ...overrides,
  });
  return fields.join(",");
}

async function createFixture(root) {
  const legacyRoot = join(root, "legacy-service");
  const tableRoot = join(legacyRoot, "tables");
  const cardRoot = join(legacyRoot, "cards");
  const snapshotFile = join(root, "leaderboard-snapshot.json");
  await mkdir(tableRoot, { recursive: true });
  await mkdir(cardRoot, { recursive: true });

  await writeJson(snapshotFile, {
    metadata: {
      sourceRunId: 9,
      sourceKind: "server_leaderboard",
      targetVersion: "Ver.test",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-02",
      updatedAt: "2026-06-02T00:00:00Z",
      sampleSize: 4,
    },
    tierRows: [
      {
        deckCards: [
          {
            cardId: "card-g",
            name: "SnapshotOnly",
            faction: "黄",
            cardCode: "黄999",
            cost: "2.5",
            unitType: "剣豪",
            force: "9",
            intelligence: "4",
            era: "特殊",
            skills: ["気合"],
            imageUrl: "https://cards.example.test/snapshot-only.jpg",
            imageAlt: "SnapshotOnly"
          },
          {
            cardId: "card-pl",
            name: "JeanneAlter",
            faction: "unknown",
            cardCode: "PL116",
            cost: "2.5",
            unitType: "\u9a0e\u5175"
          }
        ]
      }
    ]
  });
  await writeJsonl(join(tableRoot, "matches.jsonl"), [
    {
      id: 1,
      version: "Ver.test",
      mode: "全国対戦",
      played_at: "2026-06-01 12:00",
      play_url: "https://eiketsu.example.test/play/1",
      detail_url: "https://eiketsu.example.test/detail/1",
      replay_id: "replay-1",
    },
    {
      id: 2,
      version: "Ver.test",
      mode: "全国対戦",
      played_at: "2026-06-02 12:00",
      m3u8_url: "https://eiketsu.example.test/video/2.m3u8",
    },
    {
      id: 3,
      version: "Ver.test",
      mode: "全国対戦",
      played_at: "2026-06-03 12:00",
      play_url: "https://eiketsu.example.test/play/out-of-range",
    },
    {
      id: 4,
      version: "Ver.test",
      mode: "全国対戦",
      played_at: "2026-06-02 13:00",
      detail_url: "https://eiketsu.example.test/detail/no-video",
    },
  ]);
  await writeJsonl(join(tableRoot, "match_sides.jsonl"), [
    side(1, 1, 0, "player", "win", "孫子", "35c 発動", [1, 0]),
    side(2, 1, 1, "enemy", "loss", "再起", "未発動", [0, 2]),
    side(3, 2, 0, "player", "loss", "孫子", "未発動", [0, 0]),
    side(4, 2, 1, "enemy", "win", "太平要術", "48c 発動", [3, 0]),
  ]);
  await writeJsonl(join(tableRoot, "match_decks.jsonl"), [
    { id: 11, match_id: 1, side_index: 0, deck_fingerprint: "card-a,card-b" },
    { id: 12, match_id: 1, side_index: 1, deck_fingerprint: "card-c,card-d" },
    { id: 21, match_id: 2, side_index: 0, deck_fingerprint: "card-a,card-e" },
    { id: 22, match_id: 2, side_index: 1, deck_fingerprint: "card-c,card-g" },
  ]);
  await writeJsonl(join(tableRoot, "match_deck_units.jsonl"), [
    { id: 1, deck_id: 11, slot: 1, card_hash: "card-a" },
    { id: 2, deck_id: 11, slot: 2, card_hash: "card-b" },
    { id: 9, deck_id: 11, slot: 3, card_hash: "card-pl" },
    { id: 3, deck_id: 12, slot: 1, card_hash: "card-c" },
    { id: 4, deck_id: 12, slot: 2, card_hash: "card-d" },
    { id: 5, deck_id: 21, slot: 1, card_hash: "card-a" },
    { id: 6, deck_id: 21, slot: 2, card_hash: "card-e" },
    { id: 7, deck_id: 22, slot: 1, card_hash: "card-c" },
    { id: 8, deck_id: 22, slot: 2, card_hash: "card-g" },
  ]);
  await writeJson(join(cardRoot, "card_catalog.json"), {
    cards: [
      { hash_id: "card-a", card_code: "蒼001", name: "Alpha", faction: "蒼", cost: "1.5", unitType: "妲嶅叺" },
      { hash_id: "card-b", card_code: "蒼002", name: "Beta", faction: "蒼", cost: "1.0", unitType: "弓兵" },
      { hash_id: "card-c", card_code: "緋001", name: "Gamma", faction: "緋", cost: "2.0", unitType: "騎兵" },
      { hash_id: "card-d", card_code: "緋002", name: "Delta", faction: "緋", cost: "1.0", unitType: "槍兵" },
      { hash_id: "card-e", card_code: "碧001", name: "Epsilon", faction: "碧", cost: "1.0", unitType: "槍兵" },
      { hash_id: "card-f", card_code: "玄001", name: "Zeta", faction: "玄", cost: "1.0", unitType: "剣豪" },
    ],
  });
  await writeJson(join(cardRoot, "card_catalog_overlay.json"), {
    cards: [
      { hash_id: "card-a", image_url: "https://cards.example.test/alpha.jpg" },
      { hash_id: "card-c", image_keys: { card_small: "catalog-card-c" } },
    ],
  });
  await writeJson(join(cardRoot, "datalist_api_base.json"), {
    path: ["card_small,general/card_small/,.jpg?260520a"],
    general: [
      officialGeneralRow(),
      officialGeneralRow({ 0: "card-pl", 1: "card-pl-ds", 2: "card-pl-face", 3: "JeanneAlter", 5: "0", 8: "PL", 12: "116", 13: "2", 15: "1" }),
    ],
    color: ["0,\u7384"],
    period: ["0,Edo"],
    cost: ["0,1.0", "2,2.5"],
    unitType: ["0,Spear", "1,\u9a0e\u5175"],
    skill: [],
  });
  return { legacyRoot, snapshotFile };
}

async function testBuildIndexAndSearchFilters() {
  const root = await mkdtemp(join(tmpdir(), "match-search-index-"));
  try {
    const { legacyRoot, snapshotFile } = await createFixture(root);
    const index = await buildMatchSearchIndex({ legacyRoot, snapshotFile });

    assert.equal(index.metadata.sourceRunId, 9);
    assert.equal(index.metadata.matchCount, 2);
    assert.equal(index.cards.find((card) => card.cardId === "card-a").imageUrl, "https://cards.example.test/alpha.jpg");
    assert.equal(index.cards.find((card) => card.cardId === "card-b").imageUrl, "https://image.eiketsu-taisen.net/general/card_small/card-b.jpg?260520a");
    assert.equal(index.cards.find((card) => card.cardId === "card-c").imageUrl, "https://image.eiketsu-taisen.net/general/card_small/catalog-card-c.jpg?260520a");
    assert.equal(index.cards.find((card) => card.cardId === "card-b").force, "6");
    assert.equal(index.cards.find((card) => card.cardId === "card-b").intelligence, "3");
    assert.equal(index.cards.find((card) => card.cardId === "card-pl").faction, "\u7384");
    assert.equal(index.cards.find((card) => card.cardId === "card-g").imageUrl, "https://cards.example.test/snapshot-only.jpg");
    assert.equal(index.cards.find((card) => card.cardId === "card-g").force, "9");
    assert.deepEqual(index.cards.find((card) => card.cardId === "card-g").skills, ["気合"]);
    assert.equal(index.cards.find((card) => card.cardId === "card-a").unitType, "槍兵");
    assert.equal(index.weapons.find((weapon) => weapon.name === "孫子").usageCount, 2);

    const strictSide = searchMatchIndex(index, { sideB: { cardIds: ["card-a"] } });
    assert.equal(strictSide.total, 0);

    const usedStrategy = searchMatchIndex(index, {
      cardMatchMode: "all",
      sideA: {
        cardIds: ["card-a"],
        strategyByCard: { "card-a": "used" },
      },
    });
    assert.equal(usedStrategy.total, 1);
    assert.equal(usedStrategy.items[0].matchId, 1);
    assert.equal(usedStrategy.items[0].sideA.selectedStrategyCounts["card-a"], 1);

    const unusedStrategy = searchMatchIndex(index, {
      sideA: {
        cardIds: ["card-a"],
        strategyByCard: { "card-a": "unused" },
      },
    });
    assert.equal(unusedStrategy.total, 1);
    assert.equal(unusedStrategy.items[0].matchId, 2);

    const weaponActivated = searchMatchIndex(index, {
      sideA: {
        weaponName: "孫子",
        weaponActivated: "yes",
      },
    });
    assert.equal(weaponActivated.total, 1);
    assert.equal(weaponActivated.items[0].matchId, 1);

    const resultSearch = searchMatchIndex(index, { sideA: { result: "loss" } });
    assert.equal(resultSearch.total, 1);
    assert.equal(resultSearch.items[0].matchId, 2);

    assert.throws(() => searchMatchIndex(index, {}), /at least one search condition/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRefreshWritesAtomicIndex() {
  const root = await mkdtemp(join(tmpdir(), "match-search-refresh-"));
  try {
    const { legacyRoot, snapshotFile } = await createFixture(root);
    const outputPath = join(root, "published", "match-search-index.json");
    const { index } = await refreshMatchSearchIndex({ legacyRoot, snapshotFile, outputPath });
    const output = JSON.parse(await readFile(outputPath, "utf8"));

    assert.equal(index.metadata.sourceRunId, 9);
    assert.equal(output.matches.length, 2);
    assert.equal(/token|cookie|secret|C:\\|E:\\/.test(JSON.stringify(output)), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await testBuildIndexAndSearchFilters();
await testRefreshWritesAtomicIndex();

console.log("match search index tests passed");
