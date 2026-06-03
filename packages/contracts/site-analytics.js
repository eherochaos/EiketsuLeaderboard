"use strict";

const SITE_ANALYTICS_EVENT_ENDPOINT = "/api/site-analytics-event";
const SITE_ANALYTICS_SUMMARY_ENDPOINT = "/api/site-analytics-summary";
const SITE_ANALYTICS_EVENT_TYPES = [
  "page_view",
  "nav_click",
  "search",
  "filter_change",
  "video_open",
  "deck_config_open",
  "card_picker_open",
  "card_select",
  "card_remove"
];

module.exports = {
  SITE_ANALYTICS_EVENT_ENDPOINT,
  SITE_ANALYTICS_EVENT_TYPES,
  SITE_ANALYTICS_SUMMARY_ENDPOINT,
};
