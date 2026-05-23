"use strict";

const fs = require("fs");
const path = require("path");
const {
  DEFAULT_SIMILAR_COST,
  classifyAnalysisDecks,
  loadAnalysisDeckCsv,
  loadCardCatalog,
} = require("./eiketsu-analysis-deck");

function getArgValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? "" : args[index + 1] || "";
}

function usage() {
  return [
    "Usage:",
    "node apps/api/deck-classification/classify-eiketsu-analysis-decks.js --input <analysis_deck.csv> --card-catalog <card_catalog.json> --output <results.json>",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const inputPath = getArgValue(args, "--input");
  const cardCatalogPath = getArgValue(args, "--card-catalog");
  const outputPath = getArgValue(args, "--output");
  const similarCost = Number(getArgValue(args, "--similar-cost") || DEFAULT_SIMILAR_COST);

  if (!inputPath || !cardCatalogPath || !outputPath) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const decks = loadAnalysisDeckCsv(inputPath);
  const cardCatalog = loadCardCatalog(cardCatalogPath);
  const output = classifyAnalysisDecks(decks, cardCatalog, { similarCost });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(
    `processed=${output.stats.total} classified=${output.stats.classified} unclassified=${output.stats.unclassified} categories=${output.stats.categoryCount}`,
  );
}

if (require.main === module) {
  main();
}
