import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeLeaderboardSnapshot } from "../../../apps/api/leaderboard-snapshot/snapshot-builder.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, "..");
const outputPath = resolve(webRoot, "public/data/leaderboard-snapshot.json");

const { snapshot } = await writeLeaderboardSnapshot({ outputPath });
const sourceKind = snapshot.metadata.sourceKind || "analysis";

console.log(`snapshot=${outputPath}`);
console.log(`${sourceKind}Run=${snapshot.metadata.sourceRunId} decks=${snapshot.tierRows.length} cards=${snapshot.home.featuredCards.length}`);
