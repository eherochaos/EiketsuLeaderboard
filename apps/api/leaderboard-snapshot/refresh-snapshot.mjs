import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { refreshMatchSearchIndex } from "./match-search-index.mjs";
import { buildLeaderboardSnapshot, buildLeaderboardVersionManifest, writeLeaderboardSnapshot } from "./snapshot-builder.mjs";
import { writeTierListSnapshotFiles } from "./tier-list-snapshot.mjs";
import { versionArtifactPath } from "./version-files.mjs";

const DEFAULT_SNAPSHOT_FILE = resolve("apps/api/data/leaderboard-snapshot.json");
const DEFAULT_VERSION_MANIFEST_FILE = resolve("apps/api/data/version-manifest.json");

function snapshotFileFromOptions(options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  return resolve(options.outputPath || env.LEADERBOARD_SNAPSHOT_FILE || DEFAULT_SNAPSHOT_FILE);
}

function legacyRootFromOptions(options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  return options.legacyRoot || env.LEADERBOARD_LEGACY_ROOT;
}

function tierListSnapshotFileFromOptions(outputPath, options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  return resolve(options.tierListSnapshotFile || env.LEADERBOARD_TIER_LIST_SNAPSHOT_FILE || resolve(dirname(outputPath), "tier-list-snapshot.json"));
}

function tierListConfigsFileFromOptions(outputPath, options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  return resolve(options.tierListConfigsFile || env.LEADERBOARD_TIER_LIST_CONFIGS_FILE || resolve(dirname(outputPath), "tier-list-configs.json"));
}

function battleFestivalSnapshotFileFromOptions(outputPath, options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  return resolve(options.battleFestivalSnapshotFile || env.LEADERBOARD_BATTLE_FESTIVAL_SNAPSHOT_FILE || resolve(dirname(outputPath), "battle-festival-snapshot.json"));
}

function battleFestivalConfigsFileFromOptions(outputPath, options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  return resolve(options.battleFestivalConfigsFile || env.LEADERBOARD_BATTLE_FESTIVAL_CONFIGS_FILE || resolve(dirname(outputPath), "battle-festival-configs.json"));
}

function versionManifestFileFromOptions(outputPath, options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  return resolve(options.versionManifestFile || env.LEADERBOARD_VERSION_MANIFEST_FILE || resolve(dirname(outputPath), "version-manifest.json") || DEFAULT_VERSION_MANIFEST_FILE);
}

function versionOutputDirFromOptions(outputPath, options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  return resolve(options.versionOutputDir || env.LEADERBOARD_VERSION_OUTPUT_DIR || resolve(dirname(outputPath), "versions"));
}

