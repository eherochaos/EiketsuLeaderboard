"use strict";

const TIER_LIST_SNAPSHOT_ENDPOINT = "/api/tier-list-snapshot";
const TIER_LIST_DECK_CONFIG_ENDPOINT = "/api/tier-list-deck-config";

const TIER_LIST_SNAPSHOT_ROOT_FIELDS = Object.freeze([
  "schemaVersion",
  "metadata",
  "tierRows",
  "clusterRows",
  "battleFestival",
]);

const TIER_LIST_DECK_CONFIG_FIELDS = Object.freeze([
  "metadata",
  "scope",
  "deckId",
  "deckConfig",
]);

const BATTLE_FESTIVAL_SNAPSHOT_FIELDS = Object.freeze([
  "camps",
  "campShare",
  "rowsByCamp",
  "meritRows",
  "meritSummary",
]);

const BATTLE_FESTIVAL_MERIT_ROW_FIELDS = Object.freeze([
  "playerName",
  "camp",
  "firstSeenAt",
  "lastSeenAt",
  "highestMerit",
  "highestMeritSeenAt",
  "meritSampleCount",
  "observedMatchCount",
  "winCount",
  "lossCount",
  "drawCount",
  "unknownCount",
  "winRate",
  "decks",
  "pace",
]);

const BATTLE_FESTIVAL_MERIT_PACE_FIELDS = Object.freeze([
  "days",
  "samples",
  "projection",
]);

module.exports = {
  BATTLE_FESTIVAL_MERIT_PACE_FIELDS,
  BATTLE_FESTIVAL_MERIT_ROW_FIELDS,
  BATTLE_FESTIVAL_SNAPSHOT_FIELDS,
  TIER_LIST_DECK_CONFIG_ENDPOINT,
  TIER_LIST_DECK_CONFIG_FIELDS,
  TIER_LIST_SNAPSHOT_ENDPOINT,
  TIER_LIST_SNAPSHOT_ROOT_FIELDS,
};
