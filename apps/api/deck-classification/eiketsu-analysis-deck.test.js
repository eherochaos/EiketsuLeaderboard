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
    "second-balance": { name: "Second Balance", cost: "2.5", unitType: "gun", card_code: "蒼008" },
    "second-alt": { name: "Second Alt", cost: "2.5", unitType: "spear", card_code: "蒼009" },
    "second-freq": { name: "Second Freq", cost: "2.0", unitType: "bow", card_code: "蒼010" },
    "second-gray": { name: "Second Gray", cost: "2.5", unitType: "gun", card_code: "蒼011" },
    "second-command": { name: "Second Command", cost: "2.5", unitType: "spear", card_code: "蒼013" },
    "low-common": { name: "Low Common", cost: "1.0", unitType: "spear", card_code: "蒼012" },
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
    { cardId: "second-balance", mainPlanType: "単体強化" },
    { cardId: "second-alt", mainPlanType: "単体強化" },
    { cardId: "second-freq", mainPlanType: "単体強化" },
    { cardId: "second-gray", mainPlanType: "特殊" },
    { cardId: "second-command", mainPlanType: "号令" },
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
      deck("same-fingerprint", ["core-command", "second-command", "low-a"], 4, 2),
      deck("same-fingerprint", ["core-command", "second-command", "low-a"], 6, 4),
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
        "second-command",
        "low-a",
        "low-b",
        "low-c",
        "flex-a",
        "flex-b",
      ]),
    ],
    [usage("many-7", "core-command", 2.0)],
  );

  const result = output.results[0];
  assert.strictEqual(result.deckType, "多枚数");
  assert.strictEqual(result.categoryName.endsWith("多枚数デッキ"), true);
  assert.strictEqual(result.evidence.deckCardCount, 7);
}