function envFlag(value) {
  const text = String(value || "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

function buildAllVersionArtifactsFromOptions(options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  return Boolean(options.buildAllVersionArtifacts) || envFlag(env.LEADERBOARD_BUILD_ALL_VERSION_ARTIFACTS);
}

function currentOnlyManifest(manifest) {
  const currentTargetVersion = String(manifest?.currentTargetVersion || "").trim();
  const versions = Array.isArray(manifest?.versions) ? manifest.versions : [];
  const currentEntry = versions.find((entry) => entry?.targetVersion === currentTargetVersion) || versions[0] || null;
  return {
    ...manifest,
    versions: currentEntry ? [currentEntry] : []
  };
}

function tempSnapshotPath(outputPath) {
  return resolve(dirname(outputPath), `.${basename(outputPath)}.${Date.now()}.${process.pid}.tmp`);
}

async function writeJsonAtomically(outputPath, payload) {
  const temporaryPath = tempSnapshotPath(outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    JSON.parse(await readFile(temporaryPath, "utf8"));
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function assertSnapshotShape(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("snapshot JSON must be an object");
  }
  if (
    !snapshot.metadata ||
    !snapshot.home ||
    !Array.isArray(snapshot.home.tierRows) ||
    !Array.isArray(snapshot.clusterRows) ||
    !Array.isArray(snapshot.tierRows)
  ) {
    throw new Error("snapshot JSON is missing required fields");
  }
}

function emptyBattleFestivalSnapshot(fallbackSnapshot) {
  const metadata = fallbackSnapshot?.metadata || {};
  const updatedAt = metadata.updatedAt || new Date().toISOString();
  return {
    metadata: {
      sourceRunId: 0,
      sourceKind: "battle_festival",
      targetVersion: metadata.targetVersion || "",
      dateFrom: metadata.dateFrom || "",
      dateTo: metadata.dateTo || "",
      updatedAt,
      sampleSize: 0
    },
    home: {
      factionShare: [],
      representativeDecks: [],
      featuredCards: [],
      summary: "No battle festival data is available.",
      tierRows: []
    },
    clusterRows: [],
    tierRows: [],
    battleFestival: {
      camps: [],
      campShare: [],
      rowsByCamp: {},
      meritRows: [],
      meritSummary: {
        observedPlayerCount: 0,
        meritPlayerCount: 0,
        meritSampleCount: 0,
        highestMerit: 0,
        topPlayerName: "",
        observedMatchCount: 0
      }
    }
  };
}

async function refreshBattleFestivalSnapshot(outputPath, options = {}) {
  const snapshotFile = battleFestivalSnapshotFileFromOptions(outputPath, options);
  const configsFile = battleFestivalConfigsFileFromOptions(outputPath, options);

  try {
    const snapshot = await buildLeaderboardSnapshot({
      legacyRoot: legacyRootFromOptions(options),
      includeBattleFestival: true,
      sourceKind: "battle_festival",
      logDiagnostics: options.logDiagnostics ?? true
    });
    const tierList = await writeTierListSnapshotFiles({
      snapshot,
      tierListSnapshotFile: snapshotFile,
      tierListConfigsFile: configsFile
    });
    return {
      status: "completed",
      snapshotFile,
      configsFile,
      sourceRunId: snapshot.metadata.sourceRunId,
      tierRows: tierList.tierRows,
      clusterRows: tierList.clusterRows
    };
  } catch (error) {
    if (String(error?.message || "").includes("Battle festival official period is not available.")) {
      return {
        status: "skipped_missing_official_period",
        reason: "official battle festival period is not available",
        snapshotFile,
        configsFile,
        sourceRunId: 0,
        tierRows: 0,
        clusterRows: 0
      };
    }
    if (String(error?.message || "").includes("No ready battle festival leaderboard run.")) {
      const snapshot = emptyBattleFestivalSnapshot(options.fallbackSnapshot);
      const tierList = await writeTierListSnapshotFiles({
        snapshot,
        tierListSnapshotFile: snapshotFile,
        tierListConfigsFile: configsFile
      });
      return {
        status: "empty",
        reason: "battle festival run is not available",
        snapshotFile,
        configsFile,
        sourceRunId: snapshot.metadata.sourceRunId,
        tierRows: tierList.tierRows,
        clusterRows: tierList.clusterRows
      };
    }
    throw error;
  }
}

async function writeVersionedLeaderboardSnapshot(targetVersion, snapshotFile, options = {}) {
  const temporaryPath = tempSnapshotPath(snapshotFile);
  await mkdir(dirname(snapshotFile), { recursive: true });
  try {
    await writeLeaderboardSnapshot({
      legacyRoot: legacyRootFromOptions(options),
      outputPath: temporaryPath,
      targetVersion,
      logDiagnostics: options.logDiagnostics ?? false
    });
    const snapshot = JSON.parse(await readFile(temporaryPath, "utf8"));
    assertSnapshotShape(snapshot);
    await rename(temporaryPath, snapshotFile);
    return snapshot;
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function refreshVersionedArtifacts(outputPath, options = {}) {
  const manifestFile = versionManifestFileFromOptions(outputPath, options);
  const versionOutputDir = versionOutputDirFromOptions(outputPath, options);
  const manifest = await buildLeaderboardVersionManifest({
    legacyRoot: legacyRootFromOptions(options),
    logDiagnostics: false
  });
  const buildAllVersionArtifacts = buildAllVersionArtifactsFromOptions(options);
  const publishedManifest = buildAllVersionArtifacts ? manifest : currentOnlyManifest(manifest);
  await writeJsonAtomically(manifestFile, publishedManifest);

  if (!buildAllVersionArtifacts) {
    return {
      manifestFile,
      versionOutputDir,
      versions: publishedManifest.versions,
      artifactMode: "current_only"
    };
  }

  const versions = [];
  for (const entry of publishedManifest.versions) {
    const snapshotFile = versionArtifactPath(versionOutputDir, entry.targetVersion, "leaderboard-snapshot.json");
    const tierListSnapshotFile = versionArtifactPath(versionOutputDir, entry.targetVersion, "tier-list-snapshot.json");
    const tierListConfigsFile = versionArtifactPath(versionOutputDir, entry.targetVersion, "tier-list-configs.json");
    const matchSearchIndexFile = versionArtifactPath(versionOutputDir, entry.targetVersion, "match-search-index.json");
    const snapshot = await writeVersionedLeaderboardSnapshot(entry.targetVersion, snapshotFile, options);
    const tierList = await writeTierListSnapshotFiles({
      snapshot,
      tierListSnapshotFile,
      tierListConfigsFile
    });
    const matchSearch = await refreshMatchSearchIndex({
      legacyRoot: legacyRootFromOptions(options),
      snapshotFile,
      outputPath: matchSearchIndexFile
    });
    versions.push({
      targetVersion: entry.targetVersion,
      snapshotFile,
      tierListSnapshotFile,
      tierListConfigsFile,
      matchSearchIndexFile,
      sourceRunId: snapshot.metadata.sourceRunId,
      tierRows: tierList.tierRows,
      matches: matchSearch.index.metadata.matchCount
    });
  }

  return {
    manifestFile,
    versionOutputDir,
    versions
  };
}

export async function refreshLeaderboardSnapshot(options = {}) {
  const outputPath = snapshotFileFromOptions(options);
  const temporaryPath = tempSnapshotPath(outputPath);
  await mkdir(dirname(outputPath), { recursive: true });

  try {
    await writeLeaderboardSnapshot({
      legacyRoot: legacyRootFromOptions(options),
      outputPath: temporaryPath,
      logDiagnostics: options.logDiagnostics ?? true
    });
    const snapshot = JSON.parse(await readFile(temporaryPath, "utf8"));
    assertSnapshotShape(snapshot);
    await rename(temporaryPath, outputPath);
    const tierList = await writeTierListSnapshotFiles({
      snapshot,
      tierListSnapshotFile: tierListSnapshotFileFromOptions(outputPath, options),
      tierListConfigsFile: tierListConfigsFileFromOptions(outputPath, options)
    });
    const battleFestival = await refreshBattleFestivalSnapshot(outputPath, { ...options, fallbackSnapshot: snapshot });
    const versionManifest = await refreshVersionedArtifacts(outputPath, options);
    return { outputPath, snapshot, tierList, battleFestival, versionManifest };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function main() {
  const { outputPath, snapshot, tierList, battleFestival, versionManifest } = await refreshLeaderboardSnapshot();
  const sourceKind = snapshot.metadata.sourceKind || "analysis";
  const builtAt = new Date().toISOString();
  console.log(`snapshot=${outputPath}`);
  console.log(
    `${sourceKind}Run=${snapshot.metadata.sourceRunId} rows=${snapshot.tierRows.length} clusters=${snapshot.clusterRows.length} cards=${snapshot.home.featuredCards.length} builtAt=${builtAt}`
  );
  console.log(`tierListRows=${tierList.tierRows} tierListClusters=${tierList.clusterRows}`);
  console.log(`battleFestival=${battleFestival.status}`);
  console.log(`versions=${versionManifest.versions.length} manifest=${versionManifest.manifestFile}`);
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
