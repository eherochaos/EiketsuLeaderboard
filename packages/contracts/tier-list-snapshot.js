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

module.exports = {
  BATTLE_FESTIVAL_SNAPSHOT_FIELDS,
  TIER_LIST_DECK_CONFIG_ENDPOINT,
  TIER_LIST_DECK_CONFIG_FIELDS,
  TIER_LIST_SNAPSHOT_ENDPOINT,
  TIER_LIST_SNAPSHOT_ROOT_FIELDS,
};
