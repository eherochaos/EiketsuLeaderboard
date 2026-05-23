"use strict";

const assert = require("assert");
const {
  classifyAnalysisDecks,
  parseCsvObjects,
} = require("./eiketsu-analysis-deck");

const NOW = "2026-05-23T00:00:00.000Z";

function testParseCsvObjects() {
  const rows = parseCsvObjects(
    [
      "deck,deck_fingerprint,sample_count,win_count,loss_count,draw_count",
      "\"Alpha, Beta\",\"card-a,card-b\",3,2,1,0",
    ].join("\n"),
  );

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].deck, "Alpha, Beta");
  assert.strictEqual(rows[0].deck_fingerprint, "card-a,card-b");
}

function cardCatalog() {
  return {
    "core-command": { name: "Core Command", cost: "3.0", unitType: "spear", card_code: "蒼001" },
    "core-balance": { name: "Core Balance", cost: "2.0", unitType: "spear", card_code: "緋001" },
    "core-damage": { name: "Core Damage", cost: "2.5", unitType: "gun", card_code: "碧001" },
    "core-formation": { name: "Core Formation", cost: "3.5", unitType: "spear", card_code: "玄001" },
    "tie-low": { name: "Tie Low", cost: "2.0", unitType: "bow", card_code: "紫001" },
    "tie-high": { name: "Tie High", cost: "3.5", unitType: "spear", card_code: "紫002" },
    "partner-a": { name: "Partner A", cost: "2.0", unitType: "gun", card_code: "蒼002" },
    "partner-b": { name: "Partner B", cost: "1.5", unitType: "bow", card_code: "蒼003" },
    "low-a": { name: "Low A", cost: "1.0", unitType: "spear", card_code: "蒼004" },
    "low-b": { name: "Low B", cost: "1.0", unitType: "spear", card_code: "蒼005" },
    "low-c": { name: "Low C", cost: "1.5", unitType: "bow", card_code: "蒼006" },
    "low-d": { name: "Low D", cost: "1.5", unitType: "bow", card_code: "蒼007" },
    "flex-a": { name: "Flex A", cost: "2.0", unitType: "gun", card_code: "緋002" },
    "flex-b": { name: "Flex B", cost: "1.5", unitType: "bow", card_code: "緋003" },
  };
}

function strategyTypes() {
  return [
    { cardId: "core-command", mainPlanType: "号令" },
    { cardId: "core-balance", mainPlanType: "単体強化" },
    { cardId: "core-damage", mainPlanType: "ダメージ" },
    { cardId: "core-formation", mainPlanType: "陣形" },
    { cardId: "tie-low", mainPlanType: "単体強化" },
    { cardId: "tie-high", mainPlanType: "号令" },
  ];
}

function usage(deckId, cardId, strategyFrequency, matchCount = 10) {
  return {
    deckId,
    cardId,
    matchCount,
    strategyCount: strategyFrequency * matchCount,
  };
}

function deck(deckId, cards, sampleCount = 10, winCount = 6) {
  return {
    deckId,
    deckName: cards.join(" / "),
    cards,
    sampleCount,
    winCount,
    lossCount: sampleCount - winCount,
    drawCount: 0,
    rankScope: null,
  };
}

function classify(decks, strategyUsage = []) {
  return classifyAnalysisDecks(decks, cardCatalog(), {
    now: NOW,
    strategyTypes: strategyTypes(),
    strategyUsage,
  });
}

function resultByDeck(output) {
  return Object.fromEntries(output.results.map((result) => [result.deckId, result]));
}

function testDuplicateFingerprintDoesNotDuplicateResults() {
  const output = classify(
    [
      deck("same-fingerprint", ["core-command", "partner-a", "low-a"], 4, 2),
      deck("same-fingerprint", ["core-command", "partner-a", "low-a"], 6, 4),
    ],
    [usage("same-fingerprint", "core-command", 1.5)],
  );

  assert.strictEqual(output.results.length, 1);
  assert.strictEqual(output.results[0].evidence.sampleCount, 10);
}

function testSevenCardsAreManyCardDeck() {
  const output = classify(
    [
      deck("many-7", [
        "core-command",
        "partner-a",
        "partner-b",
        "low-a",
        "low-b",
        "low-c",
        "flex-a",
      ]),
    ],
    [usage("many-7", "core-command", 2.0)],
  );

  const result = output.results[0];
  assert.strictEqual(result.deckType, "多枚数");
  assert.strictEqual(result.categoryName, "Core Command多枚数デッキ");
  assert.strictEqual(result.evidence.deckCardCount, 7);
}

