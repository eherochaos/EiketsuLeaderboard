"use strict";

const crypto = require("crypto");
const fs = require("fs");
const {
  CLASSIFICATION_STATUS,
  CURRENT_CLASSIFIER_VERSION,
  UNCLASSIFIED_CATEGORY_ID,
  UNCLASSIFIED_CATEGORY_NAME,
} = require("../../../packages/contracts/deck-classification");

const DEFAULT_SIMILAR_COST = 5.0;

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

function toNumber(value) {
  const number = Number(String(value || "").replace("%", ""));
  return Number.isFinite(number) ? number : 0;
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
      };
    });
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

function cardLabel(cardHash, cardCatalog) {
  const card = cardCatalog[cardHash];
  if (!card) {
    return `未识别卡(${cardHash.slice(0, 8)})`;
  }

  const name = card.name || card.rawName || card.card_code || cardHash;
  const cost = card.cost || card.cost_label || card.cost_value || "";
  const unitType = card.unitType || card.unit_type || "";
  const suffix = [cost, unitType].filter(Boolean).join(" ");
  return suffix ? `${name}(${suffix})` : name;
}

function deckCostMap(deck, cardCatalog) {
  const costs = {};

  for (const cardHash of deck.cards || []) {
    costs[cardHash] = cardCost(cardCatalog[cardHash]);
  }

  return costs;
}

function sharedCost(left, right) {
  let total = 0;

  for (const cardHash of Object.keys(left)) {
    if (Object.prototype.hasOwnProperty.call(right, cardHash)) {
      total += Math.max(left[cardHash], right[cardHash]);
    }
  }

  return total;
}

function totalCost(costMap) {
  return Object.values(costMap).reduce((sum, cost) => sum + cost, 0);
}

function categoryId(representativeDeckId) {
  const hash = crypto.createHash("sha256").update(representativeDeckId).digest("hex");
  return `archetype-${hash.slice(0, 16)}`;
}

function categoryName(coreCards, cardCatalog) {
  const names = coreCards
    .slice(0, 3)
    .map((cardHash) => cardLabel(cardHash, cardCatalog).split("(", 1)[0])
    .filter(Boolean);
  return names.join(" / ") || "未知卡组";
}

function coreCards(members, cardCatalog, targetCost) {
  const weightedCounts = new Map();
  const firstSeen = new Map();

  for (const member of members) {
    for (const cardHash of member.cards || []) {
      weightedCounts.set(cardHash, (weightedCounts.get(cardHash) || 0) + member.sampleCount);
      if (!firstSeen.has(cardHash)) {
        firstSeen.set(cardHash, firstSeen.size);
      }
    }
  }

  const sortedCards = Array.from(weightedCounts.keys()).sort((left, right) => {
    const countCompare = weightedCounts.get(right) - weightedCounts.get(left);
    if (countCompare) {
      return countCompare;
    }

    const costCompare = cardCost(cardCatalog[right]) - cardCost(cardCatalog[left]);
    return costCompare || firstSeen.get(left) - firstSeen.get(right);
  });

  const result = [];
  let cost = 0;

  for (const cardHash of sortedCards) {
    result.push(cardHash);
    cost += cardCost(cardCatalog[cardHash]);
    if (cost >= targetCost || result.length >= 5) {
      break;
    }
  }

  return result;
}

function aggregateMembers(members) {
  return members.reduce(
    (summary, member) => ({
      sampleCount: summary.sampleCount + member.sampleCount,
      winCount: summary.winCount + member.winCount,
      lossCount: summary.lossCount + member.lossCount,
      drawCount: summary.drawCount + member.drawCount,
    }),
    { sampleCount: 0, winCount: 0, lossCount: 0, drawCount: 0 },
  );
}

function classifyAnalysisDecks(decks, cardCatalog, options = {}) {
  const similarCost = options.similarCost || DEFAULT_SIMILAR_COST;
  const now = options.now || new Date().toISOString();
  const classifierVersion = options.classifierVersion || CURRENT_CLASSIFIER_VERSION;
  const representatives = [];
  const clusters = [];
  const costMaps = new Map();

  for (const deck of decks || []) {
    costMaps.set(deck.deckId, deckCostMap(deck, cardCatalog));
    let targetIndex = -1;

    for (let index = 0; index < representatives.length; index += 1) {
      const representative = representatives[index];
      const score = sharedCost(costMaps.get(deck.deckId), costMaps.get(representative.deckId));
      if (score >= similarCost) {
        targetIndex = index;
        break;
      }
    }

    if (targetIndex === -1) {
      representatives.push(deck);
      clusters.push([deck]);
    } else {
      clusters[targetIndex].push(deck);
    }
  }

  const categories = clusters.map((members) => {
    const representative = members[0];
    const core = coreCards(members, cardCatalog, similarCost);
    const summary = aggregateMembers(members);
    return {
      categoryId: categoryId(representative.deckId),
      categoryName: categoryName(core, cardCatalog),
      representativeDeckId: representative.deckId,
      memberCount: members.length,
      sampleCount: summary.sampleCount,
      winCount: summary.winCount,
      lossCount: summary.lossCount,
      drawCount: summary.drawCount,
      coreCards: core.map((cardHash) => ({
        cardId: cardHash,
        name: cardLabel(cardHash, cardCatalog),
        cost: cardCost(cardCatalog[cardHash]),
      })),
      members,
    };
  });

  const results = [];

  for (const category of categories) {
    const representativeCostMap = costMaps.get(category.representativeDeckId);
    const representativeCost = totalCost(representativeCostMap);

    for (const member of category.members) {
      const memberCostMap = costMaps.get(member.deckId);
      const overlapCost = sharedCost(memberCostMap, representativeCostMap);
      const confidenceBase = Math.min(totalCost(memberCostMap), representativeCost) || similarCost;
      const confidence = Number(Math.min(1, overlapCost / confidenceBase).toFixed(4));

      results.push({
        deckId: member.deckId,
        categoryId: category.categoryId,
        categoryName: category.categoryName,
        status: CLASSIFICATION_STATUS.CLASSIFIED,
        confidence,
        classifierVersion,
        classifiedAt: now,
        deckName: member.deckName,
        sampleCount: member.sampleCount,
      });
    }

    delete category.members;
  }

  const unclassified = results.filter(
    (result) => result.categoryId === UNCLASSIFIED_CATEGORY_ID,
  ).length;

  return {
    classifierVersion,
    stats: {
      total: results.length,
      classified: results.length - unclassified,
      unclassified,
      categoryCount: categories.length,
    },
    categories: categories.sort((left, right) => right.sampleCount - left.sampleCount),
    results: results.sort((left, right) => left.deckId.localeCompare(right.deckId)),
  };
}

function unclassifiedDeck(deck, options = {}) {
  return {
    deckId: deck.deckId,
    categoryId: UNCLASSIFIED_CATEGORY_ID,
    categoryName: UNCLASSIFIED_CATEGORY_NAME,
    status: CLASSIFICATION_STATUS.UNCLASSIFIED,
    confidence: 0,
    classifierVersion: options.classifierVersion || CURRENT_CLASSIFIER_VERSION,
    classifiedAt: options.now || new Date().toISOString(),
  };
}

module.exports = {
  DEFAULT_SIMILAR_COST,
  cardLabel,
  classifyAnalysisDecks,
  loadAnalysisDeckCsv,
  loadCardCatalog,
  parseCsvObjects,
  sharedCost,
  unclassifiedDeck,
};
