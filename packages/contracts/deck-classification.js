"use strict";

const CLASSIFICATION_STATUS = Object.freeze({
  CLASSIFIED: "classified",
  UNCLASSIFIED: "unclassified",
});

const CATEGORY_REGISTRY_STATUS = Object.freeze({
  ACTIVE: "active",
  INACTIVE: "inactive",
});

const UNCLASSIFIED_CATEGORY_ID = "unclassified";
const UNCLASSIFIED_CATEGORY_NAME = "Unclassified";
const CURRENT_CLASSIFIER_VERSION = "deck-classifier-v3";
const CURRENT_CATEGORY_REGISTRY_VERSION = "category-registry-v1";

const DECK_CLASSIFICATION_FIELDS = Object.freeze([
  "deckId",
  "categoryId",
  "categoryName",
  "primaryFaction",
  "primaryCoreCardId",
  "primaryCoreCardName",
  "secondaryAxisCardId",
  "secondaryAxisCardName",
  "secondaryAxisReason",
  "partnerCardIds",
  "partnerCardNames",
  "deckType",
  "status",
  "confidence",
  "needsReview",
  "evidence",
  "classifierVersion",
  "classifiedAt",
]);

const CATEGORY_REGISTRY_FIELDS = Object.freeze([
  "categoryId",
  "categoryName",
  "aliases",
  "primaryCoreCardId",
  "primaryCoreCardName",
  "secondaryAxisCardId",
  "secondaryAxisCardName",
  "deckType",
  "status",
  "firstSeenAt",
  "lastSeenAt",
  "lastSampleCount",
  "lastWinRate",
  "seenRunCount",
  "inactiveSince",
]);

module.exports = {
  CATEGORY_REGISTRY_FIELDS,
  CATEGORY_REGISTRY_STATUS,
  CLASSIFICATION_STATUS,
  CURRENT_CATEGORY_REGISTRY_VERSION,
  CURRENT_CLASSIFIER_VERSION,
  DECK_CLASSIFICATION_FIELDS,
  UNCLASSIFIED_CATEGORY_ID,
  UNCLASSIFIED_CATEGORY_NAME,
};
