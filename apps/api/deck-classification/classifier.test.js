"use strict";

const assert = require("assert");
const {
  classifyDeck,
  classifyDecks,
  mergeClassificationResults,
} = require("./classifier");

const rules = [
  {
    categoryId: "red-aggro",
    categoryName: "Red Aggro",
    signatureCards: ["volcanic-spear", "scarlet-vanguard"],
    threshold: 1,
  },
];

function testKnownDeckClassification() {
  const result = classifyDeck(
    {
      deckId: "known",
      cards: ["scarlet-vanguard", "volcanic-spear", "ember-monk"],
    },
    rules,
    { now: "2026-05-23T00:00:00.000Z" },
  );

  assert.strictEqual(result.deckId, "known");
  assert.strictEqual(result.categoryId, "red-aggro");
  assert.strictEqual(result.status, "classified");
  assert.strictEqual(result.confidence, 1);
}

function testUnknownDeckClassification() {
  const result = classifyDeck(
    {
      deckId: "unknown",
      cards: ["field-ration", "wandering-soldier"],
    },
    rules,
    { now: "2026-05-23T00:00:00.000Z" },
  );

  assert.strictEqual(result.deckId, "unknown");
  assert.strictEqual(result.categoryId, "unclassified");
  assert.strictEqual(result.status, "unclassified");
  assert.strictEqual(result.confidence, 0);
}

function testRepeatRunDoesNotDuplicateResults() {
  const decks = [
    {
      deckId: "known",
      cards: ["scarlet-vanguard", "volcanic-spear"],
    },
  ];
  const firstRun = classifyDecks(decks, rules, {
    now: "2026-05-23T00:00:00.000Z",
  });
  const secondRun = classifyDecks(decks, rules, {
    now: "2026-05-23T01:00:00.000Z",
  });

  const mergedOnce = mergeClassificationResults([], firstRun);
  const mergedTwice = mergeClassificationResults(mergedOnce, secondRun);

  assert.strictEqual(mergedOnce.length, 1);
  assert.strictEqual(mergedTwice.length, 1);
  assert.strictEqual(mergedTwice[0].classifiedAt, "2026-05-23T01:00:00.000Z");
}

testKnownDeckClassification();
testUnknownDeckClassification();
testRepeatRunDoesNotDuplicateResults();

console.log("deck classification tests passed");
