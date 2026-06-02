import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TIER_LIST_SCHEMA_VERSION = 1;

const DEFAULT_SNAPSHOT_FILE = resolve("apps/api/data/leaderboard-snapshot.json");
const DEFAULT_TIER_LIST_SNAPSHOT_FILE = resolve("apps/api/data/tier-list-snapshot.json");
const DEFAULT_TIER_LIST_CONFIGS_FILE = resolve("apps/api/data/tier-list-configs.json");

function emptyDeckConfig() {
  return {
    weapons: [],
    styles: [],
    souls: [],
    strategies: [],
    schoolStages: [],
    unfavorableMatchups: []
  };
}

function rowKey(row) {
  return String(row?.deckId || row?.deckName || "").trim();
}

function slimVariant(row) {
  return {
    deckId: row.deckId,
    deckName: row.deckName,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    faction: row.faction,
    namingSource: row.namingSource,
    rankScore: row.rankScore,
    sourceRank: row.sourceRank,
    winRate: row.winRate,
    playerAverageWinRate: row.playerAverageWinRate,
    usageRate: row.usageRate,
    kabukiPoints: row.kabukiPoints,
    sampleSize: row.sampleSize,
    imageUrl: row.imageUrl,
    imageAlt: row.imageAlt,
    deckCards: row.deckCards || []
  };
}

function slimRow(row) {
  return {
    ...slimVariant(row),
    evidenceTags: row.evidenceTags || [],
    clusterVariants: Array.isArray(row.clusterVariants) ? row.clusterVariants.map(slimVariant) : undefined
  };
}

function configMap(rows) {
  const entries = {};
  for (const row of rows || []) {
    const key = rowKey(row);
    if (!key) continue;
    entries[key] = row.deckConfig || emptyDeckConfig();
  }
  return entries;
}

function metadataForConfigs(metadata) {
  return {
    sourceRunId: metadata?.sourceRunId,
    sourceKind: metadata?.sourceKind,
    targetVersion: metadata?.targetVersion,
    dateFrom: metadata?.dateFrom,
    dateTo: metadata?.dateTo,
    updatedAt: metadata?.updatedAt,
    sampleSize: metadata?.sampleSize
  };
}

export function buildTierListSnapshotFiles(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("leaderboard snapshot must be an object");
  }

  const tierRows = Array.isArray(snapshot.tierRows) ? snapshot.tierRows : [];
  const clusterRows = Array.isArray(snapshot.clusterRows) ? snapshot.clusterRows : [];
  const metadata = snapshot.metadata || {};

  return {
    tierListSnapshot: {
      schemaVersion: TIER_LIST_SCHEMA_VERSION,
      metadata,
      tierRows: tierRows.map(slimRow),
      clusterRows: clusterRows.map(slimRow)
    },
    tierListConfigs: {
      schemaVersion: TIER_LIST_SCHEMA_VERSION,
      metadata: metadataForConfigs(metadata),
      deckConfigs: configMap(tierRows),
      clusterConfigs: configMap(clusterRows)
    }
  };
}

function tempPath(outputPath) {
  return resolve(dirname(outputPath), `.${basename(outputPath)}.${Date.now()}.${process.pid}.tmp`);
}

async function writeJsonAtomically(outputPath, payload) {
  const temporaryPath = tempPath(outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, "utf8");
    JSON.parse(await readFile(temporaryPath, "utf8"));
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function writeTierListSnapshotFiles(options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  const sourceSnapshot = options.snapshot || JSON.parse(
    await readFile(resolve(options.snapshotFile || env.LEADERBOARD_SNAPSHOT_FILE || DEFAULT_SNAPSHOT_FILE), "utf8")
  );
  const snapshotFile = resolve(options.tierListSnapshotFile || env.LEADERBOARD_TIER_LIST_SNAPSHOT_FILE || DEFAULT_TIER_LIST_SNAPSHOT_FILE);
  const configsFile = resolve(options.tierListConfigsFile || env.LEADERBOARD_TIER_LIST_CONFIGS_FILE || DEFAULT_TIER_LIST_CONFIGS_FILE);
  const { tierListSnapshot, tierListConfigs } = buildTierListSnapshotFiles(sourceSnapshot);

  await writeJsonAtomically(snapshotFile, tierListSnapshot);
  await writeJsonAtomically(configsFile, tierListConfigs);

  return {
    snapshotFile,
    configsFile,
    tierRows: tierListSnapshot.tierRows.length,
    clusterRows: tierListSnapshot.clusterRows.length,
    deckConfigs: Object.keys(tierListConfigs.deckConfigs).length,
    clusterConfigs: Object.keys(tierListConfigs.clusterConfigs).length
  };
}

async function main() {
  const result = await writeTierListSnapshotFiles();
  console.log(
    `tierListSnapshot=${result.snapshotFile} rows=${result.tierRows} clusters=${result.clusterRows} configs=${result.deckConfigs}/${result.clusterConfigs}`
  );
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
