"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  CLASSIFICATION_STATUS,
  CURRENT_CLASSIFIER_VERSION,
  UNCLASSIFIED_CATEGORY_ID,
  UNCLASSIFIED_CATEGORY_NAME,
} = require("../../../packages/contracts/deck-classification");

const DEFAULT_REVIEW_MARGIN = 0.15;
const DEFAULT_STRATEGY_CLOSE_MARGIN = 0.15;
const UNKNOWN_DECK_TYPE = "unknown";
const UNKNOWN_FACTION = "unknown";
const UNKNOWN_PLAN_TYPE = "unknown";
const DECK_TYPE_COMMAND = "号令";
const DECK_TYPE_BALANCE = "バランス";
const DECK_TYPE_MANY = "多枚数";
const LOW_COST_THRESHOLD = 1.5;
const SIX_CARD_LOW_COST_MIN_COUNT = 4;
const SECONDARY_AXIS_SUPPORT_THRESHOLD = 0.35;
const SECONDARY_AXIS_SUPPORT_REVIEW_MIN = 0.3;
const SECONDARY_AXIS_STRATEGY_RATIO_THRESHOLD = 0.55;
const SECONDARY_AXIS_STRATEGY_MIN_FREQUENCY = 0.35;
const PRIMARY_AXIS_COMMAND_RATIO_THRESHOLD = 0.7;
const PRIMARY_AXIS_COMMAND_MIN_FREQUENCY = 0.8;
const FACTION_PREFIXES = new Set(["蒼", "緋", "碧", "玄", "紫", "琥"]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function parseCsvObjects(text) {
  const rows = parseCsv(text).filter((row) => row.some((field) => field.trim()));
  const headers = rows.shift() || [];
  return rows.map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index] || "";
    });
    return item;
  });
}

function round4(value) {
  return Number((value || 0).toFixed(4));
}

function toNumber(value) {
  const number = Number(String(value || "").replace("%", ""));
  return Number.isFinite(number) ? number : 0;
}

function winRate(item) {
  return item.sampleCount > 0 ? round4(item.winCount / item.sampleCount) : 0;
}

function loadAnalysisDeckCsv(filePath) {
  const rows = parseCsvObjects(fs.readFileSync(filePath, "utf8"));

  return rows
    .filter((row) => row.deck_fingerprint)
    .map((row) => {
      const cards = row.deck_fingerprint
        .split(",")
        .map((cardHash) => cardHash.trim())
        .filter(Boolean);

      return {
        deckId: row.deck_fingerprint,
        deckName: row.deck || row.deck_fingerprint,
        cards,
        sampleCount: toNumber(row.sample_count),
        winCount: toNumber(row.win_count),
        lossCount: toNumber(row.loss_count),
        drawCount: toNumber(row.draw_count),
        rankScope: row.rank_scope || row.rankScope || null,
      };
    });
}

function rowsFromPayload(payload, preferredKeys = []) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  for (const key of preferredKeys) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }

  for (const key of ["rows", "cards", "rules", "strategyTypes", "strategyUsage", "data"]) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }

  return [];
}

function loadRowsFile(filePath, preferredKeys = []) {
  if (!filePath) {
    return [];
  }

  const text = fs.readFileSync(filePath, "utf8");
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  if (path.extname(filePath).toLowerCase() === ".json" || trimmed[0] === "{" || trimmed[0] === "[") {
    return rowsFromPayload(JSON.parse(trimmed), preferredKeys);
  }

  return parseCsvObjects(text);
}

function loadCoreRules(filePath) {
  return normalizeCoreRules(loadRowsFile(filePath, ["rules"]));
}

function normalizeCoreRules(rules) {
  return (rules || [])
    .map((rule, index) => ({
      cardId: String(rule.cardId || rule.card_id || "").trim(),
      deckType: String(rule.deckType || rule.deck_type || "").trim(),
      priority: toNumber(rule.priority),
      displayName: String(rule.displayName || rule.display_name || "").trim(),
      index,
    }))
    .filter((rule) => rule.cardId);
}

function coreRuleMap(coreRules) {
  const rulesByCard = new Map();

  for (const rule of normalizeCoreRules(coreRules)) {
    const current = rulesByCard.get(rule.cardId);
    if (!current || rule.priority > current.priority) {
      rulesByCard.set(rule.cardId, rule);
    }
  }

  return rulesByCard;
}

function cardHashIds(card) {
  const values = [
    card.hash_id,
    card.hashId,
    card.card_hash,
    card.cardHash,
    card.canonical_hash,
    card.canonicalHash,
    card.gameplay_hash,
    card.gameplayHash,
    card.id,
    ...(Array.isArray(card.hash_ids) ? card.hash_ids : []),
  ];
  return values.map((value) => String(value || "").trim()).filter(Boolean);
}

function loadCardCatalog(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const cards = Array.isArray(payload) ? payload : payload.cards || [];
  const byHash = {};

  for (const card of cards) {
    if (!card || typeof card !== "object") {
      continue;
    }

    for (const hashId of cardHashIds(card)) {
      byHash[hashId] = card;
    }
  }

  return byHash;
}

function loadStrategyTypes(filePath) {
  return normalizeStrategyTypes(loadRowsFile(filePath, ["strategyTypes", "cards", "rows"]));
}

function loadStrategyUsage(filePath) {
  if (!filePath) {
    return [];
  }

  const text = fs.readFileSync(filePath, "utf8");
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  if (path.extname(filePath).toLowerCase() === ".json" || trimmed[0] === "{" || trimmed[0] === "[") {
    return JSON.parse(trimmed);
  }

  return parseCsvObjects(text);
}

function cardCost(card) {
  if (!card) {
    return 0;
  }

  return toNumber(card.cost_value || card.costValue || card.cost || card.cost_label);
}

