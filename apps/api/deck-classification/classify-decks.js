"use strict";

const fs = require("fs");
const path = require("path");
const {
  CURRENT_CLASSIFIER_VERSION,
} = require("../../../packages/contracts/deck-classification");
const {
  classifyDecks,
  mergeClassificationResults,
  summarizeResults,
} = require("./classifier");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getArgValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? "" : args[index + 1] || "";
}

function usage() {
  return [
    "Usage:",
    "node apps/api/deck-classification/classify-decks.js --input <decks.json> --rules <rules.json> --output <results.json>",
  ].join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const inputPath = getArgValue(args, "--input");
  const rulesPath = getArgValue(args, "--rules");
  const outputPath = getArgValue(args, "--output");

  if (!inputPath || !rulesPath || !outputPath) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const input = readJson(inputPath);
  const ruleInput = readJson(rulesPath);
  const decks = Array.isArray(input) ? input : input.decks;
  const rules = Array.isArray(ruleInput) ? ruleInput : ruleInput.rules;
  const nextResults = classifyDecks(decks, rules);
  const existingOutput = fs.existsSync(outputPath) ? readJson(outputPath) : {};
  const existingResults = Array.isArray(existingOutput) ? existingOutput : existingOutput.results;
  const results = mergeClassificationResults(existingResults, nextResults);
  const output = {
    classifierVersion: CURRENT_CLASSIFIER_VERSION,
    stats: summarizeResults(nextResults),
    results,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  const stats = summarizeResults(nextResults);
  console.log(
    `processed=${stats.total} classified=${stats.classified} unclassified=${stats.unclassified} totalResults=${results.length}`,
  );
}

if (require.main === module) {
  main();
}
