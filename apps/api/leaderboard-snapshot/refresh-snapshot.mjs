import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeLeaderboardSnapshot } from "./snapshot-builder.mjs";

const DEFAULT_SNAPSHOT_FILE = resolve("apps/api/data/leaderboard-snapshot.json");

function snapshotFileFromOptions(options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  return resolve(options.outputPath || env.LEADERBOARD_SNAPSHOT_FILE || DEFAULT_SNAPSHOT_FILE);
}

function legacyRootFromOptions(options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  return options.legacyRoot || env.LEADERBOARD_LEGACY_ROOT;
}

function tempSnapshotPath(outputPath) {
  return resolve(dirname(outputPath), `.${basename(outputPath)}.${Date.now()}.${process.pid}.tmp`);
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
    return { outputPath, snapshot };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function main() {
  const { outputPath, snapshot } = await refreshLeaderboardSnapshot();
  const sourceKind = snapshot.metadata.sourceKind || "analysis";
  const builtAt = new Date().toISOString();
  console.log(`snapshot=${outputPath}`);
  console.log(
    `${sourceKind}Run=${snapshot.metadata.sourceRunId} rows=${snapshot.tierRows.length} clusters=${snapshot.clusterRows.length} cards=${snapshot.home.featuredCards.length} builtAt=${builtAt}`
  );
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
