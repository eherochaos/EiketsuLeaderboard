import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { classifyAnalysisDecks } = require("../deck-classification/eiketsu-analysis-deck.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, "..");
const repoRoot = resolve(apiRoot, "../..");
const defaultLegacyRoot = resolve(apiRoot, "data/legacy-service");
let legacyRoot = defaultLegacyRoot;
let diagnosticsEnabled = false;

const OFFICIAL_FACTION_ORDER = ["蒼", "緋", "碧", "玄", "紫", "琥", "黄"];
const FACTION_COLORS = {
  蒼: "#1e3ca0",
  緋: "#b4191b",
  碧: "#007332",
  玄: "#636261",
  紫: "#8c0078",
  琥: "#ff7800",
  黄: "#c9a227",
  unknown: "#636261"
};

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function percent(value) {
  return Number((toNumber(value) * 100).toFixed(1));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readOptionalJson(filePath, fallback = null) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readJsonl(filePath, predicate = () => true) {
  const rows = [];
  const reader = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed);
    if (predicate(row)) rows.push(row);
  }

  return rows;
}

function latestCompletedRun(runs) {
  const candidates = runs
    .filter((run) => run.status === "completed")
    .filter((run) => toNumber(run.counts_json?.deck_groups_exported) > 0)
    .sort((left, right) => toNumber(right.id) - toNumber(left.id));

  if (!candidates.length) {
    throw new Error("No completed analysis run with exported deck groups.");
  }

  return candidates[0];
}