function testSixLowCostCardsAreManyCardDeck() {
  const output = classify(
    [
      deck("many-6", [
        "core-command",
        "partner-a",
        "low-a",
        "low-b",
        "low-c",
        "low-d",
      ]),
    ],
    [usage("many-6", "core-command", 2.0)],
  );

  const result = output.results[0];
  assert.strictEqual(result.deckType, "多枚数");
  assert.strictEqual(result.evidence.deckSizeReason, "cardCount=6 lowCostCount>=4");
}

function testCommandAndFormationBecomeCommandDecks() {
  const output = classify(
    [
      deck("command", ["core-command", "partner-a", "low-a", "flex-a"]),
      deck("formation", ["core-formation", "partner-a", "low-a", "flex-a"]),
    ],
    [
      usage("command", "core-command", 1.8),
      usage("formation", "core-formation", 1.6),
    ],
  );

  const byDeck = resultByDeck(output);
  assert.strictEqual(byDeck.command.deckType, "号令");
  assert.strictEqual(byDeck.command.categoryName, "Core Command号令デッキ");
  assert.strictEqual(byDeck.command.evidence.mainPlanType, "号令");
  assert.strictEqual(byDeck.formation.deckType, "号令");
  assert.strictEqual(byDeck.formation.evidence.mainPlanType, "陣形");
}

function testSingleBuffAndDamageBecomeBalanceDecks() {
  const output = classify(
    [
      deck("single-buff", ["core-balance", "partner-a", "low-a", "flex-a"]),
      deck("damage", ["core-damage", "partner-a", "low-a", "flex-a"]),
    ],
    [
      usage("single-buff", "core-balance", 1.5),
      usage("damage", "core-damage", 1.4),
    ],
  );

  const byDeck = resultByDeck(output);
  assert.strictEqual(byDeck["single-buff"].deckType, "バランス");
  assert.strictEqual(byDeck["single-buff"].categoryName, "Core Balanceバランスデッキ");
  assert.strictEqual(byDeck.damage.deckType, "バランス");
  assert.strictEqual(byDeck.damage.evidence.mainPlanType, "ダメージ");
}

function testHigherStrategyFrequencyBeatsCost() {
  const output = classify(
    [deck("frequency", ["core-balance", "core-formation", "low-a", "flex-a"])],
    [
      usage("frequency", "core-balance", 1.7),
      usage("frequency", "core-formation", 0.8),
    ],
  );

  const result = output.results[0];
  assert.strictEqual(result.primaryCoreCardId, "core-balance");
  assert.strictEqual(result.evidence.strategyFrequency, 1.7);
}

function testCloseStrategyFrequencyUsesHigherCostAndNeedsReview() {
  const output = classify(
    [deck("close", ["tie-low", "tie-high", "low-a", "flex-a"])],
    [
      usage("close", "tie-low", 1.0),
      usage("close", "tie-high", 0.92),
    ],
  );

  const result = output.results[0];
  assert.strictEqual(result.primaryCoreCardId, "tie-high");
  assert.strictEqual(result.needsReview, true);
}

function testLowCostCommonCardDoesNotMergeDifferentAxes() {
  const output = classify(
    [
      deck("axis-a", ["core-command", "low-a", "partner-a", "flex-a"], 10, 7),
      deck("axis-b", ["core-balance", "low-a", "partner-b", "flex-b"], 8, 5),
    ],
    [
      usage("axis-a", "core-command", 1.7),
      usage("axis-b", "core-balance", 1.6),
    ],
  );

  const byDeck = resultByDeck(output);
  assert.notStrictEqual(byDeck["axis-a"].categoryId, byDeck["axis-b"].categoryId);
  assert.notStrictEqual(byDeck["axis-a"].primaryCoreCardId, "low-a");
  assert.notStrictEqual(byDeck["axis-b"].primaryCoreCardId, "low-a");
}

function testMissingStrategyDataFallsBackAndNeedsReview() {
  const output = classify(
    [deck("fallback", ["core-command", "partner-a", "low-a", "flex-a"])],
    [],
  );

  const result = output.results[0];
  assert.strictEqual(result.needsReview, true);
  assert.strictEqual(result.evidence.strategyFrequency, 0);
  assert.ok(result.evidence.axisCandidates.length > 0);
}

testParseCsvObjects();
testDuplicateFingerprintDoesNotDuplicateResults();
testSevenCardsAreManyCardDeck();
testSixLowCostCardsAreManyCardDeck();
testCommandAndFormationBecomeCommandDecks();
testSingleBuffAndDamageBecomeBalanceDecks();
testHigherStrategyFrequencyBeatsCost();
testCloseStrategyFrequencyUsesHigherCostAndNeedsReview();
testLowCostCommonCardDoesNotMergeDifferentAxes();
testMissingStrategyDataFallsBackAndNeedsReview();

console.log("eiketsu analysis deck tests passed");