function testSixLowCostCardsAreManyCardDeck() {
  const output = classify(
    [
      deck("many-6", [
        "core-command",
        "second-command",
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
      deck("command", ["core-command", "second-command", "low-a", "flex-a"]),
      deck("formation", ["core-formation", "second-command", "low-a", "flex-a"]),
    ],
    [
      usage("command", "core-command", 1.8),
      usage("formation", "core-formation", 1.6),
    ],
  );

  const byDeck = resultByDeck(output);
  assert.strictEqual(byDeck.command.deckType, "号令");
  assert.strictEqual(byDeck.command.categoryName.startsWith("Core Command"), true);
  assert.strictEqual(byDeck.command.categoryName.endsWith("号令デッキ"), true);
  assert.strictEqual(byDeck.command.evidence.mainPlanType, "号令");
  assert.strictEqual(byDeck.formation.deckType, "号令");
  assert.strictEqual(byDeck.formation.evidence.mainPlanType, "陣形");
}

function testSingleBuffAndDamageBecomeBalanceDecks() {
  const output = classify(
    [
      deck("single-buff", ["core-balance", "second-balance", "low-a", "flex-a"]),
      deck("damage", ["core-damage", "second-balance", "low-a", "flex-a"]),
    ],
    [
      usage("single-buff", "core-balance", 1.5),
      usage("damage", "core-damage", 1.4),
    ],
  );

  const byDeck = resultByDeck(output);
  assert.strictEqual(byDeck["single-buff"].deckType, "バランス");
  assert.strictEqual(byDeck["single-buff"].categoryName.startsWith("Core Balance"), true);
  assert.strictEqual(byDeck["single-buff"].categoryName.endsWith("バランスデッキ"), true);
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

function testBalanceDeckRejectsLowFrequencyCommandSecondaryAxis() {
  const output = classify(
    [deck("low-command", ["core-balance", "core-formation", "low-a", "flex-a"])],
    [
      usage("low-command", "core-balance", 2.0),
      usage("low-command", "core-formation", 1.0),
    ],
  );

  const result = output.results[0];
  assert.strictEqual(result.primaryCoreCardId, "core-balance");
  assert.strictEqual(result.deckType, "バランス");
  assert.strictEqual(result.secondaryAxisCardId, "");
  assert.strictEqual(result.evidence.primaryAxisOverrideReason, "");
  assert.strictEqual(result.evidence.secondaryAxisRejectedCandidates[0].cardId, "core-formation");
  assert.strictEqual(result.evidence.secondaryAxisRejectedCandidates[0].rejectionReason, "typeConflict");
  assert.strictEqual(result.needsReview, true);
}

function testBalanceDeckPromotesHighFrequencyCommandToPrimaryAxis() {
  const output = classify(
    [deck("high-command", ["core-balance", "core-formation", "low-a", "flex-a"])],
    [
      usage("high-command", "core-balance", 1.5),
      usage("high-command", "core-formation", 1.1),
    ],
  );

  const result = output.results[0];
  assert.strictEqual(result.primaryCoreCardId, "core-formation");
  assert.strictEqual(result.deckType, "号令");
  assert.strictEqual(result.evidence.primaryAxisOverrideReason, "commandFrequency>=70%balancePrimary");
}

function testCompatibleHighCostPartnerBecomesSecondaryAxis() {
  const output = classify(
    [deck("secondary", ["core-balance", "second-balance", "low-a", "low-b"])],
    [usage("secondary", "core-balance", 1.5)],
  );

  const result = output.results[0];
  assert.strictEqual(result.secondaryAxisCardId, "second-balance");
  assert.strictEqual(result.secondaryAxisCardName, "Second Balance(2.5 gun)");
  assert.strictEqual(result.secondaryAxisReason, "support>=0.35");
  assert.strictEqual(result.categoryName, "Core BalanceやSecond Balanceバランスデッキ");
  assert.strictEqual(result.evidence.secondaryAxisSupport, 1);
}

function testCommandDeckRejectsBalanceSecondaryAxis() {
  const output = classify(
    [deck("reject-balance", ["core-command", "second-balance", "low-a", "low-b"])],
    [usage("reject-balance", "core-command", 1.5)],
  );

  const result = output.results[0];
  assert.strictEqual(result.secondaryAxisCardId, "");
  assert.strictEqual(result.categoryName, "Core Command号令デッキ");
  assert.strictEqual(result.evidence.secondaryAxisRejectedCandidates[0].cardId, "second-balance");
  assert.strictEqual(result.evidence.secondaryAxisRejectedCandidates[0].rejectionReason, "typeConflict");
}

function testSamePrimaryDifferentSecondAxesSplitCategories() {
  const output = classify(
    [
      deck("split-a", ["core-balance", "second-balance", "low-common", "low-a"], 10, 7),
      deck("split-b", ["core-balance", "second-alt", "low-common", "low-b"], 10, 6),
    ],
    [
      usage("split-a", "core-balance", 1.5),
      usage("split-b", "core-balance", 1.5),
    ],
  );

  const byDeck = resultByDeck(output);
  assert.strictEqual(output.stats.categoryCount, 2);
  assert.notStrictEqual(byDeck["split-a"].categoryId, byDeck["split-b"].categoryId);
  assert.strictEqual(byDeck["split-a"].secondaryAxisCardId, "second-balance");
  assert.strictEqual(byDeck["split-b"].secondaryAxisCardId, "second-alt");
}

function testLowCostCommonCardCannotBecomeSecondaryAxis() {
  const output = classify(
    [
      deck("common-a", ["core-command", "low-common", "low-a", "low-b"], 10, 7),
      deck("common-b", ["core-command", "low-common", "low-c", "low-d"], 10, 6),
    ],
    [
      usage("common-a", "core-command", 1.5),
      usage("common-b", "core-command", 1.5),
    ],
  );

  const byDeck = resultByDeck(output);
  assert.strictEqual(output.stats.categoryCount, 1);
  assert.strictEqual(byDeck["common-a"].secondaryAxisCardId, "");
  assert.strictEqual(byDeck["common-a"].categoryName, "Core Command号令デッキ");
}

function testSecondCardStrategyFrequencyCanBecomeSecondaryAxis() {
  const output = classify(
    [
      deck("freq-small", ["core-balance", "second-freq", "low-a", "low-b"], 3, 2),
      deck("freq-large", ["core-balance", "low-common", "low-c", "low-d"], 10, 6),
    ],
    [
      usage("freq-small", "core-balance", 1.5, 3),
      usage("freq-small", "second-freq", 0.9, 3),
      usage("freq-large", "core-balance", 1.5, 10),
    ],
  );

  const byDeck = resultByDeck(output);
  assert.strictEqual(byDeck["freq-small"].secondaryAxisCardId, "second-freq");
  assert.strictEqual(byDeck["freq-small"].secondaryAxisReason, "strategyFrequency>=55%primary");
  assert.strictEqual(byDeck["freq-large"].secondaryAxisCardId, "");
}

function testSecondaryAxisSupportGrayZoneNeedsReview() {
  const output = classify(
    [
      deck("gray-small", ["core-balance", "second-gray", "low-a", "low-b"], 32, 20),
      deck("gray-large", ["core-balance", "low-common", "low-c", "low-d"], 68, 40),
    ],
    [
      usage("gray-small", "core-balance", 1.5, 32),
      usage("gray-small", "second-gray", 0.9, 32),
      usage("gray-large", "core-balance", 1.5, 68),
    ],
  );

  const result = resultByDeck(output)["gray-small"];
  assert.strictEqual(result.secondaryAxisCardId, "second-gray");
  assert.strictEqual(result.evidence.secondaryAxisSupport, 0.32);
  assert.strictEqual(result.needsReview, true);
}

function testUnknownPlanTypeCannotBecomeSecondaryAxis() {
  const output = classify(
    [deck("unknown-second", ["core-balance", "flex-a", "low-a", "low-b"])],
    [usage("unknown-second", "core-balance", 1.5)],
  );

  const result = output.results[0];
  assert.strictEqual(result.secondaryAxisCardId, "");
  assert.strictEqual(result.evidence.secondaryAxisRejectedCandidates[0].cardId, "flex-a");
  assert.strictEqual(result.evidence.secondaryAxisRejectedCandidates[0].rejectionReason, "unknownPlanType");
}

function testLowCostCommonCardDoesNotMergeDifferentAxes() {
  const output = classify(
    [
      deck("axis-a", ["core-command", "low-a", "second-command", "flex-a"], 10, 7),
      deck("axis-b", ["core-balance", "low-a", "second-balance", "flex-b"], 8, 5),
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
    [deck("fallback", ["core-command", "second-command", "low-a", "flex-a"])],
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
testBalanceDeckRejectsLowFrequencyCommandSecondaryAxis();
testBalanceDeckPromotesHighFrequencyCommandToPrimaryAxis();
testCompatibleHighCostPartnerBecomesSecondaryAxis();
testCommandDeckRejectsBalanceSecondaryAxis();
testSamePrimaryDifferentSecondAxesSplitCategories();
testLowCostCommonCardCannotBecomeSecondaryAxis();
testSecondCardStrategyFrequencyCanBecomeSecondaryAxis();
testSecondaryAxisSupportGrayZoneNeedsReview();
testUnknownPlanTypeCannotBecomeSecondaryAxis();
testLowCostCommonCardDoesNotMergeDifferentAxes();
testMissingStrategyDataFallsBackAndNeedsReview();

console.log("eiketsu analysis deck tests passed");
