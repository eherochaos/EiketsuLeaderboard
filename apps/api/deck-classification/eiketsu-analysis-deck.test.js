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
    "core-low-balance": { name: "Core Low Balance", cost: "1.0", unitType: "bow", card_code: "緋004" },
    "core-damage": { name: "Core Damage", cost: "2.5", unitType: "gun", card_code: "碧001" },
    "core-base": { name: "Core Base", cost: "2.5", unitType: "bow", card_code: "碧002" },
    "core-formation": { name: "Core Formation", cost: "3.5", unitType: "spear", card_code: "玄001" },
    "tie-low": { name: "Tie Low", cost: "2.0", unitType: "bow", card_code: "紫001" },
    "tie-high": { name: "Tie High", cost: "3.5", unitType: "spear", card_code: "紫002" },
    "second-balance": { name: "Second Balance", cost: "2.5", unitType: "gun", card_code: "蒼008" },
    "second-alt": { name: "Second Alt", cost: "2.5", unitType: "spear", card_code: "蒼009" },
    "second-freq": { name: "Second Freq", cost: "2.0", unitType: "bow", card_code: "蒼010" },
    "second-gray": { name: "Second Gray", cost: "2.5", unitType: "gun", card_code: "蒼011" },
    "second-command": { name: "Second Command", cost: "2.5", unitType: "spear", card_code: "蒼013" },
    "support-all": { name: "Support All", cost: "2.0", unitType: "spear", card_code: "蒼014" },
    "big-balance": { name: "Big Balance", cost: "4.0", unitType: "spear", card_code: "蒼015" },
    "red-command": { name: "Red Command", cost: "4.0", unitType: "spear", card_code: "緋010" },
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
    { cardId: "core-low-balance", mainPlanType: "単体強化" },
    { cardId: "core-damage", mainPlanType: "ダメージ" },
    { cardId: "core-base", mainPlanType: "拠点" },
    { cardId: "core-formation", mainPlanType: "陣形" },
    { cardId: "tie-low", mainPlanType: "単体強化" },
    { cardId: "tie-high", mainPlanType: "号令" },
    { cardId: "second-balance", mainPlanType: "単体強化" },
    { cardId: "second-alt", mainPlanType: "単体強化" },
    { cardId: "second-freq", mainPlanType: "単体強化" },
    { cardId: "second-gray", mainPlanType: "特殊" },
    { cardId: "second-command", mainPlanType: "号令" },
    { cardId: "red-command", mainPlanType: "号令" },
    {
      cardId: "support-all",
      categories: ["全体強化"],
      strategyText: "味方の武力が上がる。",
    },
    { cardId: "big-balance", mainPlanType: "ダメージ" },
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

function classify(decks, strategyUsage = [], options = {}) {
  return classifyAnalysisDecks(decks, cardCatalog(), {
    now: options.now || NOW,
    strategyTypes: strategyTypes(),
    strategyUsage,
    ...(Object.prototype.hasOwnProperty.call(options, "categoryRegistry")
      ? { categoryRegistry: options.categoryRegistry }
      : {}),
  });
}

function resultByDeck(output) {
  return Object.fromEntries(output.results.map((result) => [result.deckId, result]));
}

function registryById(output) {
  return Object.fromEntries(
    (output.categoryRegistry?.categories || []).map((category) => [category.categoryId, category]),
  );
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
        "low-a",
        "low-b",
        "low-c",
        "low-d",
        "flex-a",
        "flex-b",
        "low-common",
      ]),
    ],
  );

  const result = output.results[0];
  assert.strictEqual(result.deckType, "多枚数");
  assert.strictEqual(result.categoryName.endsWith("多枚数デッキ"), true);
  assert.strictEqual(result.secondaryAxisCardId, "");
  assert.strictEqual(result.categoryName.includes("や"), false);
  assert.strictEqual(result.evidence.deckCardCount, 7);
}

function testSixLowCostCardsAreManyCardDeck() {
  const output = classify(
    [
      deck("many-6", [
        "low-a",
        "low-b",
        "low-c",
        "low-d",
        "flex-a",
        "flex-b",
      ]),
    ],
  );

  const result = output.results[0];
  assert.strictEqual(result.deckType, "多枚数");
  assert.strictEqual(result.evidence.deckSizeReason, "cardCount=6 lowCostCount>=4");
}

