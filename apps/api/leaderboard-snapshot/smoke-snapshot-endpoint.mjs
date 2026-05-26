import { pathToFileURL } from "node:url";

const DEFAULT_ENDPOINT_URL = "http://127.0.0.1:8001/api/leaderboard-snapshot";
const REQUIRED_TOP_LEVEL_FIELDS = ["metadata", "home", "clusterRows", "tierRows"];
const SENSITIVE_RESPONSE_PATTERN = /\b(token|cookie|secret)\b|[A-Za-z]:\\|(^|["'\s])\/(?:home|Users|var|etc)\//i;

function requireEndpointUrl(endpointUrl) {
  if (!endpointUrl || typeof endpointUrl !== "string") {
    throw new Error("snapshot endpoint URL is required");
  }

  return endpointUrl;
}

function assertJsonContentType(contentType) {
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`snapshot endpoint must return application/json, got ${contentType || "empty content-type"}`);
  }
}

function assertNoHtmlFallback(bodyText) {
  if (bodyText.trimStart().startsWith("<")) {
    throw new Error("snapshot endpoint returned HTML instead of JSON");
  }
}

function parseJson(bodyText) {
  try {
    return JSON.parse(bodyText);
  } catch {
    throw new Error("snapshot endpoint returned invalid JSON");
  }
}

export function assertLeaderboardSnapshotShape(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("snapshot JSON must be an object");
  }

  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!(field in snapshot)) {
      throw new Error(`snapshot JSON is missing ${field}`);
    }
  }

  if (!snapshot.metadata || typeof snapshot.metadata !== "object") {
    throw new Error("snapshot metadata is missing");
  }

  if (!snapshot.home || typeof snapshot.home !== "object") {
    throw new Error("snapshot home is missing");
  }

  if (!Array.isArray(snapshot.home.factionShare)) {
    throw new Error("snapshot home.factionShare must be an array");
  }

  if (!Array.isArray(snapshot.home.representativeDecks)) {
    throw new Error("snapshot home.representativeDecks must be an array");
  }

  if (!Array.isArray(snapshot.home.featuredCards)) {
    throw new Error("snapshot home.featuredCards must be an array");
  }

  if (!Array.isArray(snapshot.home.tierRows)) {
    throw new Error("snapshot home.tierRows must be an array");
  }

  if (!Array.isArray(snapshot.clusterRows)) {
    throw new Error("snapshot clusterRows must be an array");
  }

  if (!Array.isArray(snapshot.tierRows)) {
    throw new Error("snapshot tierRows must be an array");
  }

  return snapshot;
}

export async function smokeLeaderboardSnapshotEndpoint(endpointUrl = DEFAULT_ENDPOINT_URL) {
  const response = await fetch(requireEndpointUrl(endpointUrl), {
    headers: {
      Accept: "application/json"
    }
  });
  const contentType = response.headers.get("content-type") || "";
  const bodyText = await response.text();

  if (response.status !== 200) {
    throw new Error(`snapshot endpoint returned HTTP ${response.status}`);
  }

  assertJsonContentType(contentType);
  assertNoHtmlFallback(bodyText);

  if (SENSITIVE_RESPONSE_PATTERN.test(bodyText)) {
    throw new Error("snapshot endpoint response contains sensitive-looking text");
  }

  const snapshot = assertLeaderboardSnapshotShape(parseJson(bodyText));

  return {
    endpointUrl,
    sourceRunId: snapshot.metadata.sourceRunId,
    sourceKind: snapshot.metadata.sourceKind,
    clusterRows: snapshot.clusterRows.length,
    tierRows: snapshot.tierRows.length
  };
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  smokeLeaderboardSnapshotEndpoint(process.argv[2] || process.env.LEADERBOARD_SNAPSHOT_ENDPOINT || DEFAULT_ENDPOINT_URL)
    .then((result) => {
      console.log(
        `snapshot endpoint ok: run=${result.sourceRunId ?? "unknown"} kind=${result.sourceKind ?? "unknown"} clusters=${result.clusterRows} rows=${result.tierRows}`
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
