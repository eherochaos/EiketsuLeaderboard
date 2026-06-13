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
    deckCards: row.deckCards || [],
    battleCamp: row.battleCamp
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

function emptyBattleFestivalMeritSummary() {
  return {
    observedPlayerCount: 0,
    meritPlayerCount: 0,
    meritSampleCount: 0,
    highestMerit: 0,
    topPlayerName: "",
    observedMatchCount: 0
  };
}

function slimBattleFestivalMeritDeck(deck) {
  return {
    deckId: String(deck?.deckId || ""),
    deckName: String(deck?.deckName || ""),
    faction: String(deck?.faction || "unknown"),
    sampleSize: Number(deck?.sampleSize || 0),
    winCount: Number(deck?.winCount || 0),
    lossCount: Number(deck?.lossCount || 0),
    drawCount: Number(deck?.drawCount || 0),
    unknownCount: Number(deck?.unknownCount || 0),
    winRate: Number(deck?.winRate || 0),
    deckCards: Array.isArray(deck?.deckCards) ? deck.deckCards : []
  };
}

function slimBattleFestivalMeritRow(row) {
  return {
    playerName: String(row?.playerName || ""),
    camp: String(row?.camp || ""),
    firstSeenAt: String(row?.firstSeenAt || ""),
    lastSeenAt: String(row?.lastSeenAt || ""),
    highestMerit: Number(row?.highestMerit || 0),
    highestMeritSeenAt: String(row?.highestMeritSeenAt || ""),
    meritSampleCount: Number(row?.meritSampleCount || 0),
    observedMatchCount: Number(row?.observedMatchCount || 0),
    winCount: Number(row?.winCount || 0),
    lossCount: Number(row?.lossCount || 0),
    drawCount: Number(row?.drawCount || 0),
    unknownCount: Number(row?.unknownCount || 0),
    winRate: Number(row?.winRate || 0),
    decks: Array.isArray(row?.decks) ? row.decks.map(slimBattleFestivalMeritDeck) : []
  };
}

function slimBattleFestivalMeritSummary(summary) {
  if (!summary || typeof summary !== "object") return emptyBattleFestivalMeritSummary();
  return {
    observedPlayerCount: Number(summary.observedPlayerCount || 0),
    meritPlayerCount: Number(summary.meritPlayerCount || 0),
    meritSampleCount: Number(summary.meritSampleCount || 0),
    highestMerit: Number(summary.highestMerit || 0),
    topPlayerName: String(summary.topPlayerName || ""),
    observedMatchCount: Number(summary.observedMatchCount || 0)
  };
}

function slimBattleFestival(value) {
  if (!value || typeof value !== "object") return undefined;
  const rowsByCamp = {};
  const sourceRowsByCamp = value.rowsByCamp && typeof value.rowsByCamp === "object" ? value.rowsByCamp : {};
  for (const [camp, rows] of Object.entries(sourceRowsByCamp)) {
    rowsByCamp[camp] = {
      tierRows: Array.isArray(rows?.tierRows) ? rows.tierRows.map(slimRow) : [],
      clusterRows: Array.isArray(rows?.clusterRows) ? rows.clusterRows.map(slimRow) : []
    };
  }
  return {
    camps: Array.isArray(value.camps) ? value.camps : [],
    campShare: Array.isArray(value.campShare) ? value.campShare : [],
    rowsByCamp,
    meritRows: Array.isArray(value.meritRows) ? value.meritRows.map(slimBattleFestivalMeritRow) : [],
    meritSummary: slimBattleFestivalMeritSummary(value.meritSummary)
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
      clusterRows: clusterRows.map(slimRow),
      battleFestival: slimBattleFestival(snapshot.battleFestival)
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
