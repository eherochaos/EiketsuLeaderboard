"use strict";

const LEADERBOARD_REFRESH_STATUS_ENDPOINT = "/api/leaderboard-refresh-status";

const LEADERBOARD_REFRESH_STATUS_ROOT_FIELDS = Object.freeze([
  "schemaVersion",
  "generatedAt",
  "refresh",
  "runRefresh",
  "snapshot",
  "battleFestivalSnapshot",
  "export",
  "latestRun",
  "recentRuns",
  "latestUpload",
  "recentUploads",
]);

const LEADERBOARD_REFRESH_STATUS_REFRESH_FIELDS = Object.freeze([
  "status",
  "reason",
  "error",
  "startedAt",
  "finishedAt",
  "durationMs",
]);

module.exports = {
  LEADERBOARD_REFRESH_STATUS_ENDPOINT,
  LEADERBOARD_REFRESH_STATUS_REFRESH_FIELDS,
  LEADERBOARD_REFRESH_STATUS_ROOT_FIELDS,
};
