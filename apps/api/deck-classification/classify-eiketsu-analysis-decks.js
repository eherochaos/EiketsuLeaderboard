"use strict";

const fs = require("fs");
const path = require("path");
const {
  classifyAnalysisDecks,
  loadAnalysisDeckCsv,
  loadCardCatalog,
  loadCoreRules,
  loadStrategyTypes,
  loadStrategyUsage,
} = require("./eiketsu-analysis-deck");

function getArgValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? "" : args[index + 1] || "";
}

function usage() {
  return [
    "Usage:",
    "node apps/api/deck-classification/classify-eiketsu-analysis-decks.js --input <analysis_deck.csv> --card-catalog <card_catalog.json> --output <results.json> [--strategy-types <json|csv>] [--strategy-usage <json|csv>] [--core-rules <coreRules.json>] [--category-registry <registry.json>] [--write-category-registry <registry.json>]",
  ].join("\n");
}

function loadCategoryRegistry(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { categories: [] };
  }

  const text = fs.readFileSync(filePath, "utf8").trim();
  return text ? JSON.parse(text) : { categories: [] };
}

function printTopCategories(output, limit = 10) {
  for (const [index, category] of output.categories.slice(0, limit).entries()) {
    const partners = (category.partnerCardNames || [])
      .map((name) => String(name).split("(", 1)[0])
      .join(" / ");
    const partnerText = partners ? ` partners=${partners}` : "";
    console.log(
      `${index + 1}. ${category.categoryName} sample=${category.sampleCount} winRate=${category.winRate}${partnerText} needsReview=${category.needsReviewCount}`,
    );
  }
}

function main() {
  const args = process.argv.slice(2);
  const inputPath = getArgValue(args, "--input");
  const cardCatalogPath = getArgValue(args, "--card-catalog");
  const coreRulesPath = getArgValue(args, "--core-rules");
  const strategyTypesPath = getArgValue(args, "--strategy-types");
  const strategyUsagePath = getArgValue(args, "--strategy-usage");
  const categoryRegistryPath = getArgValue(args, "--category-registry");
  const writeCategoryRegistryPath =
    getArgValue(args, "--write-category-registry") || categoryRegistryPath;
  const outputPath = getArgValue(args, "--output");

  if (!inputPath || !cardCatalogPath || !outputPath) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const decks = loadAnalysisDeckCsv(inputPath);
  const cardCatalog = loadCardCatalog(cardCatalogPath);
  const coreRules = loadCoreRules(coreRulesPath);
  const strategyTypes = loadStrategyTypes(strategyTypesPath);
  const strategyUsage = loadStrategyUsage(strategyUsagePath);
  const usesCategoryRegistry = Boolean(categoryRegistryPath || writeCategoryRegistryPath);
  const categoryRegistry = usesCategoryRegistry
    ? loadCategoryRegistry(categoryRegistryPath)
    : undefined;
  const output = classifyAnalysisDecks(decks, cardCatalog, {
    coreRules,
    strategyTypes,
    strategyUsage,
    ...(usesCategoryRegistry ? { categoryRegistry } : {}),
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  if (writeCategoryRegistryPath) {
    fs.mkdirSync(path.dirname(writeCategoryRegistryPath), { recursive: true });
    fs.writeFileSync(
      writeCategoryRegistryPath,
      `${JSON.stringify(output.categoryRegistry, null, 2)}\n`,
      "utf8",
    );
  }

  const registryStats = output.categoryRegistry
    ? ` activeCategories=${output.stats.activeCategoryCount} inactiveCategories=${output.stats.inactiveCategoryCount} registryCategories=${output.stats.registryCategoryCount}`
    : "";
  console.log(
    `processed=${output.stats.total} classified=${output.stats.classified} unclassified=${output.stats.unclassified} categories=${output.stats.categoryCount}${registryStats} needsReview=${output.stats.needsReviewCount}`,
  );
  printTopCategories(output);
}

if (require.main === module) {
  main();
}