function testKnownPlanTypeOverridesManyCardSize() {
  const output = classify(
    [
      deck("many-command", ["core-command", "low-a", "low-b", "low-c", "low-d", "flex-b"]),
      deck("many-balance", ["core-balance", "low-a", "low-b", "low-c", "low-d", "flex-b"]),
      deck("many-base", ["core-base", "low-a", "low-b", "low-c", "low-d", "flex-b"]),
    ],
    [
      usage("many-command", "core-command", 2.0),
      usage("many-balance", "core-balance", 2.0),
      usage("many-base", "core-base", 2.0),
    ],
  );

  const byDeck = resultByDeck(output);
  assert.strictEqual(byDeck["many-command"].deckType, "号令");
  assert.strictEqual(byDeck["many-command"].categoryName.endsWith("号令デッキ"), true);
  assert.strictEqual(byDeck["many-balance"].deckType, "バランス");
  assert.strictEqual(byDeck["many-balance"].categoryName.endsWith("バランスデッキ"), true);
  assert.strictEqual(byDeck["many-base"].deckType, "バランス");
  assert.strictEqual(byDeck["many-base"].categoryName.endsWith("バランスデッキ"), true);
}

function testThreeCardsAreKenyaDeck() {
  const output = classify(
    [deck("kenya", ["core-command", "second-command", "low-a"])],
    [usage("kenya", "core-command", 2.0)],
  );

  const result = output.results[0];
  assert.strictEqual(result.deckType, "ケニア");
  assert.strictEqual(result.categoryName.endsWith("ケニアデッキ"), true);
  assert.strictEqual(result.secondaryAxisCardId, "");
  assert.strictEqual(result.evidence.deckSizeReason, "cardCount=3");
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
    [
      usage("secondary", "core-balance", 1.5),
      usage("secondary", "second-balance", 0.6),
    ],
  );

  const result = output.results[0];
  assert.strictEqual(result.secondaryAxisCardId, "second-balance");
  assert.strictEqual(result.secondaryAxisCardName, "Second Balance(2.5 gun)");
  assert.strictEqual(result.secondaryAxisReason, "support>0.8&strategyFrequency>0.5");
  assert.strictEqual(result.categoryName, "Core BalanceやSecond Balanceバランスデッキ");
  assert.strictEqual(result.evidence.secondaryAxisSupport, 1);
}

function testCommandDeckRejectsBalanceSecondaryAxis() {
  const output = classify(
    [deck("reject-balance", ["core-command", "second-balance", "low-a", "low-b"])],
    [
      usage("reject-balance", "core-command", 1.5),
      usage("reject-balance", "second-balance", 0.9),
    ],
  );

  const result = output.results[0];
  assert.strictEqual(result.secondaryAxisCardId, "");
  assert.strictEqual(result.categoryName, "Core Command号令デッキ");
  assert.strictEqual(result.evidence.secondaryAxisRejectedCandidates[0].cardId, "second-balance");
  assert.strictEqual(result.evidence.secondaryAxisRejectedCandidates[0].rejectionReason, "typeConflict");
}

function testCommandDeckRejectsAllBuffSecondaryAxis() {
  const output = classify(
    [deck("reject-all-buff", ["core-command", "support-all", "low-a", "low-b"])],
    [
      usage("reject-all-buff", "core-command", 1.5),
      usage("reject-all-buff", "support-all", 0.9),
    ],
  );

  const result = output.results[0];
  assert.strictEqual(result.secondaryAxisCardId, "");
  assert.strictEqual(result.categoryName, "Core Command号令デッキ");
  assert.strictEqual(result.evidence.secondaryAxisRejectedCandidates[0].cardId, "support-all");
  assert.strictEqual(result.evidence.secondaryAxisRejectedCandidates[0].rejectionReason, "typeConflict");
}

function testBalanceNamePutsLargeSecondaryAxisFirst() {
  const output = classify(
    [deck("large-second", ["core-low-balance", "big-balance", "low-a", "low-b"])],
    [
      usage("large-second", "core-low-balance", 1.5),
      usage("large-second", "big-balance", 0.9),
    ],
  );

  const result = output.results[0];
  assert.strictEqual(result.primaryCoreCardId, "core-low-balance");
  assert.strictEqual(result.secondaryAxisCardId, "big-balance");
  assert.strictEqual(result.categoryName, "Big BalanceやCore Low Balanceバランスデッキ");
}

