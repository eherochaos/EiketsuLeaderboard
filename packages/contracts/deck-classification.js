"use strict";

const CLASSIFICATION_STATUS = Object.freeze({
  CLASSIFIED: "classified",
  UNCLASSIFIED: "unclassified",
});

const UNCLASSIFIED_CATEGORY_ID = "unclassified";
const UNCLASSIFIED_CATEGORY_NAME = "Unclassified";
const CURRENT_CLASSIFIER_VERSION = "deck-classifier-v3";

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

module.exports = {
  CLASSIFICATION_STATUS,
  CURRENT_CLASSIFIER_VERSION,
  DECK_CLASSIFICATION_FIELDS,
  UNCLASSIFIED_CATEGORY_ID,
  UNCLASSIFIED_CATEGORY_NAME,
};