function cardHashIds(card) {
  return [
    card.hash_id,
    card.hashId,
    card.card_hash,
    card.cardHash,
    card.canonical_hash,
    card.canonicalHash,
    card.gameplay_hash,
    card.gameplayHash,
    card.id,
    ...(Array.isArray(card.hash_ids) ? card.hash_ids : [])
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

async function loadCardCatalog() {
  const base = await readJson(resolve(legacyRoot, "cards/card_catalog.json"));
  const overlay = await readJson(resolve(legacyRoot, "cards/card_catalog_overlay.json"));
  const byHash = new Map();

  for (const card of [...(base.cards || []), ...(overlay.cards || [])]) {
    for (const hashId of cardHashIds(card)) {
      byHash.set(hashId, { ...(byHash.get(hashId) || {}), ...card });
    }
  }

  return Object.fromEntries(byHash);
}

function normalizeFaction(raw) {
  const value = String(raw || "").trim();
  if (OFFICIAL_FACTION_ORDER.includes(value)) return value;
  const first = Array.from(value)[0] || "";
  if (OFFICIAL_FACTION_ORDER.includes(first)) return first;
  return "unknown";
}

function cardName(cardId, cardCatalog) {
  const card = cardCatalog[cardId];
  return String(card?.name || card?.card_code || cardId.slice(0, 8));
}

function shortName(value) {
  return String(value || "").split("(", 1)[0].trim();
}

function cardCodeFaction(cardCode) {
  const first = Array.from(String(cardCode || "").trim())[0] || "";
  return OFFICIAL_FACTION_ORDER.includes(first) ? first : "unknown";
}

function labelName(value) {
  return shortName(value) || String(value || "").trim();
}

function cardImageUrl(card) {
  // No stable public image template is defined in this repo. Keep URL empty so
  // the UI uses its fixed text fallback instead of guessing fake card art.
  void card;
  return "";
}

function cardView(cardId, cardCatalog) {
  const card = cardCatalog[cardId] || {};
  const name = cardName(cardId, cardCatalog);
  return {
    cardId,
    name,
    faction: normalizeFaction(card.faction || card.card_code),
    imageUrl: cardImageUrl(card),
    imageAlt: name
  };
}

function deckCards(deckId, cardCatalog) {
  return String(deckId || "")
    .split(",")
    .map((cardId) => cardId.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((cardId) => cardView(cardId, cardCatalog));
}

function deckFaction(cards, fallback) {
  const normalizedFallback = normalizeFaction(fallback);
  if (normalizedFallback !== "unknown") return normalizedFallback;

  const counts = new Map();
  for (const card of cards) {
    const faction = normalizeFaction(card.faction);
    if (faction === "unknown") continue;
    counts.set(faction, (counts.get(faction) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || OFFICIAL_FACTION_ORDER.indexOf(left[0]) - OFFICIAL_FACTION_ORDER.indexOf(right[0]))[0]?.[0] || "unknown";
}

function latestShareConfig(configRows) {
  return configRows
    .slice()
    .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")))[0] || null;
}

function latestFormalRun(runs, targetVersion) {
  return runs
    .filter((run) => run.status === "ready")
    .filter((run) => !targetVersion || run.target_version === targetVersion)
    .sort((left, right) => toNumber(right.id) - toNumber(left.id))[0] || null;
}

function formalCardView(card) {
  const name = labelName(card?.label) || String(card?.card_hash || "").slice(0, 8);
  return {
    cardId: String(card?.card_hash || ""),
    name,
    faction: cardCodeFaction(card?.card_code),
    imageUrl: String(card?.image_url || ""),
    imageAlt: name
  };
}

function formalFaction(cards) {
  const counts = new Map();
  for (const card of cards) {
    const faction = normalizeFaction(card.faction);
    if (faction === "unknown") continue;
    counts.set(faction, (counts.get(faction) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || OFFICIAL_FACTION_ORDER.indexOf(left[0]) - OFFICIAL_FACTION_ORDER.indexOf(right[0]))[0]?.[0] || "unknown";
}

function formalDeckRowSample(row) {
  return toNumber(row?.row_json?.sample_count ?? row?.sample_count);
}

function deckRowCardHashes(row) {
  const cards = row?.row_json?.cards;
  if (!Array.isArray(cards)) return [];
  return cards.map((card) => String(card?.card_hash || "").trim()).filter(Boolean);
}

function deckRowFingerprintHashes(row) {
  return String(row?.row_json?.deck_fingerprint || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function hasDuplicateValues(values) {
  return new Set(values).size !== values.length;
}

function invalidDeckRowReason(row) {
  if (hasDuplicateValues(deckRowCardHashes(row))) {
    return "duplicate row_json.cards card_hash";
  }

  if (hasDuplicateValues(deckRowFingerprintHashes(row))) {
    return "duplicate row_json.deck_fingerprint card_hash";
  }

  return "";
}

function splitInvalidDeckRows(deckRows) {
  const validDeckRows = [];
  const invalidDeckRows = [];

  for (const row of deckRows) {
    const reason = invalidDeckRowReason(row);
    if (reason) {
      invalidDeckRows.push({ row, reason });
    } else {
      validDeckRows.push(row);
    }
  }

  return { validDeckRows, invalidDeckRows };
}

function logInvalidDeckRows(invalidDeckRows) {
  if (!diagnosticsEnabled || invalidDeckRows.length === 0) return;

  const sampleSize = invalidDeckRows.reduce((sum, item) => sum + formalDeckRowSample(item.row), 0);
  console.log(`excludedInvalidDeckRows=${invalidDeckRows.length} excludedInvalidDeckSampleSize=${sampleSize}`);

  invalidDeckRows.slice(0, 5).forEach((item) => {
    const name = item.row?.row_json?.deck_name || item.row?.row_json?.deck_fingerprint || item.row?.id || "";
    console.log(`invalidDeckRow rank=${item.row?.rank} sample=${formalDeckRowSample(item.row)} reason=${item.reason} deck=${name}`);
  });
}

function formalClassifierDecks(deckRows) {
  return deckRows.map((row) => {
    const json = row.row_json || {};
    const cardIds = Array.isArray(json.cards)
      ? json.cards.map((card) => String(card?.card_hash || "").trim()).filter(Boolean)
      : String(json.deck_fingerprint || "").split(",").filter(Boolean);

    return {
      deckId: String(json.deck_fingerprint || row.id),
      deckName: String(json.deck_name || json.deck_fingerprint || row.id),
      cards: cardIds,
      sampleCount: toNumber(json.sample_count ?? row.sample_count),
      winCount: toNumber(json.win_count),
      lossCount: toNumber(json.loss_count),
      drawCount: toNumber(json.draw_count)
    };
  });
}

function formalRankScore(row, json) {
  return Math.max(1, Math.round(toNumber(row.wilson_lower_bound ?? json?.wilson_lower_bound) * 100));
}

function formalRunDate(value) {
  return String(value || "").slice(0, 10);
}

function matchesFormalRun(match, run) {
  if (run.target_version && match.version !== run.target_version) return false;

  const playedDate = formalRunDate(match.played_at || match.created_at);
  if (run.date_from && playedDate && playedDate < run.date_from) return false;
  if (run.date_to && playedDate && playedDate > run.date_to) return false;

  return true;
}

function matchSideKey(matchId, sideIndex) {
  return `${matchId}:${sideIndex}`;
}

function normalizedSideResult(value) {
  const result = String(value || "").trim();
  return ["win", "loss", "draw"].includes(result) ? result : "";
}

const SCHOOL_STAGE_LABELS = [
  { stage: "1", label: "壱之型" },
  { stage: "2", label: "弐之型" },
  { stage: "3", label: "参之型" }
];

function schoolStageActivations(school) {
  const schoolName = String(school?.name || "").trim();
  const summary = String(school?.summary || "");
  if (!schoolName || !summary) return [];

  return SCHOOL_STAGE_LABELS
    .map(({ stage, label }) => {
      const match = summary.match(new RegExp(`${label}：([^\\s)]+)`));
      const value = String(match?.[1] || "").trim();
      if (!value || value.includes("未発動")) return null;
      return { stage, name: `${schoolName} ${label}` };
    })
    .filter(Boolean);
}

function playerWinRateKey(side) {
  const followId = String(side.follow_id || "").trim();
  if (followId) return `follow:${followId}`;

  const playerName = String(side.player_name || "").trim();
  if (playerName) return `name:${playerName}`;

  return `side:${side.match_id}:${side.side_index}`;
}

async function formalPlayerAverageWinRates(run, deckRows) {
  const deckIds = new Set(deckRows
    .map((row) => String(row.row_json?.deck_fingerprint || row.id || "").trim())
    .filter(Boolean));

  if (!deckIds.size) return new Map();

  const matches = await readJsonl(
    resolve(legacyRoot, "tables/matches.jsonl"),
    (match) => matchesFormalRun(match, run)
  );
  const matchIds = new Set(matches.map((match) => toNumber(match.id)));
  if (!matchIds.size) return new Map();

  const matchDecks = await readJsonl(
    resolve(legacyRoot, "tables/match_decks.jsonl"),
    (deck) => matchIds.has(toNumber(deck.match_id)) && deckIds.has(String(deck.deck_fingerprint || "").trim())
  );
  const deckIdBySide = new Map(matchDecks.map((deck) => [
    matchSideKey(deck.match_id, deck.side_index),
    String(deck.deck_fingerprint || "").trim()
  ]));
  const targetSideKeys = new Set(deckIdBySide.keys());
  if (!targetSideKeys.size) return new Map();

  const sides = await readJsonl(
    resolve(legacyRoot, "tables/match_sides.jsonl"),
    (side) => targetSideKeys.has(matchSideKey(side.match_id, side.side_index)) && Boolean(normalizedSideResult(side.result))
  );

  const statsByDeck = new Map();
  for (const side of sides) {
    const deckId = deckIdBySide.get(matchSideKey(side.match_id, side.side_index));
    const result = normalizedSideResult(side.result);
    if (!deckId || !result) continue;

    if (!statsByDeck.has(deckId)) statsByDeck.set(deckId, new Map());
    const statsByPlayer = statsByDeck.get(deckId);
    const playerKey = playerWinRateKey(side);
    const stats = statsByPlayer.get(playerKey) || { win: 0, loss: 0, draw: 0 };
    stats[result] += 1;
    statsByPlayer.set(playerKey, stats);
  }

  const rates = new Map();
  for (const [deckId, statsByPlayer] of statsByDeck.entries()) {
    let total = 0;
    let playerCount = 0;

    for (const stats of statsByPlayer.values()) {
      const sampleCount = stats.win + stats.loss + stats.draw;
      if (!sampleCount) continue;
      total += stats.win / sampleCount;
      playerCount += 1;
    }

    if (playerCount) rates.set(deckId, total / playerCount);
  }

  return rates;
}

async function formalAuxiliaryStats(run, deckRows) {
  const deckIds = new Set(deckRows
    .map((row) => String(row.row_json?.deck_fingerprint || row.id || "").trim())
    .filter(Boolean));

  if (!deckIds.size) return emptyAuxiliaryStats();

  const matches = await readJsonl(
    resolve(legacyRoot, "tables/matches.jsonl"),
    (match) => matchesFormalRun(match, run)
  );
  const matchIds = new Set(matches.map((match) => toNumber(match.id)));
  if (!matchIds.size) return emptyAuxiliaryStats();

  const matchDecks = await readJsonl(
    resolve(legacyRoot, "tables/match_decks.jsonl"),
    (deck) => matchIds.has(toNumber(deck.match_id))
  );
  const targetMatchDecks = matchDecks.filter((deck) => deckIds.has(String(deck.deck_fingerprint || "").trim()));
  const targetSideKeys = new Set(targetMatchDecks.map((deck) => matchSideKey(deck.match_id, deck.side_index)));
  const targetDeckRowIds = new Set(targetMatchDecks.map((deck) => toNumber(deck.id)));
  if (!targetSideKeys.size || !targetDeckRowIds.size) return emptyAuxiliaryStats();

  const decksByMatch = new Map();
  for (const deck of matchDecks) {
    const matchId = toNumber(deck.match_id);
    if (!decksByMatch.has(matchId)) decksByMatch.set(matchId, []);
    decksByMatch.get(matchId).push(deck);
  }

  const sides = await readJsonl(
    resolve(legacyRoot, "tables/match_sides.jsonl"),
    (side) => targetSideKeys.has(matchSideKey(side.match_id, side.side_index))
  );
  const sideByKey = new Map(sides.map((side) => [matchSideKey(side.match_id, side.side_index), side]));

  const units = await readJsonl(
    resolve(legacyRoot, "tables/match_deck_units.jsonl"),
    (unit) => targetDeckRowIds.has(toNumber(unit.deck_id))
  );
  const unitsByDeckRowId = new Map();
  for (const unit of units) {
    const deckRowId = toNumber(unit.deck_id);
    if (!unitsByDeckRowId.has(deckRowId)) unitsByDeckRowId.set(deckRowId, []);
    unitsByDeckRowId.get(deckRowId).push(unit);
  }

  const usageByDeckCard = new Map();
  const schoolStagesByDeckStage = new Map();
  const matchupsByDeck = new Map();

  for (const deck of targetMatchDecks) {
    const side = sideByKey.get(matchSideKey(deck.match_id, deck.side_index));
    const deckId = String(deck.deck_fingerprint || "").trim();
    const bySlot = side?.profile_json?.battle_stats?.strategy_count?.by_slot;

    if (Array.isArray(bySlot)) {
      const deckUnits = (unitsByDeckRowId.get(toNumber(deck.id)) || [])
        .slice()
        .sort((left, right) => toNumber(left.slot) - toNumber(right.slot));

      for (const unit of deckUnits) {
        const cardId = String(unit.card_hash || "").trim();
        if (!deckId || !cardId) continue;

        const slotIndex = Math.max(0, toNumber(unit.slot) - 1);
        const key = `${deckId}|${cardId}`;
        const current = usageByDeckCard.get(key) || {
          deckId,
          cardId,
          strategyCount: 0,
          matchCount: 0
        };
        current.strategyCount += toNumber(bySlot[slotIndex]);
        current.matchCount += 1;
        usageByDeckCard.set(key, current);
      }
    }

    for (const activation of schoolStageActivations(side?.selected_json?.school)) {
      const key = `${deckId}|${activation.name}`;
      const current = schoolStagesByDeckStage.get(key) || {
        deckId,
        name: activation.name,
        stage: activation.stage,
        count: 0
      };
      current.count += 1;
      schoolStagesByDeckStage.set(key, current);
    }

    const result = normalizedSideResult(side?.result);
    if (!result) continue;

    const opponentDeck = (decksByMatch.get(toNumber(deck.match_id)) || [])
      .find((candidate) => toNumber(candidate.side_index) !== toNumber(deck.side_index));
    const opponentDeckId = String(opponentDeck?.deck_fingerprint || "").trim();
    if (!deckId || !opponentDeckId) continue;

    if (!matchupsByDeck.has(deckId)) matchupsByDeck.set(deckId, new Map());
    const byOpponent = matchupsByDeck.get(deckId);
    const stats = byOpponent.get(opponentDeckId) || { win: 0, loss: 0, draw: 0 };
    stats[result] += 1;
    byOpponent.set(opponentDeckId, stats);
  }

  const strategyUsage = Array.from(usageByDeckCard.values());
  const strategyCountsByDeck = new Map();
  for (const item of strategyUsage) {
    if (!strategyCountsByDeck.has(item.deckId)) strategyCountsByDeck.set(item.deckId, []);
    strategyCountsByDeck.get(item.deckId).push(item);
  }

  const schoolStagesByDeck = new Map();
  for (const item of schoolStagesByDeckStage.values()) {
    if (!schoolStagesByDeck.has(item.deckId)) schoolStagesByDeck.set(item.deckId, []);
    schoolStagesByDeck.get(item.deckId).push(item);
  }

  return {
    strategyUsage,
    strategyCountsByDeck,
    schoolStagesByDeck,
    matchupsByDeck
  };
}

function emptyAuxiliaryStats() {
  return {
    strategyUsage: [],
    strategyCountsByDeck: new Map(),
    schoolStagesByDeck: new Map(),
    matchupsByDeck: new Map()
  };
}

function sourceRankTie(row) {
  const rank = toNumber(row.sourceRank);
  return rank > 0 ? rank : Number.MAX_SAFE_INTEGER;
}

function compareDeckCompositeRank(left, right) {
  const leftQualified = toNumber(left.winRate) > 50;
  const rightQualified = toNumber(right.winRate) > 50;
  if (leftQualified !== rightQualified) return leftQualified ? -1 : 1;

  const sampleDiff = toNumber(right.sampleSize) - toNumber(left.sampleSize);
  return sampleDiff ||
    toNumber(right.winRate) - toNumber(left.winRate) ||
    sourceRankTie(left) - sourceRankTie(right) ||
    String(left.deckName || "").localeCompare(String(right.deckName || ""), "ja");
}

function applyDeckCompositeRanks(rows) {
  return rows
    .slice()
    .sort(compareDeckCompositeRank)
    .map((row, index) => ({ ...row, rankScore: index + 1 }));
}

function formalDeckEvidenceTags(row) {
  const tags = [`综合 Rank ${row.rankScore}`];
  if (row.usageRate >= 2) tags.push("使用率高");
  if (row.winRate >= 54) tags.push("胜率高");
  if (row.sampleSize >= 20) tags.push("样本稳定");
  return tags;
}

function formalCardEvidenceTags(card) {
  const tags = [`综合 Rank ${card.rankScore}`];
  if (card.usageRate >= 2) tags.push("使用率高");
  if (card.winRate >= 54) tags.push("胜率高");
  if (card.sampleSize >= 50) tags.push("构筑常客");
  return tags;
}

function balancedUsageWinRows(rows, limit, options) {
  const maxUsage = Math.max(...rows.map((row) => toNumber(row.usageRate)), 0);
  const minUsage = Math.max(options.minUsageRate, maxUsage * options.minUsageShareOfMax);
  const minSample = options.minSampleSize || 0;

  const score = (row) => toNumber(row.winRate) * toNumber(row.usageRate);
  const compare = (left, right) => {
    const scoreDiff = score(right) - score(left);
    return scoreDiff || toNumber(left.sourceRank) - toNumber(right.sourceRank) || right.sampleSize - left.sampleSize;
  };

  const strict = rows
    .filter((row) => toNumber(row.winRate) >= options.minWinRate)
    .filter((row) => toNumber(row.usageRate) >= minUsage)
    .filter((row) => toNumber(row.sampleSize) >= minSample)
    .slice()
    .sort(compare);

  if (strict.length >= limit) return strict.slice(0, limit);

  const seen = new Set(strict.map((row) => row.deckId || row.cardId));
  const relaxed = rows
    .filter((row) => toNumber(row.winRate) >= options.minWinRate)
    .filter((row) => toNumber(row.usageRate) > 0)
    .filter((row) => toNumber(row.sampleSize) >= minSample)
    .filter((row) => !seen.has(row.deckId || row.cardId))
    .slice()
    .sort(compare);

  return [...strict, ...relaxed].slice(0, limit);
}

function featuredCoreCardEvidenceTags(deck) {
  const tags = ["高使用卡组核心"];
  tags.push(`综合 Rank ${deck.rankScore}`);
  if (deck.winRate >= 54) tags.push("胜率高");
  return tags;
}

function coreCardFromDeck(deck) {
  return deck.deckCards.find((card) => {
    return card.cardId && (
      (deck.imageUrl && card.imageUrl === deck.imageUrl) ||
      (deck.imageAlt && card.imageAlt === deck.imageAlt) ||
      (deck.deckName && card.name === deck.deckName)
    );
  }) || deck.deckCards[0] || null;
}

function featuredCardsFromTopUsageDecks(tierRows, limit) {
  const seenCardIds = new Set();
  const featuredCards = [];
  const sortedDecks = tierRows
    .filter((deck) => deck.sampleSize > 0 && deck.usageRate > 0)
    .slice()
    .sort((left, right) => {
      const usageDiff = right.usageRate - left.usageRate;
      return usageDiff || toNumber(left.sourceRank) - toNumber(right.sourceRank) || right.sampleSize - left.sampleSize;
    });

  for (const deck of sortedDecks) {
    const coreCard = coreCardFromDeck(deck);
    if (!coreCard || !coreCard.cardId || seenCardIds.has(coreCard.cardId)) continue;
    seenCardIds.add(coreCard.cardId);
    featuredCards.push({
      cardId: coreCard.cardId,
      name: coreCard.name || deck.deckName,
      faction: normalizeFaction(coreCard.faction || deck.faction),
      imageUrl: coreCard.imageUrl || deck.imageUrl,
      imageAlt: coreCard.imageAlt || deck.imageAlt,
      rankScore: deck.rankScore,
      sourceRank: deck.sourceRank,
      winRate: deck.winRate,
      usageRate: deck.usageRate,
      sampleSize: deck.sampleSize,
      evidenceTags: featuredCoreCardEvidenceTags(deck)
    });
    if (featuredCards.length >= limit) break;
  }

  return featuredCards;
}

function emptyDeckConfig() {
  return {
    weapons: [],
    styles: [],
    souls: [],
    strategies: [],
    schoolStages: [],
    unfavorableMatchups: []
  };
}

function formalDeckConfigItems(items) {
  return (Array.isArray(items) ? items : [])
    .slice()
    .sort((left, right) => toNumber(right.usage_rate) - toNumber(left.usage_rate) || toNumber(right.sample_count) - toNumber(left.sample_count))
    .slice(0, 3)
    .map((item) => ({
      name: String(item?.name || "").trim() || "未识别",
      usageRate: percent(item?.usage_rate),
      sampleSize: toNumber(item?.sample_count),
      lowSample: Boolean(item?.low_sample)
    }));
}

function cardNameById(cards) {
  return new Map((cards || []).map((card) => [card.cardId, card.name]));
}

function formalStrategyConfigItems(items, cards) {
  const names = cardNameById(cards);
  const maxAverageCount = Math.max(...(items || []).map((item) => {
    const matchCount = toNumber(item.matchCount);
    return matchCount ? toNumber(item.strategyCount) / matchCount : 0;
  }), 0);

  return (items || [])
    .filter((item) => toNumber(item.strategyCount) > 0)
    .slice()
    .sort((left, right) => {
      const leftAverage = toNumber(left.matchCount) ? toNumber(left.strategyCount) / toNumber(left.matchCount) : 0;
      const rightAverage = toNumber(right.matchCount) ? toNumber(right.strategyCount) / toNumber(right.matchCount) : 0;
      return rightAverage - leftAverage || toNumber(right.matchCount) - toNumber(left.matchCount);
    })
    .slice(0, 3)
    .map((item) => {
      const strategyCount = toNumber(item.strategyCount);
      const matchCount = toNumber(item.matchCount);
      const averageCount = matchCount ? Number((strategyCount / matchCount).toFixed(2)) : 0;
      return {
        cardId: String(item.cardId || ""),
        name: names.get(String(item.cardId || "")) || String(item.cardId || "").slice(0, 8),
        usageRate: maxAverageCount ? Number((averageCount / maxAverageCount * 100).toFixed(1)) : 0,
        sampleSize: matchCount,
        strategyCount,
        averageCount
      };
    });
}

function formalSchoolStageConfigItems(items, sampleSize) {
  return (items || [])
    .slice()
    .sort((left, right) => toNumber(right.count) - toNumber(left.count) || String(left.name || "").localeCompare(String(right.name || ""), "ja"))
    .slice(0, 3)
    .map((item) => ({
      name: String(item.name || "").trim() || "未识别",
      stage: String(item.stage || ""),
      usageRate: sampleSize ? Number((toNumber(item.count) / sampleSize * 100).toFixed(1)) : 0,
      sampleSize: toNumber(item.count),
      averageCount: sampleSize ? Number((toNumber(item.count) / sampleSize).toFixed(2)) : 0,
      lowSample: toNumber(item.count) < 5
    }));
}

function formalDeckConfig(behaviorStats, auxiliaryStats, deckId, cards, sampleSize) {
  return {
    weapons: formalDeckConfigItems(behaviorStats?.weapons),
    styles: formalDeckConfigItems(behaviorStats?.styles),
    souls: formalDeckConfigItems(behaviorStats?.souls),
    strategies: formalStrategyConfigItems(auxiliaryStats.strategyCountsByDeck.get(deckId), cards),
    schoolStages: formalSchoolStageConfigItems(auxiliaryStats.schoolStagesByDeck.get(deckId), sampleSize),
    unfavorableMatchups: []
  };
}

function formalUnfavorableMatchups(matchups, deckNameById) {
  const entries = Array.from((matchups || new Map()).entries());
  const totalLosses = entries.reduce((sum, [, stats]) => sum + toNumber(stats.loss), 0);

  return entries
    .map(([deckId, stats]) => {
      const lossCount = toNumber(stats.loss);
      return {
        deckId,
        deckName: deckNameById.get(deckId) || deckId.slice(0, 8),
        usageRate: totalLosses ? Number((lossCount / totalLosses * 100).toFixed(1)) : 0,
        sampleSize: lossCount
      };
    })
    .filter((item) => item.sampleSize > 0)
    .sort((left, right) => right.sampleSize - left.sampleSize || right.usageRate - left.usageRate || left.deckName.localeCompare(right.deckName, "ja"))
    .slice(0, 3);
}

function attachUnfavorableMatchups(rows, matchupsByDeck) {
  const deckNameById = new Map(rows.map((row) => [row.deckId, row.deckName]));
  return rows.map((row) => ({
    ...row,
    deckConfig: {
      ...row.deckConfig,
      unfavorableMatchups: formalUnfavorableMatchups(matchupsByDeck.get(row.deckId), deckNameById)
    }
  }));
}

function buildFormalTierRows(deckRows, classification, totalSamples, playerAverageWinRates = new Map(), auxiliaryStats = emptyAuxiliaryStats()) {
  const { byDeck } = categoryLookup(classification);

  const rows = deckRows
    .map((row) => {
      const json = row.row_json || {};
      const deckId = String(json.deck_fingerprint || row.id);
      const classificationResult = byDeck.get(deckId);
      const cards = (Array.isArray(json.cards) ? json.cards : []).slice(0, 8).map(formalCardView);
      const primaryCard = cards.find((card) => card.cardId === classificationResult?.primaryCoreCardId) || cards[0];
      const categoryName = classificationResult?.categoryName || "未分类";
      const deckName = analysisDeckDisplayName(categoryName, classificationResult, primaryCard, deckId);
      const winRateValue = percent(json.win_rate ?? 0);
      const playerAverageWinRateValue = percent(playerAverageWinRates.get(deckId) ?? json.win_rate ?? 0);
      const usageRateValue = totalSamples ? Number((toNumber(json.sample_count ?? row.sample_count) / totalSamples * 100).toFixed(1)) : 0;
      const sampleSize = toNumber(json.sample_count ?? row.sample_count);
      const result = {
        deckId,
        deckName,
        categoryId: classificationResult?.categoryId || "unclassified",
        categoryName,
        faction: deckFaction(cards, classificationResult?.primaryFaction || primaryCard?.faction),
        namingSource: namingSource(classificationResult),
        rankScore: 0,
        sourceRank: toNumber(row.rank),
        winRate: winRateValue,
        playerAverageWinRate: playerAverageWinRateValue,
        usageRate: usageRateValue,
        kabukiPoints: 0,
        sampleSize,
        imageUrl: primaryCard?.imageUrl || "",
        imageAlt: primaryCard?.name || deckName,
        deckCards: cards,
        deckConfig: formalDeckConfig(json.behavior_stats, auxiliaryStats, deckId, cards, sampleSize)
      };
      return result;
    })
    .sort((left, right) => left.sourceRank - right.sourceRank);

  return applyDeckCompositeRanks(rows).map((row) => ({ ...row, evidenceTags: formalDeckEvidenceTags(row) }));
}

function formalArchetypeCards(json) {
  const representativeCards = json?.representative_deck?.cards;
  const cards = Array.isArray(representativeCards) && representativeCards.length
    ? representativeCards
    : json?.core_cards;
  return (Array.isArray(cards) ? cards : []).slice(0, 8).map(formalCardView);
}

function formalArchetypePrimaryCard(json, cards) {
  const coreCards = (Array.isArray(json?.core_cards) ? json.core_cards : []).map(formalCardView);
  return coreCards.find((coreCard) => cards.some((card) => card.cardId === coreCard.cardId)) || coreCards[0] || cards[0] || null;
}

function formalArchetypeRepresentativeDeckId(json) {
  return String(json?.representative_deck?.deck_fingerprint || json?.member_decks?.[0]?.deck_fingerprint || "").trim();
}

function weightedRowPercent(rows, key, sampleSize) {
  if (!sampleSize) return 0;
  return Number((rows.reduce((sum, row) => sum + toNumber(row[key]) * toNumber(row.sampleSize), 0) / sampleSize).toFixed(1));
}

function mergeFormalDeckConfigItems(rows, key, sampleSize) {
  const byName = new Map();
  for (const row of rows) {
    for (const item of row.deckConfig?.[key] || []) {
      const name = String(item.name || "").trim();
      if (!name) continue;
      const current = byName.get(name) || { name, sampleSize: 0 };
      current.sampleSize += toNumber(item.sampleSize);
      byName.set(name, current);
    }
  }

  return Array.from(byName.values())
    .map((item) => ({
      name: item.name,
      usageRate: sampleSize ? Number((item.sampleSize / sampleSize * 100).toFixed(1)) : 0,
      sampleSize: item.sampleSize,
      lowSample: item.sampleSize < 5
    }))
    .sort((left, right) => right.sampleSize - left.sampleSize || left.name.localeCompare(right.name, "ja"))
    .slice(0, 3);
}

function mergeSameNameClusterRows(rows) {
  const byName = new Map();
  for (const row of rows) {
    const key = row.deckName || row.deckId;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  }

  return Array.from(byName.values())
    .map((variants) => {
      const ordered = variants.slice().sort((left, right) => sourceRankTie(left) - sourceRankTie(right) || right.sampleSize - left.sampleSize);
      const base = ordered[0];
      const sampleSize = ordered.reduce((sum, row) => sum + toNumber(row.sampleSize), 0);
      const sourceRank = Math.min(...ordered.map((row) => sourceRankTie(row)));
      const mergedRank = sourceRank < Number.MAX_SAFE_INTEGER ? sourceRank : base.rankScore;
      const merged = {
        ...base,
        deckId: base.categoryId || base.deckId,
        rankScore: mergedRank,
        sourceRank: mergedRank,
        winRate: weightedRowPercent(ordered, "winRate", sampleSize),
        playerAverageWinRate: weightedRowPercent(ordered, "playerAverageWinRate", sampleSize),
        usageRate: Number(ordered.reduce((sum, row) => sum + toNumber(row.usageRate), 0).toFixed(1)),
        sampleSize,
        deckConfig: {
          ...base.deckConfig,
          weapons: mergeFormalDeckConfigItems(ordered, "weapons", sampleSize),
          styles: mergeFormalDeckConfigItems(ordered, "styles", sampleSize),
          souls: mergeFormalDeckConfigItems(ordered, "souls", sampleSize)
        }
      };
      return { ...merged, evidenceTags: formalDeckEvidenceTags(merged) };
    })
    .sort((left, right) => sourceRankTie(left) - sourceRankTie(right) || right.sampleSize - left.sampleSize || right.winRate - left.winRate);
}

function buildFormalClusterRows(archetypeRows, classification, totalSamples) {
  const { byDeck } = categoryLookup(classification);
  const rows = archetypeRows
    .map((row) => {
      const json = row.row_json || {};
      const deckId = String(json.archetype_id || row.id);
      const representativeDeckId = formalArchetypeRepresentativeDeckId(json);
      const classificationResult = byDeck.get(representativeDeckId);
      const cards = formalArchetypeCards(json);
      const primaryCard = cards.find((card) => card.cardId === classificationResult?.primaryCoreCardId) || formalArchetypePrimaryCard(json, cards);
      const fallbackName = String(json.title || json.representative_deck?.deck_name || deckId).trim();
      const categoryName = classificationResult?.categoryName || fallbackName;
      const deckName = analysisDeckDisplayName(categoryName, classificationResult, primaryCard, deckId);
      const sampleSize = toNumber(json.sample_count ?? row.sample_count);
      const winRateValue = percent(json.win_rate ?? 0);
      const usageRateValue = totalSamples ? Number((sampleSize / totalSamples * 100).toFixed(1)) : 0;
      const sourceRank = toNumber(row.rank);
      const result = {
        deckId,
        deckName,
        categoryId: classificationResult?.categoryId || deckId,
        categoryName,
        faction: deckFaction(cards, classificationResult?.primaryFaction || primaryCard?.faction),
        namingSource: namingSource(classificationResult),
        rankScore: sourceRank || 0,
        sourceRank,
        winRate: winRateValue,
        playerAverageWinRate: winRateValue,
        usageRate: usageRateValue,
        kabukiPoints: 0,
        sampleSize,
        imageUrl: primaryCard?.imageUrl || cards[0]?.imageUrl || "",
        imageAlt: primaryCard?.name || deckName,
        deckCards: cards,
        deckConfig: formalDeckConfig(json.behavior_stats, emptyAuxiliaryStats(), deckId, cards, sampleSize)
      };
      return result;
    })
    .filter((row) => row.sampleSize > 0 && row.deckCards.length > 0)
    .sort((left, right) => sourceRankTie(left) - sourceRankTie(right) || right.sampleSize - left.sampleSize || right.winRate - left.winRate)
    .map((row, index) => {
      const rankedRow = { ...row, rankScore: row.rankScore || index + 1 };
      return { ...rankedRow, evidenceTags: formalDeckEvidenceTags(rankedRow) };
    });

  return mergeSameNameClusterRows(rows).map((row, index) => {
    const rankedRow = { ...row, rankScore: row.rankScore || index + 1 };
    return { ...rankedRow, evidenceTags: formalDeckEvidenceTags(rankedRow) };
  });
}

function buildFormalFeaturedCards(cardRows, totalSamples) {
  return cardRows
    .map((row) => {
      const json = row.row_json || {};
      const card = formalCardView(json);
      const result = {
        cardId: card.cardId || String(row.id),
        name: card.name,
        faction: card.faction,
        imageUrl: card.imageUrl,
        imageAlt: card.imageAlt,
        rankScore: formalRankScore(row, json),
        sourceRank: toNumber(row.rank),
        winRate: percent(json.win_rate ?? 0),
        usageRate: totalSamples ? Number((toNumber(json.sample_count ?? row.sample_count) / totalSamples * 100).toFixed(1)) : 0,
        sampleSize: toNumber(json.sample_count ?? row.sample_count)
      };
      return { ...result, evidenceTags: formalCardEvidenceTags(result) };
    })
    .sort((left, right) => left.sourceRank - right.sourceRank);
}

async function buildFormalSnapshot(run, rows, cardCatalog, strategyTypes) {
  const deckRows = rows
    .filter((row) => row.run_id === run.id && row.row_type === "deck" && row.rank_scope === "all" && toNumber(row.cluster_enabled) === 0)
    .sort((left, right) => toNumber(left.rank) - toNumber(right.rank));
  const archetypeRows = rows
    .filter((row) => row.run_id === run.id && row.row_type === "archetype" && row.rank_scope === "all" && toNumber(row.cluster_enabled) === 1)
    .sort((left, right) => toNumber(left.rank) - toNumber(right.rank));
  const { validDeckRows, invalidDeckRows } = splitInvalidDeckRows(deckRows);
  const totalSamples = validDeckRows.reduce((sum, row) => sum + formalDeckRowSample(row), 0);
  const excludedInvalidDeckSampleSize = invalidDeckRows.reduce((sum, item) => sum + formalDeckRowSample(item.row), 0);
  logInvalidDeckRows(invalidDeckRows);

  const playerAverageWinRates = await formalPlayerAverageWinRates(run, validDeckRows);
  const auxiliaryStats = await formalAuxiliaryStats(run, validDeckRows);
  const classification = classifyAnalysisDecks(formalClassifierDecks(validDeckRows), cardCatalog, {
    now: run.generated_at || run.updated_at || new Date().toISOString(),
    strategyTypes,
    strategyUsage: auxiliaryStats.strategyUsage
  });
  const tierRows = attachUnfavorableMatchups(
    buildFormalTierRows(validDeckRows, classification, totalSamples, playerAverageWinRates, auxiliaryStats),
    auxiliaryStats.matchupsByDeck
  );
  const archetypeTotalSamples = archetypeRows.reduce((sum, row) => sum + formalDeckRowSample(row), 0);
  const clusterRows = buildFormalClusterRows(archetypeRows, classification, totalSamples || archetypeTotalSamples);
  const homeRows = clusterRows.length ? clusterRows : tierRows;
  const factionShare = buildFactionShare(homeRows);
  const topShareTotal = factionShare.slice(0, 3).reduce((sum, item) => sum + item.share, 0);

  return {
    metadata: {
      sourceRunId: toNumber(run.id),
      sourceKind: "server_leaderboard",
      targetVersion: run.target_version,
      dateFrom: run.date_from,
      dateTo: run.date_to,
      updatedAt: run.generated_at || run.updated_at,
      sampleSize: totalSamples,
      excludedInvalidDeckRows: invalidDeckRows.length,
      excludedInvalidDeckSampleSize
    },
    home: {
      factionShare,
      representativeDecks: balancedUsageWinRows(homeRows, 4, {
        minWinRate: 54,
        minUsageRate: 0.6,
        minUsageShareOfMax: 0.15,
        minSampleSize: 10
      }),
      featuredCards: featuredCardsFromTopUsageDecks(homeRows, 4),
      summary: homeRows.length
        ? `${run.target_version} 正式榜单，前三势力合计 ${topShareTotal}%。`
        : "当前无可展示榜单数据。",
      tierRows: homeRows
    },
    clusterRows: homeRows,
    tierRows
  };
}

function normalizedLog(value, maxValue) {
  if (!maxValue) return 0;
  return Math.log1p(value) / Math.log1p(maxValue);
}

function rankScore(winRatePercent, sampleSize, maxSampleSize) {
  return Math.round(winRatePercent * 0.55 + normalizedLog(sampleSize, maxSampleSize) * 45);
}

function deckEvidenceTags(row) {
  const tags = [`综合 Rank ${row.rankScore}`];
  if (row.usageRate >= 15) tags.push("使用率高");
  if (row.winRate >= 54) tags.push("胜率高");
  if (row.sampleSize >= 100) tags.push("样本稳定");
  return tags;
}

function cardEvidenceTags(card) {
  const tags = [];
  if (card.rankScore >= 90) tags.push("综合 Rank 高");
  if (card.usageRate >= 15) tags.push("使用率高");
  if (card.winRate >= 54) tags.push("胜率高");
  if (card.usageRate >= 9) tags.push("构筑常客");
  return tags.length ? tags : ["综合观察"];
}

function namingSource(result) {
  if (result?.secondaryAxisCardId) return "combo";
  if (result?.deckType && result.deckType !== "unknown") return "type";
  return "single";
}

function categoryLookup(output) {
  const byDeck = new Map();
  for (const result of output.results || []) {
    byDeck.set(result.deckId, result);
  }
  const byCategory = new Map();
  for (const category of output.categories || []) {
    byCategory.set(category.categoryId, category);
  }
  return { byDeck, byCategory };
}

function analysisDeckDisplayName(categoryName, result, primaryCard, deckId) {
  const name = shortName(categoryName);
  if (name && name !== "Unclassified" && name !== "未分类") return name;
  return shortName(result?.primaryCoreCardName) || primaryCard?.name || deckId;
}

function buildTierRows(deckStats, classification, cardCatalog) {
  const { byDeck, byCategory } = categoryLookup(classification);
  const totalSamples = deckStats.reduce((sum, row) => sum + toNumber(row.sample_count), 0);

  const rows = deckStats
    .map((stat) => {
      const deckId = stat.deck_fingerprint;
      const result = byDeck.get(deckId);
      const category = result ? byCategory.get(result.categoryId) : null;
      const cards = deckCards(deckId, cardCatalog);
      const primaryCard = cards.find((card) => card.cardId === result?.primaryCoreCardId) || cards[0];
      const winRateValue = percent(stat.win_rate);
      const usageRateValue = totalSamples ? Number((toNumber(stat.sample_count) / totalSamples * 100).toFixed(1)) : 0;
      const categoryName = result?.categoryName || "Unclassified";
      const row = {
        deckId,
        deckName: analysisDeckDisplayName(categoryName, result, primaryCard, deckId),
        categoryId: result?.categoryId || "unclassified",
        categoryName,
        faction: deckFaction(cards, result?.primaryFaction || primaryCard?.faction),
        namingSource: namingSource(result),
        rankScore: 0,
        sourceRank: 0,
        winRate: winRateValue,
        playerAverageWinRate: winRateValue,
        usageRate: usageRateValue,
        kabukiPoints: 0,
        sampleSize: toNumber(stat.sample_count),
        imageUrl: primaryCard?.imageUrl || "",
        imageAlt: primaryCard?.name || categoryName,
        deckCards: cards,
        deckConfig: emptyDeckConfig()
      };
      return row;
    })
    .sort(compareDeckCompositeRank);

  const seenDeckIds = new Set();
  const uniqueRows = rows.filter((row) => {
    if (seenDeckIds.has(row.deckId)) return false;
    seenDeckIds.add(row.deckId);
    return true;
  });

  return applyDeckCompositeRanks(uniqueRows).map((row) => ({ ...row, evidenceTags: deckEvidenceTags(row) }));
}

function buildFactionShare(rows) {
  const byFaction = new Map();

  for (const row of rows) {
    const key = normalizeFaction(row.faction);
    if (!byFaction.has(key)) {
      byFaction.set(key, { faction: key, sampleSize: 0, representatives: [] });
    }
    const entry = byFaction.get(key);
    entry.sampleSize += row.sampleSize;
    if (entry.representatives.length < 2 && !entry.representatives.includes(row.deckName)) entry.representatives.push(row.deckName);
  }

  const ordered = Array.from(byFaction.values())
    .filter((entry) => entry.faction !== "unknown" && entry.sampleSize > 0)
    .sort((left, right) => {
      const sampleDiff = right.sampleSize - left.sampleSize;
      return sampleDiff || OFFICIAL_FACTION_ORDER.indexOf(left.faction) - OFFICIAL_FACTION_ORDER.indexOf(right.faction);
    })
    .slice(0, 7);

  const officialTotal = ordered.reduce((sum, entry) => sum + entry.sampleSize, 0);
  const rounded = ordered.map((entry) => ({
    faction: entry.faction,
    share: officialTotal ? Math.round(entry.sampleSize / officialTotal * 100) : 0,
    color: FACTION_COLORS[entry.faction] || FACTION_COLORS.unknown,
    representatives: entry.representatives
  }));

  const diff = 100 - rounded.reduce((sum, item) => sum + item.share, 0);
  if (rounded.length && Math.abs(diff) <= rounded.length) {
    rounded[0].share += diff;
  }

  return rounded.sort((left, right) => {
    const shareDiff = right.share - left.share;
    return shareDiff || OFFICIAL_FACTION_ORDER.indexOf(left.faction) - OFFICIAL_FACTION_ORDER.indexOf(right.faction);
  });
}

function buildFeaturedCards(cardStats, cardCatalog) {
  const totalSamples = cardStats.reduce((sum, row) => sum + toNumber(row.sample_count), 0);
  const maxSample = Math.max(...cardStats.map((row) => toNumber(row.sample_count)), 0);

  const rows = cardStats
    .map((stat) => {
      const card = cardView(stat.card_hash, cardCatalog);
      const winRateValue = percent(stat.win_rate);
      const usageRateValue = totalSamples ? Number((toNumber(stat.sample_count) / totalSamples * 100).toFixed(1)) : 0;
      const row = {
        cardId: stat.card_hash,
        name: card.name,
        faction: card.faction,
        imageUrl: card.imageUrl,
        imageAlt: card.imageAlt,
        rankScore: rankScore(winRateValue, toNumber(stat.sample_count), maxSample),
        winRate: winRateValue,
        usageRate: usageRateValue,
        sampleSize: toNumber(stat.sample_count)
      };
      return { ...row, evidenceTags: cardEvidenceTags(row) };
    })
    .sort((left, right) => right.rankScore - left.rankScore || right.sampleSize - left.sampleSize);

  const seenCardIds = new Set();
  return rows
    .filter((row) => {
      if (seenCardIds.has(row.cardId)) return false;
      seenCardIds.add(row.cardId);
      return true;
    })
    .slice(0, 8);
}

async function buildSnapshotFromData() {
  const shareConfig = latestShareConfig(await readJsonl(resolve(legacyRoot, "tables/server_share_config.jsonl")));
  const formalRuns = await readJsonl(resolve(legacyRoot, "tables/server_leaderboard_runs.jsonl"));
  const formalRun = latestFormalRun(formalRuns, shareConfig?.target_version);

  if (formalRun) {
    const formalRows = await readJsonl(resolve(legacyRoot, "tables/server_leaderboard_rows.jsonl"));
    const cardCatalog = await loadCardCatalog();
    const strategyTypes = await readOptionalJson(resolve(legacyRoot, "cards/card_strategy_types.json"), []);
    const snapshot = await buildFormalSnapshot(formalRun, formalRows, cardCatalog, strategyTypes);
    return snapshot;
  }

  const runs = await readJsonl(resolve(legacyRoot, "tables/analysis_runs.jsonl"));
  const run = latestCompletedRun(runs);
  const runId = toNumber(run.id);
  const deckStats = await readJsonl(
    resolve(legacyRoot, "tables/analysis_deck_stats.jsonl"),
    (row) => toNumber(row.analysis_run_id) === runId && row.sample_scope === "all_players"
  );
  const cardCatalog = await loadCardCatalog();
  const strategyTypes = await readOptionalJson(resolve(legacyRoot, "cards/card_strategy_types.json"), []);
  const classifierDecks = deckStats.map((row) => ({
    deckId: row.deck_fingerprint,
    deckName: row.deck_fingerprint,
    cards: String(row.deck_fingerprint).split(",").filter(Boolean),
    sampleCount: toNumber(row.sample_count),
    winCount: toNumber(row.win_count),
    lossCount: toNumber(row.loss_count),
    drawCount: toNumber(row.draw_count)
  }));
  const classification = classifyAnalysisDecks(classifierDecks, cardCatalog, {
    now: run.finished_at || new Date().toISOString(),
    strategyTypes
  });
  const tierRows = buildTierRows(deckStats, classification, cardCatalog);
  const representativeDecks = balancedUsageWinRows(tierRows, 4, {
    minWinRate: 54,
    minUsageRate: 0.6,
    minUsageShareOfMax: 0.15,
    minSampleSize: 10
  });
  const topDeck = tierRows[0] || null;
  const topShareTotal = buildFactionShare(tierRows).slice(0, 3).reduce((sum, item) => sum + item.share, 0);

  const snapshot = {
    metadata: {
      sourceRunId: runId,
      dateFrom: run.date_from,
      dateTo: run.date_to,
      updatedAt: run.finished_at,
      sampleSize: toNumber(run.counts_json?.side_samples)
    },
    home: {
      factionShare: buildFactionShare(tierRows),
      representativeDecks,
      featuredCards: featuredCardsFromTopUsageDecks(tierRows, 4),
      summary: topDeck
        ? `前三势力合计 ${topShareTotal}%，Top 3 卡组按综合 Rank 自动排序。`
        : "当前无可展示榜单数据。",
      tierRows
    },
    clusterRows: tierRows,
    tierRows
  };

  return snapshot;
}

export async function buildLeaderboardSnapshot(options = {}) {
  const previousLegacyRoot = legacyRoot;
  const previousDiagnosticsEnabled = diagnosticsEnabled;
  legacyRoot = options.legacyRoot ? resolve(options.legacyRoot) : defaultLegacyRoot;
  diagnosticsEnabled = Boolean(options.logDiagnostics);

  try {
    return await buildSnapshotFromData();
  } finally {
    legacyRoot = previousLegacyRoot;
    diagnosticsEnabled = previousDiagnosticsEnabled;
  }
}

export async function writeLeaderboardSnapshot(options = {}) {
  const outputPath = resolve(options.outputPath || resolve(repoRoot, "apps/web/public/data/leaderboard-snapshot.json"));
  const snapshot = await buildLeaderboardSnapshot({
    ...options,
    logDiagnostics: options.logDiagnostics ?? true
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return { snapshot, outputPath };
}

async function main() {
  const { snapshot, outputPath } = await writeLeaderboardSnapshot({ outputPath: process.argv[2] });
  const sourceKind = snapshot.metadata.sourceKind || "analysis";
  console.log(`snapshot=${outputPath}`);
  console.log(`${sourceKind}Run=${snapshot.metadata.sourceRunId} decks=${snapshot.tierRows.length} cards=${snapshot.home.featuredCards.length}`);
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
