"use strict";

const crypto = require("crypto");
const fs = require("fs");
const {
  CLASSIFICATION_STATUS,
  CURRENT_CLASSIFIER_VERSION,
  UNCLASSIFIED_CATEGORY_ID,
  UNCLASSIFIED_CATEGORY_NAME,
} = require("../../../packages/contracts/deck-classification");

const DEFAULT_REVIEW_MARGIN = 0.08;
const UNKNOWN_DECK_TYPE = "unknown";
const UNKNOWN_FACTION = "unknown";
const FACTION_PREFIXES = new Set(["玄", "緋", "碧", "蒼", "紫", "琥", "黄"]);

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

function loadCoreRules(filePath) {
  if (!filePath) {
    return [];
  }

  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const rules = Array.isArray(payload) ? payload : payload.rules || [];
  return normalizeCoreRules(rules);
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
    .filter((rule) => rule.cardId && rule.deckType);
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
  return String(card?.unitType || card?.unit_type || "").trim();
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

function scoreCoreCandidate(cardId, deck, cardCatalog, cardStats, rulesByCard) {
  const stat = cardStats.get(cardId) || { sampleCount: 0, highRankerSampleCount: 0 };
  const rule = rulesByCard.get(cardId);
  const usageScore = Math.log1p(stat.sampleCount) * 100;
  const stabilityScore = strongestPartnerRatio(cardId, deck, cardStats) * 50;
  const rankScore = Math.log1p(stat.highRankerSampleCount || 0) * 20;
  const costScore = cardCost(cardCatalog[cardId]) * 50;
  const ruleScore = rule ? rule.priority : 0;

  return {
    cardId,
    rule,
    score: usageScore + stabilityScore + rankScore + costScore + ruleScore,
    cost: cardCost(cardCatalog[cardId]),
  };
}

function selectCore(deck, cardCatalog, cardStats, rulesByCard, reviewMargin) {
  const candidates = uniqueCards(deck.cards)
    .map((cardId) => scoreCoreCandidate(cardId, deck, cardCatalog, cardStats, rulesByCard))
    .sort((left, right) => {
      const scoreCompare = right.score - left.score;
      if (scoreCompare) {
        return scoreCompare;
      }

      const priorityCompare = (right.rule?.priority || 0) - (left.rule?.priority || 0);
      if (priorityCompare) {
        return priorityCompare;
      }

      return right.cost - left.cost || left.cardId.localeCompare(right.cardId);
    });

  const best = candidates[0] || null;
  const second = candidates[1] || null;
  const margin = best && second && best.score > 0 ? (best.score - second.score) / best.score : 1;

  return {
    best,
    second,
    margin: round4(margin),
    needsReview: Boolean(best && second && margin <= reviewMargin),
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

function highestRuleForDeck(deck, rulesByCard) {
  return uniqueCards(deck.cards)
    .map((cardId) => rulesByCard.get(cardId))
    .filter(Boolean)
    .sort((left, right) => right.priority - left.priority || left.index - right.index)[0] || null;
}

function fallbackDeckType(deck, cardCatalog) {
  const cards = uniqueCards(deck.cards);
  if (cards.length >= 6) {
    return "多枚数";
  }

  const totalCost = cards.reduce((sum, cardId) => sum + cardCost(cardCatalog[cardId]), 0);
  const cavalryCards = cards.filter((cardId) => /騎兵|cavalry/i.test(cardUnitType(cardCatalog[cardId])));
  const cavalryCost = cavalryCards.reduce((sum, cardId) => sum + cardCost(cardCatalog[cardId]), 0);

  if (cavalryCards.length >= 3 || (totalCost > 0 && cavalryCost / totalCost >= 0.5)) {
    return "騎兵主体";
  }

  if (cards.length >= 4 && cards.length <= 5) {
    return "バランス";
  }

  return UNKNOWN_DECK_TYPE;
}

function selectDeckType(deck, core, rulesByCard, cardCatalog) {
  const rule = core?.best?.rule || highestRuleForDeck(deck, rulesByCard);
  if (rule) {
    return { deckType: rule.deckType, rule };
  }

  return { deckType: fallbackDeckType(deck, cardCatalog), rule: null };
}

function categoryHash(primaryFactionValue, primaryCoreCardId, deckType, partnerCardIds) {
  const raw = [
    primaryFactionValue,
    primaryCoreCardId,
    deckType,
    ...(partnerCardIds || []),
  ].join("|");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return `archetype-${hash.slice(0, 16)}`;
}

function axisKey(item) {
  return [item.primaryFaction, item.primaryCoreCardId, item.deckType].join("|");
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

function categoryName(primaryCoreCardId, partnerCardIds, deckType, cardCatalog, rule) {
  const names = [
    shortCardName(primaryCoreCardId, cardCatalog, rule),
    ...partnerCardIds.map((cardId) => shortCardName(cardId, cardCatalog)),
  ].filter(Boolean);
  const base = names.join(" / ") || "Unknown Deck";
  return deckType && deckType !== UNKNOWN_DECK_TYPE ? `${base} (${deckType})` : base;
}

function confidence(coreMargin, partnerSupport, hasRule, deckType) {
  const typePenalty = deckType === UNKNOWN_DECK_TYPE ? -0.15 : 0;
  const value = 0.45 + Math.min(coreMargin, 1) * 0.35 + partnerSupport * 0.15 + (hasRule ? 0.05 : 0) + typePenalty;
  return round4(Math.max(0, Math.min(1, value)));
}

function unclassifiedDeck(deck, options = {}) {
  return {
    deckId: deck.deckId,
    categoryId: UNCLASSIFIED_CATEGORY_ID,
    categoryName: UNCLASSIFIED_CATEGORY_NAME,
    primaryFaction: UNKNOWN_FACTION,
    primaryCoreCardId: "",
    primaryCoreCardName: "",
    partnerCardIds: [],
    deckType: UNKNOWN_DECK_TYPE,
    status: CLASSIFICATION_STATUS.UNCLASSIFIED,
    confidence: 0,
    needsReview: true,
    evidence: {
      sampleCount: deck.sampleCount || 0,
      winRate: winRate(deck),
      coreSupport: 0,
      partnerSupport: 0,
      rankScope: deck.rankScope || null,
    },
    classifierVersion: options.classifierVersion || CURRENT_CLASSIFIER_VERSION,
    classifiedAt: options.now || new Date().toISOString(),
  };
}

function classifyAnalysisDecks(decks, cardCatalog, options = {}) {
  const now = options.now || new Date().toISOString();
  const classifierVersion = options.classifierVersion || CURRENT_CLASSIFIER_VERSION;
  const reviewMargin = options.reviewMargin ?? DEFAULT_REVIEW_MARGIN;
  const coreRules = normalizeCoreRules(options.coreRules || []);
  const rulesByCard = coreRuleMap(coreRules);
  const normalizedDecks = dedupeDecks(decks);
  const { stats: cardStats, totalSampleCount } = buildCardStats(normalizedDecks);
  const initialItems = [];
  const results = [];

  for (const deck of normalizedDecks) {
    const core = selectCore(deck, cardCatalog, cardStats, rulesByCard, reviewMargin);
    if (!core.best) {
      results.push(unclassifiedDeck(deck, { now, classifierVersion }));
      continue;
    }

    const type = selectDeckType(deck, core, rulesByCard, cardCatalog);
    const coreStat = cardStats.get(core.best.cardId);
    const coreSupport = totalSampleCount > 0 ? round4((coreStat?.sampleCount || 0) / totalSampleCount) : 0;

    initialItems.push({
      deck,
      primaryFaction: primaryFaction(deck, cardCatalog),
      primaryCoreCardId: core.best.cardId,
      primaryCoreCardName: cardDisplayName(core.best.cardId, cardCatalog, core.best.rule),
      coreRule: core.best.rule,
      deckType: type.deckType,
      deckTypeRule: type.rule,
      coreMargin: core.margin,
      needsReview: core.needsReview || type.deckType === UNKNOWN_DECK_TYPE,
      coreSupport,
    });
  }

  const groups = new Map();
  for (const item of initialItems) {
    const key = axisKey(item);
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
      first.deckType,
      partnerCardIds,
    );
    const name = categoryName(
      first.primaryCoreCardId,
      partnerCardIds,
      first.deckType,
      cardCatalog,
      first.coreRule,
    );
    const sampleCount = items.reduce((sum, item) => sum + item.deck.sampleCount, 0);
    const winCount = items.reduce((sum, item) => sum + item.deck.winCount, 0);
    const lossCount = items.reduce((sum, item) => sum + item.deck.lossCount, 0);
    const drawCount = items.reduce((sum, item) => sum + item.deck.drawCount, 0);
    const category = {
      categoryId,
      categoryName: name,
      primaryFaction: first.primaryFaction,
      primaryCoreCardId: first.primaryCoreCardId,
      primaryCoreCardName: first.primaryCoreCardName,
      partnerCardIds,
      deckType: first.deckType,
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
        partnerCardIds,
        deckType: item.deckType,
        status: CLASSIFICATION_STATUS.CLASSIFIED,
        confidence: confidence(
          item.coreMargin,
          partnerSupport,
          Boolean(item.coreRule || item.deckTypeRule),
          item.deckType,
        ),
        needsReview: item.needsReview,
        evidence: {
          sampleCount: item.deck.sampleCount,
          winRate: winRate(item.deck),
          coreSupport: item.coreSupport,
          partnerSupport,
          rankScope: item.deck.rankScope || null,
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
  UNKNOWN_DECK_TYPE,
  cardLabel,
  classifyAnalysisDecks,
  dedupeDecks,
  loadAnalysisDeckCsv,
  loadCardCatalog,
  loadCoreRules,
  normalizeCoreRules,
  parseCsvObjects,
  unclassifiedDeck,
};
