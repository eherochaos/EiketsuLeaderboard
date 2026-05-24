"use strict";

const {
  CLASSIFICATION_STATUS,
  CURRENT_CLASSIFIER_VERSION,
  UNCLASSIFIED_CATEGORY_ID,
  UNCLASSIFIED_CATEGORY_NAME,
} = require("../../../packages/contracts/deck-classification");

function normalizeCardId(card) {
  if (typeof card === "string") {
    return card.trim().toLowerCase();
  }

  if (card && typeof card === "object") {
    const value = card.id || card.cardId || card.name;
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  return "";
}

function normalizeCards(cards) {
  return Array.from(new Set((cards || []).map(normalizeCardId).filter(Boolean))).sort();
}

function normalizeRuleCards(rule) {
  return normalizeCards(rule.signatureCards || rule.cards || []);
}

function classifyDeck(deck, rules, options = {}) {
  const now = options.now || new Date().toISOString();
  const classifierVersion = options.classifierVersion || CURRENT_CLASSIFIER_VERSION;
  const minConfidence = options.minConfidence || 0.6;
  const deckCards = new Set(normalizeCards(deck.cards));
  let bestMatch = null;

  for (const rule of rules || []) {
    const ruleCards = normalizeRuleCards(rule);
    if (ruleCards.length === 0) {
      continue;
    }

    const matchedCount = ruleCards.filter((cardId) => deckCards.has(cardId)).length;
    const confidence = Number((matchedCount / ruleCards.length).toFixed(4));
    const threshold = rule.threshold || minConfidence;

    if (confidence < threshold) {
      continue;
    }

    if (!bestMatch || confidence > bestMatch.confidence) {
      bestMatch = {
        categoryId: rule.categoryId,
        categoryName: rule.categoryName,
        confidence,
        ruleCards,
      };
    }
  }

  if (!bestMatch) {
    return {
      deckId: deck.deckId,
      categoryId: UNCLASSIFIED_CATEGORY_ID,
      categoryName: UNCLASSIFIED_CATEGORY_NAME,
      primaryFaction: "unknown",
      primaryCoreCardId: "",
      primaryCoreCardName: "",
      secondaryAxisCardId: "",
      secondaryAxisCardName: "",
      secondaryAxisReason: "",
      partnerCardIds: [],
      partnerCardNames: [],
      deckType: "unknown",
      status: CLASSIFICATION_STATUS.UNCLASSIFIED,
      confidence: 0,
      needsReview: true,
      evidence: {
        sampleCount: 0,
        winRate: 0,
        strategyFrequency: 0,
        axisCandidates: [],
        primaryAxisOverrideReason: "",
        secondaryAxisCandidates: [],
        secondaryAxisRejectedCandidates: [],
        secondaryAxisSupport: 0,
        deckCardCount: normalizeCards(deck.cards).length,
        mainPlanType: "unknown",
        coreSupport: 0,
        partnerSupport: 0,
        rankScope: null,
      },
      classifierVersion,
      classifiedAt: now,
    };
  }

  return {
    deckId: deck.deckId,
    categoryId: bestMatch.categoryId,
    categoryName: bestMatch.categoryName,
    primaryFaction: "unknown",
    primaryCoreCardId: bestMatch.ruleCards[0] || "",
    primaryCoreCardName: bestMatch.ruleCards[0] || "",
    secondaryAxisCardId: "",
    secondaryAxisCardName: "",
    secondaryAxisReason: "",
    partnerCardIds: bestMatch.ruleCards.slice(1, 3),
    partnerCardNames: bestMatch.ruleCards.slice(1, 3),
    deckType: "unknown",
    status: CLASSIFICATION_STATUS.CLASSIFIED,
    confidence: bestMatch.confidence,
    needsReview: false,
    evidence: {
      sampleCount: 0,
      winRate: 0,
      strategyFrequency: 0,
      axisCandidates: [],
      primaryAxisOverrideReason: "",
      secondaryAxisCandidates: [],
      secondaryAxisRejectedCandidates: [],
      secondaryAxisSupport: 0,
      deckCardCount: normalizeCards(deck.cards).length,
      mainPlanType: "unknown",
      coreSupport: bestMatch.confidence,
      partnerSupport: 0,
      rankScope: null,
    },
    classifierVersion,
    classifiedAt: now,
  };
}

function classifyDecks(decks, rules, options = {}) {
  return (decks || []).map((deck) => classifyDeck(deck, rules, options));
}

function mergeClassificationResults(existingResults, nextResults) {
  const merged = new Map();

  for (const result of existingResults || []) {
    merged.set(`${result.deckId}:${result.classifierVersion}`, result);
  }

  for (const result of nextResults || []) {
    merged.set(`${result.deckId}:${result.classifierVersion}`, result);
  }

  return Array.from(merged.values()).sort((a, b) => {
    const deckCompare = a.deckId.localeCompare(b.deckId);
    return deckCompare || a.classifierVersion.localeCompare(b.classifierVersion);
  });
}

function summarizeResults(results) {
  const classified = (results || []).filter(
    (result) => result.status === CLASSIFICATION_STATUS.CLASSIFIED,
  ).length;
  const total = (results || []).length;

  return {
    total,
    classified,
    unclassified: total - classified,
  };
}

module.exports = {
  classifyDeck,
  classifyDecks,
  mergeClassificationResults,
  normalizeCards,
  summarizeResults,
};