function testSamePrimaryDifferentSecondAxesDoNotSplitAtHalfSupport() {
  const output = classify(
    [
      deck("split-a", ["core-balance", "second-balance", "low-common", "low-a"], 10, 7),
      deck("split-b", ["core-balance", "second-alt", "low-common", "low-b"], 10, 6),
    ],
    [
      usage("split-a", "core-balance", 1.5),
      usage("split-a", "second-balance", 0.9),
      usage("split-b", "core-balance", 1.5),
      usage("split-b", "second-alt", 0.9),
    ],
  );

  const byDeck = resultByDeck(output);
  assert.strictEqual(output.stats.categoryCount, 1);
  assert.strictEqual(byDeck["split-a"].categoryId, byDeck["split-b"].categoryId);
  assert.strictEqual(byDeck["split-a"].secondaryAxisCardId, "");
  assert.strictEqual(byDeck["split-b"].secondaryAxisCardId, "");
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

function testModerateSupportHighFrequencyBecomesSecondaryAxis() {
  const output = classify(
    [
      deck("moderate-small", ["core-balance", "second-freq", "low-a", "low-b"], 6, 4),
      deck("moderate-large", ["core-balance", "low-common", "low-c", "low-d"], 4, 2),
    ],
    [
      usage("moderate-small", "core-balance", 1.5, 6),
      usage("moderate-small", "second-freq", 0.9, 6),
      usage("moderate-large", "core-balance", 1.5, 4),
    ],
  );

  const byDeck = resultByDeck(output);
  assert.strictEqual(byDeck["moderate-small"].secondaryAxisCardId, "second-freq");
  assert.strictEqual(byDeck["moderate-small"].secondaryAxisReason, "support>0.5&strategyFrequency>0.8");
  assert.strictEqual(byDeck["moderate-large"].secondaryAxisCardId, "");
}

function testLowSupportHighFrequencyCannotBecomeSecondaryAxis() {
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
  assert.strictEqual(byDeck["freq-small"].secondaryAxisCardId, "");
  assert.strictEqual(byDeck["freq-large"].secondaryAxisCardId, "");
}

function testSecondaryAxisBelowThresholdDoesNotNeedReview() {
  const output = classify(
    [
      deck("gray-small", ["core-balance", "second-gray", "low-a", "low-b"], 32, 20),
      deck("gray-large", ["core-balance", "low-common", "low-c", "low-d"], 68, 40),
    ],
    [
      usage("gray-small", "core-balance", 1.5, 32),
      usage("gray-small", "second-gray", 0.7, 32),
      usage("gray-large", "core-balance", 1.5, 68),
    ],
  );

  const result = resultByDeck(output)["gray-small"];
  assert.strictEqual(result.secondaryAxisCardId, "");
  assert.strictEqual(result.evidence.secondaryAxisCandidates[0].support, 0.32);
  assert.strictEqual(result.needsReview, false);
}

function testUnknownPlanTypeCannotBecomeSecondaryAxis() {
  const output = classify(
    [deck("unknown-second", ["core-balance", "flex-a", "low-a", "low-b"])],
    [
      usage("unknown-second", "core-balance", 1.5),
      usage("unknown-second", "flex-a", 0.9),
    ],
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

function testCoexistingCommandPrimaryAxisUsesLargerPrimaryGroup() {
  const output = classify(
    [
      deck("coexist-major", ["core-command", "low-a", "low-b", "low-c"], 40, 24),
      deck("coexist-minor", ["second-command", "low-a", "low-b", "low-d"], 10, 6),
      deck("coexist-bridge", ["core-command", "second-command", "low-a", "low-b"], 20, 12),
    ],
    [
      usage("coexist-major", "core-command", 1.4, 40),
      usage("coexist-minor", "second-command", 1.4, 10),
      usage("coexist-bridge", "core-command", 0.6, 20),
      usage("coexist-bridge", "second-command", 1.3, 20),
    ],
  );

  const byDeck = resultByDeck(output);
  assert.strictEqual(byDeck["coexist-bridge"].primaryCoreCardId, "core-command");
  assert.strictEqual(byDeck["coexist-bridge"].categoryId, byDeck["coexist-major"].categoryId);
  assert.notStrictEqual(byDeck["coexist-minor"].categoryId, byDeck["coexist-major"].categoryId);
  assert.strictEqual(byDeck["coexist-minor"].primaryCoreCardId, "second-command");
  assert.ok(byDeck["coexist-bridge"].evidence.primaryAxisOverrideReason.includes("coexistingCommandPrimaryAxis"));
}

function testCoexistingCommandPrimaryAxisRequiresSampleThreshold() {
  const output = classify(
    [
      deck("coexist-low-major", ["core-command", "low-a", "low-b", "low-c"], 40, 24),
      deck("coexist-low-minor", ["second-command", "low-a", "low-b", "low-d"], 30, 18),
      deck("coexist-low-bridge", ["core-command", "second-command", "low-a", "low-b"], 10, 6),
    ],
    [
      usage("coexist-low-major", "core-command", 1.4, 40),
      usage("coexist-low-minor", "second-command", 1.4, 30),
      usage("coexist-low-bridge", "core-command", 0.6, 10),
      usage("coexist-low-bridge", "second-command", 1.3, 10),
    ],
  );

  const byDeck = resultByDeck(output);
  assert.strictEqual(byDeck["coexist-low-bridge"].primaryCoreCardId, "second-command");
  assert.strictEqual(byDeck["coexist-low-bridge"].categoryId, byDeck["coexist-low-minor"].categoryId);
}

function testCoexistingCommandPrimaryAxisDoesNotCrossFactionOrDeckType() {
  const output = classify(
    [
      deck("type-command", ["core-command", "low-a", "low-b", "low-c"], 40, 24),
      deck("type-balance", ["core-balance", "core-command", "flex-a", "flex-b"], 20, 12),
      deck("faction-blue", ["core-command", "low-a", "low-b", "low-c"], 40, 24),
      deck("faction-red", ["red-command", "flex-a", "flex-b", "low-a"], 30, 18),
      deck("faction-mixed", ["core-command", "red-command", "flex-a", "flex-b"], 20, 12),
    ],
    [
      usage("type-command", "core-command", 1.4, 40),
      usage("type-balance", "core-balance", 1.5, 20),
      usage("type-balance", "core-command", 1.0, 20),
      usage("faction-blue", "core-command", 1.4, 40),
      usage("faction-red", "red-command", 1.4, 30),
      usage("faction-mixed", "core-command", 0.6, 20),
      usage("faction-mixed", "red-command", 1.3, 20),
    ],
  );

  const byDeck = resultByDeck(output);
  assert.strictEqual(byDeck["type-balance"].deckType, "バランス");
  assert.strictEqual(byDeck["type-balance"].primaryCoreCardId, "core-balance");
  assert.strictEqual(byDeck["faction-mixed"].primaryCoreCardId, "red-command");
  assert.strictEqual(byDeck["faction-mixed"].primaryFaction, "緋");
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

function testRegistryIsNotIncludedByDefault() {
  const output = classify(
    [deck("registry-default", ["core-command", "second-command", "low-a", "flex-a"])],
    [usage("registry-default", "core-command", 1.5)],
  );

  assert.strictEqual(output.categoryRegistry, undefined);
  assert.strictEqual(output.stats.activeCategoryCount, 1);
  assert.strictEqual(output.stats.inactiveCategoryCount, 0);
  assert.strictEqual(output.stats.registryCategoryCount, 1);
}

function testRegistryKeepsInactiveAndReactivatesCategories() {
  const first = classify(
    [deck("registry-old", ["core-command", "second-command", "low-a", "flex-a"])],
    [usage("registry-old", "core-command", 1.5)],
    { categoryRegistry: { categories: [] } },
  );
  const oldCategoryId = first.categories[0].categoryId;

  const second = classify(
    [deck("registry-new", ["core-balance", "second-balance", "low-a", "flex-a"])],
    [usage("registry-new", "core-balance", 1.5)],
    {
      now: "2026-05-24T00:00:00.000Z",
      categoryRegistry: first.categoryRegistry,
    },
  );
  const secondRegistry = registryById(second);
  const newCategoryId = second.categories[0].categoryId;

  assert.notStrictEqual(oldCategoryId, newCategoryId);
  assert.strictEqual(second.stats.activeCategoryCount, 1);
  assert.strictEqual(second.stats.inactiveCategoryCount, 1);
  assert.strictEqual(second.stats.registryCategoryCount, 2);
  assert.strictEqual(secondRegistry[oldCategoryId].status, "inactive");
  assert.strictEqual(secondRegistry[oldCategoryId].lastSampleCount, 10);
  assert.strictEqual(secondRegistry[oldCategoryId].inactiveSince, "2026-05-24T00:00:00.000Z");

  const third = classify(
    [deck("registry-old", ["core-command", "second-command", "low-a", "flex-a"])],
    [usage("registry-old", "core-command", 1.5)],
    {
      now: "2026-05-25T00:00:00.000Z",
      categoryRegistry: second.categoryRegistry,
    },
  );
  const thirdRegistry = registryById(third);

  assert.strictEqual(thirdRegistry[oldCategoryId].status, "active");
  assert.strictEqual(thirdRegistry[oldCategoryId].inactiveSince, null);
  assert.strictEqual(thirdRegistry[oldCategoryId].seenRunCount, 2);
  assert.strictEqual(thirdRegistry[newCategoryId].status, "inactive");
}

function testRegistryTracksAliasesWhenCategoryNameChanges() {
  const firstCatalog = cardCatalog();
  const first = classifyAnalysisDecks(
    [deck("registry-alias", ["core-command", "second-command", "low-a", "flex-a"])],
    firstCatalog,
    {
      now: NOW,
      strategyTypes: strategyTypes(),
      strategyUsage: [usage("registry-alias", "core-command", 1.5)],
      categoryRegistry: { categories: [] },
    },
  );
  const firstCategoryId = first.categories[0].categoryId;
  const firstName = first.categories[0].categoryName;
  const nextCatalog = cardCatalog();
  nextCatalog["core-command"] = {
    ...nextCatalog["core-command"],
    name: "Renamed Command",
  };

  const second = classifyAnalysisDecks(
    [deck("registry-alias", ["core-command", "second-command", "low-a", "flex-a"])],
    nextCatalog,
    {
      now: "2026-05-24T00:00:00.000Z",
      strategyTypes: strategyTypes(),
      strategyUsage: [usage("registry-alias", "core-command", 1.5)],
      categoryRegistry: first.categoryRegistry,
    },
  );
  const record = registryById(second)[firstCategoryId];

  assert.strictEqual(second.categories[0].categoryId, firstCategoryId);
  assert.notStrictEqual(record.categoryName, firstName);
  assert.ok(record.aliases.includes(firstName));
}

testParseCsvObjects();
testDuplicateFingerprintDoesNotDuplicateResults();
testSevenCardsAreManyCardDeck();
testSixLowCostCardsAreManyCardDeck();
testKnownPlanTypeOverridesManyCardSize();
testThreeCardsAreKenyaDeck();
testCommandAndFormationBecomeCommandDecks();
testSingleBuffAndDamageBecomeBalanceDecks();
testHigherStrategyFrequencyBeatsCost();
testCloseStrategyFrequencyUsesHigherCostAndNeedsReview();
testBalanceDeckRejectsLowFrequencyCommandSecondaryAxis();
testBalanceDeckPromotesHighFrequencyCommandToPrimaryAxis();
testCompatibleHighCostPartnerBecomesSecondaryAxis();
testCommandDeckRejectsBalanceSecondaryAxis();
testCommandDeckRejectsAllBuffSecondaryAxis();
testBalanceNamePutsLargeSecondaryAxisFirst();
testSamePrimaryDifferentSecondAxesDoNotSplitAtHalfSupport();
testLowCostCommonCardCannotBecomeSecondaryAxis();
testModerateSupportHighFrequencyBecomesSecondaryAxis();
testLowSupportHighFrequencyCannotBecomeSecondaryAxis();
testSecondaryAxisBelowThresholdDoesNotNeedReview();
testUnknownPlanTypeCannotBecomeSecondaryAxis();
testLowCostCommonCardDoesNotMergeDifferentAxes();
testCoexistingCommandPrimaryAxisUsesLargerPrimaryGroup();
testCoexistingCommandPrimaryAxisRequiresSampleThreshold();
testCoexistingCommandPrimaryAxisDoesNotCrossFactionOrDeckType();
testMissingStrategyDataFallsBackAndNeedsReview();
testRegistryIsNotIncludedByDefault();
testRegistryKeepsInactiveAndReactivatesCategories();
testRegistryTracksAliasesWhenCategoryNameChanges();

console.log("eiketsu analysis deck tests passed");
