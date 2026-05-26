import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshLeaderboardSnapshot } from "./refresh-snapshot.mjs";

const deckA = "card-a1,card-a2";
const deckB = "card-b1,card-b2";

async function writeJson(path, payload) {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeJsonl(path, rows) {
  await writeFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function card(cardId, cardCode, name) {
  return {
    card_hash: cardId,
    card_code: cardCode,
    image_url: `https://image.example.test/${cardId}.jpg`,
    label: `${name}(1.0 槍兵)`
  };
}

function deckRow(id, deckId, cards, rank, winCount, lossCount) {
  const sampleCount = winCount + lossCount;
  return {
    id,
    run_id: 1,
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

function archetypeRow(id, title, cards, rank, winCount, lossCount, representativeDeckId = deckB) {
  const sampleCount = winCount + lossCount;
  return {
    id,
    run_id: 1,
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

async function createLegacyFixture(root) {
  const tableRoot = join(root, "tables");
  const cardRoot = join(root, "cards");
  await mkdir(tableRoot, { recursive: true });
  await mkdir(cardRoot, { recursive: true });
  await writeJsonl(join(tableRoot, "server_share_config.jsonl"), [
    { id: 1, target_version: "Ver.test", updated_at: "2026-05-25T00:00:00" }
  ]);
  await writeJsonl(join(tableRoot, "server_leaderboard_runs.jsonl"), [
    {
      id: 1,
      status: "ready",
      target_version: "Ver.test",
      date_from: "2026-05-20",
      date_to: "2026-05-25",
      generated_at: "2026-05-25T00:00:00",
      updated_at: "2026-05-25T00:00:00"
    }
  ]);
  await writeJsonl(join(tableRoot, "server_leaderboard_rows.jsonl"), [
    deckRow(1, deckA, [card("card-a1", "蒼001", "Alpha"), card("card-a2", "蒼002", "Beta")], 1, 0, 1),
    deckRow(2, deckB, [card("card-b1", "緋001", "Gamma"), card("card-b2", "緋002", "Delta")], 2, 1, 0),
    archetypeRow(3, "Published Cluster", [card("card-b1", "緋001", "Gamma"), card("card-b2", "緋002", "Delta")], 1, 4, 1),
    archetypeRow(4, "Published Cluster", [card("card-b1", "緋001", "Gamma"), card("card-a2", "蒼002", "Beta")], 2, 1, 0),
    archetypeRow(5, "Late Better Cluster", [card("card-a1", "蒼001", "Alpha"), card("card-a2", "蒼002", "Beta")], 99, 10, 0, deckA)
  ]);
  await writeJsonl(join(tableRoot, "matches.jsonl"), [
    { id: 1, version: "Ver.test", played_at: "2026-05-21 12:00", created_at: "2026-05-21 12:00" }
  ]);
  await writeJsonl(join(tableRoot, "match_decks.jsonl"), [
    { id: 1, match_id: 1, side_index: 0, deck_fingerprint: deckA },
    { id: 2, match_id: 1, side_index: 1, deck_fingerprint: deckB }
  ]);
  await writeJsonl(join(tableRoot, "match_sides.jsonl"), [
    matchSide(1, 1, 0, "loss", "alice"),
    matchSide(2, 1, 1, "win", "bob")
  ]);
  await writeJsonl(join(tableRoot, "match_deck_units.jsonl"), [
    { id: 1, deck_id: 1, slot: 1, card_hash: "card-a1" },
    { id: 2, deck_id: 1, slot: 2, card_hash: "card-a2" },
    { id: 3, deck_id: 2, slot: 1, card_hash: "card-b1" },
    { id: 4, deck_id: 2, slot: 2, card_hash: "card-b2" }
  ]);
  await writeJson(join(cardRoot, "card_catalog.json"), {
    cards: [
      { hash_id: "card-a1", card_code: "蒼001", name: "Alpha", faction: "蒼", cost: "1.0", unitType: "槍兵" },
      { hash_id: "card-a2", card_code: "蒼002", name: "Beta", faction: "蒼", cost: "1.0", unitType: "槍兵" },
      { hash_id: "card-b1", card_code: "緋001", name: "Gamma", faction: "緋", cost: "1.0", unitType: "槍兵" },
      { hash_id: "card-b2", card_code: "緋002", name: "Delta", faction: "緋", cost: "1.0", unitType: "槍兵" }
    ]
  });
  await writeJson(join(cardRoot, "card_catalog_overlay.json"), { cards: [] });
}

async function testRefreshWritesAtomicSnapshot() {
  const root = await mkdtemp(join(tmpdir(), "leaderboard-refresh-"));
  const legacyRoot = join(root, "legacy-service");
  const outputPath = join(root, "published", "leaderboard-snapshot.json");

  try {
    await createLegacyFixture(legacyRoot);
    const { snapshot } = await refreshLeaderboardSnapshot({ legacyRoot, outputPath, logDiagnostics: false });
    const outputText = await readFile(outputPath, "utf8");
    const output = JSON.parse(outputText);

    assert.equal(snapshot.metadata.sourceRunId, 1);
    assert.equal(output.metadata.sourceKind, "server_leaderboard");
    assert.equal(output.tierRows.length, 2);
    assert.equal(output.clusterRows.length, 2);
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
    assert.ok(output.tierRows.some((row) => row.deckConfig.strategies.length > 0));
    assert.ok(output.tierRows.some((row) => row.deckConfig.schoolStages.length > 0));
    assert.ok(output.tierRows.some((row) => row.deckConfig.unfavorableMatchups.length > 0));
    assert.ok(output.clusterRows.some((row) => row.deckConfig.strategies.length > 0));
    assert.ok(output.clusterRows.some((row) => row.deckConfig.schoolStages.length > 0));
    assert.ok(output.clusterRows.some((row) => row.deckConfig.unfavorableMatchups.length > 0));
    assert.ok(output.home.tierRows.some((row) => row.deckConfig.strategies.length > 0));
    assert.equal(/token|cookie|secret|C:\\|E:\\/.test(outputText), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await testRefreshWritesAtomicSnapshot();

console.log("leaderboard snapshot refresh tests passed");
