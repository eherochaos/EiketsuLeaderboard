"use strict";

const LEADERBOARD_SNAPSHOT_ENDPOINT = "/api/leaderboard-snapshot";

const LEADERBOARD_SNAPSHOT_ROOT_FIELDS = Object.freeze([
  "metadata",
  "home",
  "clusterRows",
  "tierRows",
]);

const LEADERBOARD_SNAPSHOT_METADATA_FIELDS = Object.freeze([
  "sourceRunId",
  "sourceKind",
  "targetVersion",
  "dateFrom",
  "dateTo",
  "updatedAt",
  "sampleSize",
  "excludedInvalidDeckRows",
  "excludedInvalidDeckSampleSize",
]);

const LEADERBOARD_SNAPSHOT_HOME_FIELDS = Object.freeze([
  "factionShare",
  "representativeDecks",
  "featuredCards",
  "summary",
  "tierRows",
]);

module.exports = {
  LEADERBOARD_SNAPSHOT_ENDPOINT,
  LEADERBOARD_SNAPSHOT_HOME_FIELDS,
  LEADERBOARD_SNAPSHOT_METADATA_FIELDS,
  LEADERBOARD_SNAPSHOT_ROOT_FIELDS,
};
