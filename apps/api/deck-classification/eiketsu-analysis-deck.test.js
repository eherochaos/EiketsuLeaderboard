"use strict";

const assert = require("assert");
const {
  classifyAnalysisDecks,
  parseCsvObjects,
} = require("./eiketsu-analysis-deck");

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
    "core-a": { name: "Core A", cost: "3.0", unitType: "spear", card_code: "玄001" },
    "core-b": { name: "Core B", cost: "3.5", unitType: "spear", card_code: "緋001" },
    "partner-a": { name: "Partner A", cost: "2.0", unitType: "gun", card_code: "玄002" },
    "low-x": { name: "Low X", cost: "1.0", unitType: "spear", card_code: "玄003" },
    "flex-a": { name: "Flex A", cost: "1.5", unitType: "bow", card_code: "玄004" },
    "flex-b": { name: "Flex B", cost: "1.5", unitType: "bow", card_code: "玄005" },
    "flex-c": { name: "Flex C", cost: "2.0", unitType: "gun", card_code: "緋002" },
    "flex-d": { name: "Flex D", cost: "1.5", unitType: "bow", card_code: "緋003" },
    "horse-a": { name: "Horse A", cost: "2.0", unitType: "cavalry", card_code: "蒼001" },
    "horse-b": { name: "Horse B", cost: "2.0", unitType: "cavalry", card_code: "蒼002" },
    "horse-c": { name: "Horse C", cost: "1.5", unitType: "cavalry", card_code: "蒼003" },
    "tie-a": { name: "Tie A", cost: "3.0", unitType: "spear", card_code: "碧001" },
    "tie-b": { name: "Tie B", cost: "3.0", unitType: "gun", card_code: "碧002" },
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

function testCoreAxisAndLowCostCommonCard() {
  const output = classifyAnalysisDecks(
    [
      deck("deck-1", ["core-a", "partner-a", "low-x", "flex-a"], 10, 7),
      deck("deck-2", ["core-a", "partner-a", "low-x", "flex-b"], 8, 5),
      deck("deck-3", ["core-b", "low-x", "flex-c", "flex-d"], 9, 5),
    ],
    cardCatalog(),
    {
      now: "2026-05-23T00:00:00.000Z",
      coreRules: [
        {
          cardId: "core-a",
          deckType: "号令",
          priority: 100,
          displayName: "Official Core A",
        },
      ],
    },
  );

  const byDeck = Object.fromEntries(output.results.map((result) => [result.deckId, result]));

  assert.strictEqual(output.stats.total, 3);
  assert.strictEqual(output.stats.categoryCount, 2);
  assert.strictEqual(byDeck["deck-1"].categoryId, byDeck["deck-2"].categoryId);
  assert.notStrictEqual(byDeck["deck-1"].categoryId, byDeck["deck-3"].categoryId);
  assert.strictEqual(byDeck["deck-1"].primaryCoreCardId, "core-a");
  assert.strictEqual(byDeck["deck-1"].primaryCoreCardName, "Official Core A");
  assert.strictEqual(byDeck["deck-1"].deckType, "号令");
  assert.strictEqual(byDeck["deck-3"].primaryCoreCardId, "core-b");
  assert.notStrictEqual(byDeck["deck-3"].primaryCoreCardId, "low-x");
}

function testFallbackDeckTypes() {
  const output = classifyAnalysisDecks(
    [
      deck("many", ["core-a", "partner-a", "low-x", "flex-a", "flex-b", "flex-c"], 6, 3),
      deck("cavalry", ["horse-a", "horse-b", "horse-c", "flex-a"], 6, 3),
      deck("balance", ["core-b", "partner-a", "flex-c", "flex-d"], 6, 3),
    ],
    cardCatalog(),
    { now: "2026-05-23T00:00:00.000Z" },
  );

  const byDeck = Object.fromEntries(output.results.map((result) => [result.deckId, result]));
  assert.strictEqual(byDeck.many.deckType, "多枚数");
  assert.strictEqual(byDeck.cavalry.deckType, "騎兵主体");
  assert.strictEqual(byDeck.balance.deckType, "バランス");
}

function testCloseCoreScoresNeedReview() {
  const output = classifyAnalysisDecks(
    [deck("close", ["tie-a", "tie-b", "low-x"], 5, 3)],
    cardCatalog(),
    { now: "2026-05-23T00:00:00.000Z" },
  );

  assert.strictEqual(output.results[0].needsReview, true);
  assert.strictEqual(output.stats.needsReviewCount, 1);
}

function testDuplicateFingerprintDoesNotDuplicateResults() {
  const output = classifyAnalysisDecks(
    [
      deck("same-fingerprint", ["core-a", "partner-a", "low-x"], 4, 2),
      deck("same-fingerprint", ["core-a", "partner-a", "low-x"], 6, 4),
    ],
    cardCatalog(),
    { now: "2026-05-23T00:00:00.000Z" },
  );

  assert.strictEqual(output.results.length, 1);
  assert.strictEqual(output.results[0].evidence.sampleCount, 10);
}

testParseCsvObjects();
testCoreAxisAndLowCostCommonCard();
testFallbackDeckTypes();
testCloseCoreScoresNeedReview();
testDuplicateFingerprintDoesNotDuplicateResults();

console.log("eiketsu analysis deck tests passed");