function cardFaction(card) {
  const faction = String(card?.faction || "").trim();
  if (faction) {
    return faction;
  }

  const cardCode = String(card?.card_code || card?.cardCode || card?.code || "").trim();
  const prefix = Array.from(cardCode)[0] || "";
  return FACTION_PREFIXES.has(prefix) ? prefix : UNKNOWN_FACTION;
}

function cardUnitType(card) {
  return String(card?.unitType || card?.unit_type || card?.unitTypeName || "").trim();
}

function cardLabel(cardHash, cardCatalog) {
  const card = cardCatalog[cardHash];
  if (!card) {
    return `Unknown Card(${cardHash.slice(0, 8)})`;
  }

  const name = card.name || card.rawName || card.card_code || cardHash;
  const cost = card.cost || card.cost_label || card.cost_value || "";
  const unitType = cardUnitType(card);
  const suffix = [cost, unitType].filter(Boolean).join(" ");
  return suffix ? `${name}(${suffix})` : name;
}

function cardDisplayName(cardHash, cardCatalog, rule) {
  if (rule?.displayName) {
    return rule.displayName;
  }

  return cardLabel(cardHash, cardCatalog);
}

function shortCardName(cardHash, cardCatalog, rule) {
  return cardDisplayName(cardHash, cardCatalog, rule).split("(", 1)[0];
}

function uniqueCards(cards) {
  return Array.from(new Set((cards || []).filter(Boolean)));
}

function dedupeDecks(decks) {
  const merged = new Map();

  for (const deck of decks || []) {
    if (!deck?.deckId) {
      continue;
    }

    const current = merged.get(deck.deckId);
    if (!current) {
      merged.set(deck.deckId, { ...deck, cards: uniqueCards(deck.cards) });
      continue;
    }

    current.sampleCount += deck.sampleCount || 0;
    current.winCount += deck.winCount || 0;
    current.lossCount += deck.lossCount || 0;
    current.drawCount += deck.drawCount || 0;
    current.cards = uniqueCards([...current.cards, ...(deck.cards || [])]);
    current.rankScope = current.rankScope || deck.rankScope || null;
  }

  return Array.from(merged.values());
}

function buildCardStats(decks) {
  const stats = new Map();
  let totalSampleCount = 0;

  for (const deck of decks) {
    const cards = uniqueCards(deck.cards);
    const sampleCount = deck.sampleCount || 0;
    totalSampleCount += sampleCount;

    for (const cardId of cards) {
      if (!stats.has(cardId)) {
        stats.set(cardId, {
          cardId,
          deckCount: 0,
          sampleCount: 0,
          winCount: 0,
          lossCount: 0,
          drawCount: 0,
          highRankerSampleCount: 0,
          partners: new Map(),
        });
      }

      const stat = stats.get(cardId);
      stat.deckCount += 1;
      stat.sampleCount += sampleCount;
      stat.winCount += deck.winCount || 0;
      stat.lossCount += deck.lossCount || 0;
      stat.drawCount += deck.drawCount || 0;

      if (deck.rankScope && /high|top|ranker/i.test(String(deck.rankScope))) {
        stat.highRankerSampleCount += sampleCount;
      }

      for (const partnerId of cards) {
        if (partnerId !== cardId) {
          stat.partners.set(partnerId, (stat.partners.get(partnerId) || 0) + sampleCount);
        }
      }
    }
  }

  return { stats, totalSampleCount };
}

function strongestPartnerRatio(cardId, deck, cardStats) {
  const stat = cardStats.get(cardId);
  if (!stat || stat.sampleCount <= 0) {
    return 0;
  }

  const partnerSamples = uniqueCards(deck.cards)
    .filter((partnerId) => partnerId !== cardId)
    .map((partnerId) => stat.partners.get(partnerId) || 0);
  const strongest = Math.max(0, ...partnerSamples);
  return strongest / stat.sampleCount;
}

function fallbackCoreScore(cardId, deck, cardCatalog, cardStats, rule) {
  const stat = cardStats.get(cardId) || { sampleCount: 0, highRankerSampleCount: 0 };
  const usageScore = Math.log1p(stat.sampleCount) * 100;
  const stabilityScore = strongestPartnerRatio(cardId, deck, cardStats) * 50;
  const rankScore = Math.log1p(stat.highRankerSampleCount || 0) * 20;
  const costScore = cardCost(cardCatalog[cardId]) * 50;
  const ruleScore = rule ? rule.priority : 0;
  return usageScore + stabilityScore + rankScore + costScore + ruleScore;
}

function parseMaybeJsonArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return value ? [value] : [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed[0] === "[" || trimmed[0] === "{") {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [trimmed];
    }
  }

  return trimmed.split(/[,:;|]/).map((item) => item.trim()).filter(Boolean);
}

function inferPlanType(row = {}) {
  const categoryValues = [
    row.mainPlanType,
    row.main_plan_type,
    row.planType,
    row.plan_type,
    row.strategyType,
    row.strategy_type,
    row.stratCategory,
    row.strat_category,
    row.category,
    row.deckType,
    row.deck_type,
    ...parseMaybeJsonArray(row.categories),
    ...parseMaybeJsonArray(row.strat_categories_json),
    ...parseMaybeJsonArray(row.stratCategories),
    ...parseMaybeJsonArray(row.effectCategories),
  ];
  const textValues = [
    row.strategyText,
    row.strategy_text,
    row.strat_caption,
    row.stratCaption,
    row.strat_detail_text,
    row.stratDetailText,
    row.description,
  ];
  const text = [...categoryValues, ...textValues]
    .map((value) => {
      if (value && typeof value === "object") {
        return Object.values(value).join(" ");
      }
      return String(value || "");
    })
    .join(" ");

  if (/号令|號令/.test(text)) {
    return "号令";
  }
  if (/陣形|陣型|阵型|formation/i.test(text)) {
    return "陣形";
  }
  if (/全体|全軍|味方.*全|allies|all ally|team/i.test(text)) {
    return "全体強化";
  }
  if (/ダメージ|傷害|伤害|damage/i.test(text)) {
    return "ダメージ";
  }
  if (/単体|單体|单体|自身|一部隊|1部隊|強化|强化|buff/i.test(text)) {
    return "単体強化";
  }

  return String(categoryValues.find(Boolean) || "").trim() || UNKNOWN_PLAN_TYPE;
}

