"use strict";

const fs = require("fs");
const path = require("path");
const {
  classifyAnalysisDecks,
  loadAnalysisDeckCsv,
  loadCardCatalog,
  loadCoreRules,
} = require("./eiketsu-analysis-deck");

function getArgValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? "" : args[index + 1] || "";
}

function usage() {
  return [
    "Usage:",
    "node apps/api/deck-classification/classify-eiketsu-analysis-decks.js --input <analysis_deck.csv> --card-catalog <card_catalog.json> --output <results.json> [--core-rules <coreRules.json>]",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const inputPath = getArgValue(args, "--input");
  const cardCatalogPath = getArgValue(args, "--card-catalog");
  const coreRulesPath = getArgValue(args, "--core-rules");
  const outputPath = getArgValue(args, "--output");

  if (!inputPath || !cardCatalogPath || !outputPath) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const decks = loadAnalysisDeckCsv(inputPath);
  const cardCatalog = loadCardCatalog(cardCatalogPath);
  const coreRules = loadCoreRules(coreRulesPath);
  const output = classifyAnalysisDecks(decks, cardCatalog, { coreRules });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(
    `processed=${output.stats.total} classified=${output.stats.classified} unclassified=${output.stats.unclassified} categories=${output.stats.categoryCount} needsReview=${output.stats.needsReviewCount}`,
  );
}

if (require.main === module) {
  main();
}
