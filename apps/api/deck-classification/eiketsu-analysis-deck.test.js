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

function testClassifyAnalysisDecksBySharedCost() {
  const cardCatalog = {
    "card-a": { name: "A", cost: "3.0", unitType: "槍兵" },
    "card-b": { name: "B", cost: "2.0", unitType: "騎兵" },
    "card-c": { name: "C", cost: "1.5", unitType: "弓兵" },
    "card-d": { name: "D", cost: "3.0", unitType: "剣豪" },
    "card-e": { name: "E", cost: "2.0", unitType: "鉄砲隊" },
  };
  const decks = [
    {
      deckId: "card-a,card-b,card-c",
      deckName: "A / B / C",
      cards: ["card-a", "card-b", "card-c"],
      sampleCount: 10,
      winCount: 6,
      lossCount: 4,
      drawCount: 0,
    },
    {
      deckId: "card-a,card-b,card-d",
      deckName: "A / B / D",
      cards: ["card-a", "card-b", "card-d"],
      sampleCount: 5,
      winCount: 3,
      lossCount: 2,
      drawCount: 0,
    },
    {
      deckId: "card-d,card-e",
      deckName: "D / E",
      cards: ["card-d", "card-e"],
      sampleCount: 4,
      winCount: 1,
      lossCount: 3,
      drawCount: 0,
    },
  ];

  const output = classifyAnalysisDecks(decks, cardCatalog, {
    now: "2026-05-23T00:00:00.000Z",
    similarCost: 5,
  });

  assert.strictEqual(output.stats.total, 3);
  assert.strictEqual(output.stats.classified, 3);
  assert.strictEqual(output.stats.categoryCount, 2);
  assert.strictEqual(output.categories[0].memberCount, 2);
  assert.strictEqual(output.categories[0].categoryName, "A / B");
}

testParseCsvObjects();
testClassifyAnalysisDecksBySharedCost();

console.log("eiketsu analysis deck tests passed");