function cardAliases(cardId, card) {
  return [
    cardId,
    card?.hash_id,
    card?.hashId,
    card?.card_hash,
    card?.cardHash,
    card?.canonical_hash,
    card?.canonicalHash,
    card?.gameplay_hash,
    card?.gameplayHash,
    card?.card_code,
    card?.cardCode,
    card?.code,
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function addStrategyType(typesByKey, row) {
  if (!row || typeof row !== "object") {
    return;
  }

  const planType = inferPlanType(row);
  const aliases = [
    row.cardId,
    row.card_id,
    row.cardHash,
    row.card_hash,
    row.hashId,
    row.hash_id,
    row.canonical_hash,
    row.gameplay_hash,
    row.id,
    row.cardCode,
    row.card_code,
    row.code,
  ].map((value) => String(value || "").trim()).filter(Boolean);

  for (const alias of aliases) {
    typesByKey.set(alias, {
      mainPlanType: planType,
      sourceCategory: String(row.category || row.stratCategory || row.strategyType || "").trim(),
    });
  }
}

function normalizeStrategyTypes(strategyTypes) {
  if (strategyTypes instanceof Map) {
    return strategyTypes;
  }

  const typesByKey = new Map();
  for (const row of rowsFromPayload(strategyTypes, ["strategyTypes", "cards", "rows"])) {
    addStrategyType(typesByKey, row);
  }
  return typesByKey;
}

function strategyTypeForCard(cardId, cardCatalog, strategyTypesByKey, rule) {
  const card = cardCatalog[cardId];
  const aliases = cardAliases(cardId, card);

  for (const alias of aliases) {
    const found = strategyTypesByKey.get(alias);
    if (found?.mainPlanType) {
      return found;
    }
  }

  const cardPlanType = inferPlanType(card || {});
  if (cardPlanType !== UNKNOWN_PLAN_TYPE) {
    return { mainPlanType: cardPlanType, sourceCategory: "cardCatalog" };
  }

  if (rule?.deckType) {
    return { mainPlanType: inferPlanType(rule), sourceCategory: "coreRule" };
  }

  return { mainPlanType: UNKNOWN_PLAN_TYPE, sourceCategory: "" };
}

function isCommandPlanType(mainPlanType) {
  return /号令|全体|陣形|陣型|阵型|formation/i.test(String(mainPlanType || ""));
}

function isBalancePlanType(mainPlanType) {
  return /単体|單体|单体|強化|强化|ダメージ|傷害|伤害|妨害|特殊|効果|damage/i.test(
    String(mainPlanType || ""),
  );
}

function deckTypeFromPlanType(mainPlanType) {
  if (isCommandPlanType(mainPlanType)) {
    return { deckType: DECK_TYPE_COMMAND, known: true };
  }
  if (isBalancePlanType(mainPlanType)) {
    return { deckType: DECK_TYPE_BALANCE, known: true };
  }
  return { deckType: DECK_TYPE_BALANCE, known: false };
}

function strategyUsageRowsFromObject(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const directRows = rowsFromPayload(payload, ["strategyUsage", "rows"]);
  if (directRows.length > 0) {
    return directRows;
  }

  const rows = [];
  for (const [deckId, cards] of Object.entries(payload)) {
    if (Array.isArray(cards)) {
      for (const row of cards) {
        rows.push({ deckId, ...row });
      }
      continue;
    }

    if (cards && typeof cards === "object") {
      for (const [cardId, stat] of Object.entries(cards)) {
        if (stat && typeof stat === "object") {
          rows.push({ deckId, cardId, ...stat });
        } else {
          rows.push({ deckId, cardId, strategyFrequency: stat });
        }
      }
    }
  }
  return rows;
}

function usageStatFromRow(row) {
  const matchCount = toNumber(
    row.matchCount || row.match_count || row.sampleCount || row.sample_count || row.games,
  );
  const strategyCount = toNumber(
    row.strategyCount || row.strategy_count || row.totalStrategyCount || row.total_strategy_count || row.count,
  );
  const explicitFrequency = row.strategyFrequency
    || row.strategy_frequency
    || row.avgStrategyCount
    || row.avg_strategy_count
    || row.perMatch
    || row.per_match;
  const strategyFrequency = explicitFrequency !== undefined && explicitFrequency !== ""
    ? toNumber(explicitFrequency)
    : (matchCount > 0 ? strategyCount / matchCount : 0);

  return {
    matchCount,
    strategyCount,
    strategyFrequency: round4(strategyFrequency),
    hasData: true,
  };
}

function mergeUsageStat(left, right) {
  if (!left) {
    return right;
  }

  const matchCount = (left.matchCount || 0) + (right.matchCount || 0);
  const strategyCount = (left.strategyCount || 0) + (right.strategyCount || 0);

  if (matchCount > 0 && strategyCount > 0) {
    return {
      matchCount,
      strategyCount,
      strategyFrequency: round4(strategyCount / matchCount),
      hasData: true,
    };
  }

  const leftWeight = left.matchCount || 1;
  const rightWeight = right.matchCount || 1;
  return {
    matchCount,
    strategyCount,
    strategyFrequency: round4(
      ((left.strategyFrequency || 0) * leftWeight + (right.strategyFrequency || 0) * rightWeight)
        / (leftWeight + rightWeight),
    ),
    hasData: true,
  };
}

function normalizeStrategyUsage(strategyUsage) {
  if (strategyUsage instanceof Map) {
    return strategyUsage;
  }

  const usageByDeck = new Map();
  for (const row of strategyUsageRowsFromObject(strategyUsage)) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const deckId = String(row.deckId || row.deck_id || row.deckFingerprint || row.deck_fingerprint || "").trim();
    const cardAliasesForRow = [
      row.cardId,
      row.card_id,
      row.cardHash,
      row.card_hash,
      row.hashId,
      row.hash_id,
      row.cardCode,
      row.card_code,
      row.code,
      row.id,
    ].map((value) => String(value || "").trim()).filter(Boolean);

    if (!deckId || cardAliasesForRow.length === 0) {
      continue;
    }

    if (!usageByDeck.has(deckId)) {
      usageByDeck.set(deckId, new Map());
    }

    const deckUsage = usageByDeck.get(deckId);
    const stat = usageStatFromRow(row);
    for (const alias of cardAliasesForRow) {
      deckUsage.set(alias, mergeUsageStat(deckUsage.get(alias), stat));
    }
  }

  return usageByDeck;
}

function strategyUsageForCard(deck, cardId, cardCatalog, strategyUsageByDeck) {
  const deckUsage = strategyUsageByDeck.get(deck.deckId);
  if (!deckUsage) {
    return null;
  }

  for (const alias of cardAliases(cardId, cardCatalog[cardId])) {
    const stat = deckUsage.get(alias);
    if (stat) {
      return stat;
    }
  }

  return {
    matchCount: deck.sampleCount || 0,
    strategyCount: 0,
    strategyFrequency: 0,
    hasData: true,
  };
}

function scoreCoreCandidate(
  cardId,
  deck,
  cardCatalog,
  cardStats,
  rulesByCard,
  strategyTypesByKey,
  strategyUsageByDeck,
) {
  const rule = rulesByCard.get(cardId);
  const usage = strategyUsageForCard(deck, cardId, cardCatalog, strategyUsageByDeck);
  const strategyType = strategyTypeForCard(cardId, cardCatalog, strategyTypesByKey, rule);
  const fallbackScore = fallbackCoreScore(cardId, deck, cardCatalog, cardStats, rule);

  return {
    cardId,
    rule,
    cost: cardCost(cardCatalog[cardId]),
    fallbackScore,
    score: usage ? usage.strategyFrequency : fallbackScore,
    hasStrategyData: Boolean(usage?.hasData),
    strategyFrequency: usage ? usage.strategyFrequency : 0,
    strategyCount: usage ? usage.strategyCount : 0,
    strategyMatchCount: usage ? usage.matchCount : 0,
    mainPlanType: strategyType.mainPlanType,
    planTypeSource: strategyType.sourceCategory,
  };
}

function compareCoreCandidates(left, right, strategyCloseMargin) {
  if (left.hasStrategyData || right.hasStrategyData) {
    if (left.hasStrategyData !== right.hasStrategyData) {
      return left.hasStrategyData ? -1 : 1;
    }

    const frequencyDiff = right.strategyFrequency - left.strategyFrequency;
    if (Math.abs(frequencyDiff) > strategyCloseMargin) {
      return frequencyDiff;
    }

    const costDiff = right.cost - left.cost;
    if (costDiff) {
      return costDiff;
    }

    if (frequencyDiff) {
      return frequencyDiff;
    }
  }

  const scoreDiff = right.fallbackScore - left.fallbackScore;
  if (scoreDiff) {
    return scoreDiff;
  }

  return right.cost - left.cost || left.cardId.localeCompare(right.cardId);
}

function coreMargin(best, second) {
  if (!best || !second) {
    return 1;
  }

  if (best.hasStrategyData && second.hasStrategyData) {
    const denominator = Math.max(best.strategyFrequency, second.strategyFrequency, 1);
    return round4(Math.abs(best.strategyFrequency - second.strategyFrequency) / denominator);
  }

  const denominator = Math.max(best.fallbackScore, second.fallbackScore, 1);
  return round4(Math.abs(best.fallbackScore - second.fallbackScore) / denominator);
}

function selectCore(
  deck,
  cardCatalog,
  cardStats,
  rulesByCard,
  strategyTypesByKey,
  strategyUsageByDeck,
  reviewMargin,
  strategyCloseMargin,
) {
  const candidates = uniqueCards(deck.cards)
    .map((cardId) => scoreCoreCandidate(
      cardId,
      deck,
      cardCatalog,
      cardStats,
      rulesByCard,
      strategyTypesByKey,
      strategyUsageByDeck,
    ))
    .sort((left, right) => compareCoreCandidates(left, right, strategyCloseMargin));

  const best = candidates[0] || null;
  const second = candidates[1] || null;
  const margin = coreMargin(best, second);
  const hasAnyStrategyData = candidates.some((candidate) => candidate.hasStrategyData);
  const closeStrategyCandidates = Boolean(
    best
      && second
      && best.hasStrategyData
      && second.hasStrategyData
      && (Math.abs(best.strategyFrequency - second.strategyFrequency) <= strategyCloseMargin
        || margin <= reviewMargin),
  );

  return {
    best,
    second,
    candidates,
    margin,
    hasStrategyData: hasAnyStrategyData,
    needsReview: !hasAnyStrategyData || Boolean(best?.strategyFrequency === 0 && hasAnyStrategyData) || closeStrategyCandidates,
  };
}

function primaryAxisOverrideCandidate(core) {
  const current = core?.best;
  if (!current || !current.hasStrategyData || current.strategyFrequency <= 0) {
    return null;
  }

  const currentType = deckTypeFromPlanType(current.mainPlanType);
  if (currentType.deckType !== DECK_TYPE_BALANCE) {
    return null;
  }

  return (core.candidates || [])
    .filter((candidate) => (
      candidate.cardId !== current.cardId
      && candidate.hasStrategyData
      && isCommandPlanType(candidate.mainPlanType)
      && candidate.strategyFrequency >= PRIMARY_AXIS_COMMAND_MIN_FREQUENCY
      && candidate.strategyFrequency / current.strategyFrequency >= PRIMARY_AXIS_COMMAND_RATIO_THRESHOLD
    ))
    .sort((left, right) => (
      right.strategyFrequency - left.strategyFrequency
      || right.cost - left.cost
      || right.fallbackScore - left.fallbackScore
      || left.cardId.localeCompare(right.cardId)
    ))[0] || null;
}

function applyPrimaryAxisOverride(core) {
  const override = primaryAxisOverrideCandidate(core);
  if (!override) {
    return {
      ...core,
      primaryAxisOverrideReason: "",
    };
  }

  const previousBest = core.best;
  const candidates = [
    override,
    ...core.candidates.filter((candidate) => candidate.cardId !== override.cardId),
  ];

  return {
    ...core,
    best: override,
    second: previousBest,
    candidates,
    margin: coreMargin(override, previousBest),
    primaryAxisOverrideReason: "commandFrequency>=70%balancePrimary",
  };
}

function primaryFaction(deck, cardCatalog) {
  const costsByFaction = new Map();

  for (const cardId of uniqueCards(deck.cards)) {
    const card = cardCatalog[cardId];
    const faction = cardFaction(card);
    const cost = cardCost(card) || 1;
    costsByFaction.set(faction, (costsByFaction.get(faction) || 0) + cost);
  }

  const sorted = Array.from(costsByFaction.entries()).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  return sorted[0]?.[0] || UNKNOWN_FACTION;
}

function deckSizeRule(deck, cardCatalog) {
  const cards = uniqueCards(deck.cards);
  const lowCostCount = cards.filter((cardId) => cardCost(cardCatalog[cardId]) <= LOW_COST_THRESHOLD).length;

  if (cards.length >= 7) {
    return {
      deckType: DECK_TYPE_MANY,
      deckSizeReason: "cardCount>=7",
      lowCostCount,
    };
  }

  if (cards.length === 6 && lowCostCount >= SIX_CARD_LOW_COST_MIN_COUNT) {
    return {
      deckType: DECK_TYPE_MANY,
      deckSizeReason: "cardCount=6 lowCostCount>=4",
      lowCostCount,
    };
  }

  return {
    deckType: "",
    deckSizeReason: "",
    lowCostCount,
  };
}

function selectDeckType(deck, core, cardCatalog) {
  const sizeRule = deckSizeRule(deck, cardCatalog);
  const mainPlanType = core?.best?.mainPlanType || UNKNOWN_PLAN_TYPE;

  if (sizeRule.deckType) {
    return {
      deckType: sizeRule.deckType,
      mainPlanType,
      deckSizeReason: sizeRule.deckSizeReason,
      lowCostCount: sizeRule.lowCostCount,
      needsReview: false,
      typeKnown: true,
    };
  }

  const inferred = deckTypeFromPlanType(mainPlanType);
  return {
    deckType: inferred.deckType,
    mainPlanType,
    deckSizeReason: "",
    lowCostCount: sizeRule.lowCostCount,
    needsReview: !inferred.known,
    typeKnown: inferred.known,
  };
}

function categoryHash(primaryFactionValue, primaryCoreCardId, secondaryAxisCardId, deckType) {
  const raw = [primaryFactionValue, primaryCoreCardId, secondaryAxisCardId || "", deckType].join("|");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return `archetype-${hash.slice(0, 16)}`;
}

function baseAxisKey(item) {
  return [item.primaryFaction, item.primaryCoreCardId, item.deckType].join("|");
}

function categoryAxisKey(item) {
  return [
    item.primaryFaction,
    item.primaryCoreCardId,
    item.secondaryAxisCardId || "",
    item.deckType,
  ].join("|");
}

function selectAxisPartners(items, cardStats, cardCatalog) {
  const weighted = new Map();
  const primaryCoreCardId = items[0]?.primaryCoreCardId || "";

  for (const item of items) {
    for (const cardId of uniqueCards(item.deck.cards)) {
      if (cardId !== primaryCoreCardId) {
        weighted.set(cardId, (weighted.get(cardId) || 0) + item.deck.sampleCount);
      }
    }
  }

  return Array.from(weighted.keys())
    .sort((left, right) => {
      const sampleCompare = (weighted.get(right) || 0) - (weighted.get(left) || 0);
      if (sampleCompare) {
        return sampleCompare;
      }

      const globalCompare =
        (cardStats.get(right)?.sampleCount || 0) - (cardStats.get(left)?.sampleCount || 0);
      return globalCompare || cardCost(cardCatalog[right]) - cardCost(cardCatalog[left]) || left.localeCompare(right);
    })
    .slice(0, 2);
}

function axisPartnerSupport(items, partnerCardIds) {
  const sampleCount = items.reduce((sum, item) => sum + item.deck.sampleCount, 0);
  if (!sampleCount || partnerCardIds.length === 0) {
    return 0;
  }

  const partnerSampleCount = items
    .filter((item) => partnerCardIds.some((cardId) => item.deck.cards.includes(cardId)))
    .reduce((sum, item) => sum + item.deck.sampleCount, 0);
  return round4(partnerSampleCount / sampleCount);
}

function planTypeRecognized(mainPlanType) {
  return Boolean(mainPlanType && mainPlanType !== UNKNOWN_PLAN_TYPE);
}

function secondaryAxisCompatibility(deckType, mainPlanType) {
  if (!planTypeRecognized(mainPlanType)) {
    return "unknownPlanType";
  }

  if (deckType === DECK_TYPE_COMMAND) {
    return isCommandPlanType(mainPlanType) ? "" : "typeConflict";
  }

  if (deckType === DECK_TYPE_BALANCE) {
    return !isCommandPlanType(mainPlanType) && isBalancePlanType(mainPlanType) ? "" : "typeConflict";
  }

  if (deckType === DECK_TYPE_MANY) {
    return "";
  }

  return "unknownPlanType";
}

function secondaryAxisSupport(items) {
  const sampleCount = items.reduce((sum, item) => sum + item.deck.sampleCount, 0);
  const samplesByCard = new Map();

  for (const item of items) {
    for (const cardId of uniqueCards(item.deck.cards)) {
      if (cardId !== item.primaryCoreCardId) {
        samplesByCard.set(cardId, (samplesByCard.get(cardId) || 0) + item.deck.sampleCount);
      }
    }
  }

  const supportByCard = new Map();
  for (const [cardId, cardSampleCount] of samplesByCard.entries()) {
    supportByCard.set(cardId, {
      sampleCount: cardSampleCount,
      support: sampleCount > 0 ? round4(cardSampleCount / sampleCount) : 0,
    });
  }

  return supportByCard;
}

function secondaryAxisReason(candidate) {
  if (candidate.support >= SECONDARY_AXIS_SUPPORT_THRESHOLD) {
    return "support>=0.35";
  }

  if (candidate.strategyRatio >= SECONDARY_AXIS_STRATEGY_RATIO_THRESHOLD) {
    return "strategyFrequency>=55%primary";
  }

  return "";
}

function evaluateSecondaryAxisCandidate(item, candidate, supportByCard, cardCatalog) {
  const supportInfo = supportByCard.get(candidate.cardId) || { sampleCount: 0, support: 0 };
  const strategyRatio = item.strategyFrequency > 0
    ? round4(candidate.strategyFrequency / item.strategyFrequency)
    : 0;
  const supportQualified = supportInfo.support >= SECONDARY_AXIS_SUPPORT_THRESHOLD;
  const frequencyQualified = Boolean(
    candidate.hasStrategyData
      && item.strategyFrequency > 0
      && strategyRatio >= SECONDARY_AXIS_STRATEGY_RATIO_THRESHOLD,
  );
  const typeRecognized = planTypeRecognized(candidate.mainPlanType);
  const qualityQualified =
    candidate.cost >= 2
    || candidate.strategyFrequency >= SECONDARY_AXIS_STRATEGY_MIN_FREQUENCY;
  const lowCostGeneric =
    candidate.cost <= LOW_COST_THRESHOLD
    && candidate.strategyFrequency < SECONDARY_AXIS_STRATEGY_MIN_FREQUENCY;
  const evidenceQualified = supportQualified || frequencyQualified;
  const compatibilityReason = secondaryAxisCompatibility(item.deckType, candidate.mainPlanType);
  const rejectionReason =
    !evidenceQualified
      ? ""
      : compatibilityReason
        || (lowCostGeneric ? "lowCostGeneric" : "")
        || (!qualityQualified ? "insufficientQuality" : "");
  const qualifies = evidenceQualified && qualityQualified && !lowCostGeneric && !compatibilityReason;

  return {
    cardId: candidate.cardId,
    cardName: cardLabel(candidate.cardId, cardCatalog),
    cost: candidate.cost,
    support: supportInfo.support,
    supportSampleCount: supportInfo.sampleCount,
    strategyFrequency: candidate.strategyFrequency,
    strategyRatio,
    mainPlanType: candidate.mainPlanType,
    typeRecognized,
    qualifies,
    rejectionReason,
    reason: qualifies ? secondaryAxisReason({ support: supportInfo.support, strategyRatio }) : "",
  };
}

function selectSecondaryAxis(item, supportByCard, cardCatalog) {
  const candidates = (item.coreCandidates || [])
    .filter((candidate) => candidate.cardId !== item.primaryCoreCardId)
    .map((candidate) => evaluateSecondaryAxisCandidate(item, candidate, supportByCard, cardCatalog))
    .sort((left, right) => {
      const supportCompare = right.support - left.support;
      if (supportCompare) {
        return supportCompare;
      }

      const strategyCompare = right.strategyFrequency - left.strategyFrequency;
      if (strategyCompare) {
        return strategyCompare;
      }

      return right.cost - left.cost || left.cardId.localeCompare(right.cardId);
    });

  const selected = candidates.find((candidate) => candidate.qualifies) || null;
  const rejectedCandidates = candidates
    .filter((candidate) => candidate.rejectionReason)
    .slice(0, 5);
  const rejectedNeedsReview = rejectedCandidates.some((candidate) => (
    candidate.strategyFrequency >= SECONDARY_AXIS_STRATEGY_MIN_FREQUENCY
    || candidate.strategyRatio >= SECONDARY_AXIS_STRATEGY_RATIO_THRESHOLD
  ));
  const supportNeedsReview = Boolean(
    selected
      && selected.support >= SECONDARY_AXIS_SUPPORT_REVIEW_MIN
      && selected.support < SECONDARY_AXIS_SUPPORT_THRESHOLD,
  );

  return {
    selected,
    candidates: candidates.slice(0, 5),
    rejectedCandidates,
    needsReview: supportNeedsReview || rejectedNeedsReview,
  };
}

function applySecondaryAxes(items, cardCatalog) {
  const supportByCard = secondaryAxisSupport(items);

  return items.map((item) => {
    const secondary = selectSecondaryAxis(item, supportByCard, cardCatalog);
    const selected = secondary.selected;

    return {
      ...item,
      secondaryAxisCardId: selected?.cardId || "",
      secondaryAxisCardName: selected?.cardName || "",
      secondaryAxisReason: selected?.reason || "",
      secondaryAxisSupport: selected?.support || 0,
      secondaryAxisCandidates: secondary.candidates,
      secondaryAxisRejectedCandidates: secondary.rejectedCandidates,
      needsReview: item.needsReview || secondary.needsReview,
    };
  });
}

function categoryName(primaryCoreCardId, secondaryAxisCardId, deckType, cardCatalog, rule) {
  const coreName = shortCardName(primaryCoreCardId, cardCatalog, rule) || "Unknown Deck";
  const secondaryName = secondaryAxisCardId ? shortCardName(secondaryAxisCardId, cardCatalog) : "";
  const axisName = secondaryName ? `${coreName}や${secondaryName}` : coreName;
  return deckType && deckType !== UNKNOWN_DECK_TYPE ? `${axisName}${deckType}デッキ` : `${axisName}デッキ`;
}

function confidence(coreMarginValue, partnerSupport, hasStrategyData, typeKnown, needsReview) {
  const value =
    0.35
    + Math.min(coreMarginValue, 1) * 0.35
    + partnerSupport * 0.1
    + (hasStrategyData ? 0.15 : 0)
    + (typeKnown ? 0.05 : 0)
    - (needsReview ? 0.1 : 0);
  return round4(Math.max(0, Math.min(1, value)));
}

function candidateEvidence(candidate, cardCatalog) {
  return {
    cardId: candidate.cardId,
    cardName: cardLabel(candidate.cardId, cardCatalog),
    cost: candidate.cost,
    strategyFrequency: candidate.strategyFrequency,
    mainPlanType: candidate.mainPlanType,
    hasStrategyData: candidate.hasStrategyData,
    score: round4(candidate.score),
  };
}

function unclassifiedDeck(deck, options = {}) {
  return {
    deckId: deck.deckId,
    categoryId: UNCLASSIFIED_CATEGORY_ID,
    categoryName: UNCLASSIFIED_CATEGORY_NAME,
    primaryFaction: UNKNOWN_FACTION,
    primaryCoreCardId: "",
    primaryCoreCardName: "",
    secondaryAxisCardId: "",
    secondaryAxisCardName: "",
    secondaryAxisReason: "",
    partnerCardIds: [],
    partnerCardNames: [],
    deckType: UNKNOWN_DECK_TYPE,
    status: CLASSIFICATION_STATUS.UNCLASSIFIED,
    confidence: 0,
    needsReview: true,
    evidence: {
      sampleCount: deck.sampleCount || 0,
      winRate: winRate(deck),
      strategyFrequency: 0,
      axisCandidates: [],
      primaryAxisOverrideReason: "",
      secondaryAxisCandidates: [],
      secondaryAxisRejectedCandidates: [],
      secondaryAxisSupport: 0,
      deckCardCount: uniqueCards(deck.cards).length,
      mainPlanType: UNKNOWN_PLAN_TYPE,
      coreSupport: 0,
      partnerSupport: 0,
      rankScope: deck.rankScope || null,
    },
    classifierVersion: options.classifierVersion || CURRENT_CLASSIFIER_VERSION,
    classifiedAt: options.now || new Date().toISOString(),
  };
}

function weightedStrategyFrequency(items) {
  const sampleCount = items.reduce((sum, item) => sum + item.deck.sampleCount, 0);
  if (!sampleCount) {
    return 0;
  }

  return round4(
    items.reduce((sum, item) => sum + item.strategyFrequency * item.deck.sampleCount, 0) / sampleCount,
  );
}

function classifyAnalysisDecks(decks, cardCatalog, options = {}) {
  const now = options.now || new Date().toISOString();
  const classifierVersion = options.classifierVersion || CURRENT_CLASSIFIER_VERSION;
  const reviewMargin = options.reviewMargin ?? DEFAULT_REVIEW_MARGIN;
  const strategyCloseMargin = options.strategyCloseMargin ?? DEFAULT_STRATEGY_CLOSE_MARGIN;
  const coreRules = normalizeCoreRules(options.coreRules || []);
  const rulesByCard = coreRuleMap(coreRules);
  const strategyTypesByKey = normalizeStrategyTypes(options.strategyTypes || options.planTypes || []);
  const strategyUsageByDeck = normalizeStrategyUsage(options.strategyUsage || []);
  const normalizedDecks = dedupeDecks(decks);
  const { stats: cardStats, totalSampleCount } = buildCardStats(normalizedDecks);
  const initialItems = [];
  const results = [];

  for (const deck of normalizedDecks) {
    const selectedCore = selectCore(
      deck,
      cardCatalog,
      cardStats,
      rulesByCard,
      strategyTypesByKey,
      strategyUsageByDeck,
      reviewMargin,
      strategyCloseMargin,
    );
    const core = applyPrimaryAxisOverride(selectedCore);
    if (!core.best) {
      results.push(unclassifiedDeck(deck, { now, classifierVersion }));
      continue;
    }

    const type = selectDeckType(deck, core, cardCatalog);
    const coreStat = cardStats.get(core.best.cardId);
    const coreSupport = totalSampleCount > 0 ? round4((coreStat?.sampleCount || 0) / totalSampleCount) : 0;

    initialItems.push({
      deck,
      primaryFaction: primaryFaction(deck, cardCatalog),
      primaryCoreCardId: core.best.cardId,
      primaryCoreCardName: cardDisplayName(core.best.cardId, cardCatalog, core.best.rule),
      coreRule: core.best.rule,
      deckType: type.deckType,
      mainPlanType: type.mainPlanType,
      deckSizeReason: type.deckSizeReason,
      lowCostCount: type.lowCostCount,
      typeKnown: type.typeKnown,
      coreMargin: core.margin,
      hasStrategyData: core.hasStrategyData,
      strategyFrequency: core.best.strategyFrequency,
      axisCandidates: core.candidates.slice(0, 5).map((candidate) => candidateEvidence(candidate, cardCatalog)),
      primaryAxisOverrideReason: core.primaryAxisOverrideReason,
      coreCandidates: core.candidates,
      needsReview: core.needsReview || type.needsReview,
      coreSupport,
    });
  }

  const baseGroups = new Map();
  for (const item of initialItems) {
    const key = baseAxisKey(item);
    if (!baseGroups.has(key)) {
      baseGroups.set(key, []);
    }
    baseGroups.get(key).push(item);
  }

  const itemsWithSecondaryAxis = [];
  for (const items of baseGroups.values()) {
    itemsWithSecondaryAxis.push(...applySecondaryAxes(items, cardCatalog));
  }

  const groups = new Map();
  for (const item of itemsWithSecondaryAxis) {
    const key = categoryAxisKey(item);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }

  const categories = [];
  const factionCounts = {};

  for (const items of groups.values()) {
    const first = items[0];
    const partnerCardIds = selectAxisPartners(items, cardStats, cardCatalog);
    const partnerSupport = axisPartnerSupport(items, partnerCardIds);
    const categoryId = categoryHash(
      first.primaryFaction,
      first.primaryCoreCardId,
      first.secondaryAxisCardId,
      first.deckType,
    );
    const name = categoryName(
      first.primaryCoreCardId,
      first.secondaryAxisCardId,
      first.deckType,
      cardCatalog,
      first.coreRule,
    );
    const sampleCount = items.reduce((sum, item) => sum + item.deck.sampleCount, 0);
    const winCount = items.reduce((sum, item) => sum + item.deck.winCount, 0);
    const lossCount = items.reduce((sum, item) => sum + item.deck.lossCount, 0);
    const drawCount = items.reduce((sum, item) => sum + item.deck.drawCount, 0);
    const partnerCardNames = partnerCardIds.map((cardId) => cardLabel(cardId, cardCatalog));
    const category = {
      categoryId,
      categoryName: name,
      primaryFaction: first.primaryFaction,
      primaryCoreCardId: first.primaryCoreCardId,
      primaryCoreCardName: first.primaryCoreCardName,
      secondaryAxisCardId: first.secondaryAxisCardId,
      secondaryAxisCardName: first.secondaryAxisCardName,
      secondaryAxisReason: first.secondaryAxisReason,
      secondaryAxisSupport: first.secondaryAxisSupport,
      partnerCardIds,
      partnerCardNames,
      deckType: first.deckType,
      mainPlanType: first.mainPlanType,
      strategyFrequency: weightedStrategyFrequency(items),
      memberCount: items.length,
      sampleCount,
      winCount,
      lossCount,
      drawCount,
      winRate: sampleCount > 0 ? round4(winCount / sampleCount) : 0,
      coreSupport: first.coreSupport,
      partnerSupport,
      needsReviewCount: items.filter((item) => item.needsReview).length,
      representativeDeckId: items[0].deck.deckId,
      partnerCards: partnerCardIds.map((cardId) => ({
        cardId,
        name: cardLabel(cardId, cardCatalog),
        cost: cardCost(cardCatalog[cardId]),
      })),
    };
    categories.push(category);

    factionCounts[first.primaryFaction] = (factionCounts[first.primaryFaction] || 0) + items.length;

    for (const item of items) {
      results.push({
        deckId: item.deck.deckId,
        categoryId,
        categoryName: name,
        primaryFaction: item.primaryFaction,
        primaryCoreCardId: item.primaryCoreCardId,
        primaryCoreCardName: item.primaryCoreCardName,
        secondaryAxisCardId: item.secondaryAxisCardId,
        secondaryAxisCardName: item.secondaryAxisCardName,
        secondaryAxisReason: item.secondaryAxisReason,
        partnerCardIds,
        partnerCardNames,
        deckType: item.deckType,
        status: CLASSIFICATION_STATUS.CLASSIFIED,
        confidence: confidence(
          item.coreMargin,
          partnerSupport,
          item.hasStrategyData,
          item.typeKnown,
          item.needsReview,
        ),
        needsReview: item.needsReview,
        evidence: {
          sampleCount: item.deck.sampleCount,
          winRate: winRate(item.deck),
          strategyFrequency: item.strategyFrequency,
          axisCandidates: item.axisCandidates,
          primaryAxisOverrideReason: item.primaryAxisOverrideReason,
          secondaryAxisCandidates: item.secondaryAxisCandidates,
          secondaryAxisRejectedCandidates: item.secondaryAxisRejectedCandidates,
          secondaryAxisSupport: item.secondaryAxisSupport,
          deckCardCount: uniqueCards(item.deck.cards).length,
          mainPlanType: item.mainPlanType,
          coreSupport: item.coreSupport,
          partnerSupport,
          rankScope: item.deck.rankScope || null,
          deckSizeReason: item.deckSizeReason,
          lowCostCount: item.lowCostCount,
        },
        classifierVersion,
        classifiedAt: now,
        deckName: item.deck.deckName,
      });
    }
  }

  const unclassified = results.filter(
    (result) => result.status === CLASSIFICATION_STATUS.UNCLASSIFIED,
  ).length;
  const needsReviewCount = results.filter((result) => result.needsReview).length;

  return {
    classifierVersion,
    stats: {
      total: results.length,
      classified: results.length - unclassified,
      unclassified,
      categoryCount: categories.length,
      needsReviewCount,
      primaryFactionCounts: factionCounts,
    },
    categories: categories.sort(
      (left, right) => right.sampleCount - left.sampleCount || left.categoryId.localeCompare(right.categoryId),
    ),
    results: results.sort((left, right) => left.deckId.localeCompare(right.deckId)),
  };
}

module.exports = {
  DEFAULT_REVIEW_MARGIN,
  DEFAULT_STRATEGY_CLOSE_MARGIN,
  UNKNOWN_DECK_TYPE,
  cardLabel,
  classifyAnalysisDecks,
  dedupeDecks,
  loadAnalysisDeckCsv,
  loadCardCatalog,
  loadCoreRules,
  loadStrategyTypes,
  loadStrategyUsage,
  normalizeCoreRules,
  normalizeStrategyTypes,
  normalizeStrategyUsage,
  parseCsvObjects,
  unclassifiedDeck,
};
