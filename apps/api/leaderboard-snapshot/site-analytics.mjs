import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export const SITE_ANALYTICS_EVENT_TYPES = [
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

const EVENT_TYPE_SET = new Set(SITE_ANALYTICS_EVENT_TYPES);
const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const SENSITIVE_KEY_PATTERN = /token|cookie|secret|authorization|password|credential/i;
const SENSITIVE_VALUE_PATTERN = /token=|cookie=|secret=|authorization:|bearer\s+/i;
const LOCAL_PATH_PATTERN = /[A-Za-z]:\\|\\\\|\/home\/|\/work\/|\/tmp\//i;

export class SiteAnalyticsRequestError extends Error {}

function clampInteger(value, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, parsed));
}

function sanitizeText(value, maxLength = 180) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";
  if (SENSITIVE_VALUE_PATTERN.test(text) || LOCAL_PATH_PATTERN.test(text)) {
    return "[redacted]";
  }

  return text.replace(/\?.*$/, "").slice(0, maxLength);
}

function sanitizeId(value) {
  const text = sanitizeText(value, 80);
  return /^[A-Za-z0-9_-]{8,80}$/.test(text) ? text : "";
}

function sanitizeKey(value) {
  const text = String(value ?? "")
    .replace(/[^A-Za-z0-9_.:-]/g, "")
    .slice(0, 48);
  if (!text || SENSITIVE_KEY_PATTERN.test(text)) return "";
  return text;
}

function sanitizeMetadataValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return sanitizeText(value, 160);
  if (Array.isArray(value)) {
    return value
      .slice(0, 8)
      .map((item) => sanitizeMetadataValue(item))
      .filter((item) => item !== null);
  }
  return null;
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 20)) {
    const key = sanitizeKey(rawKey);
    if (!key) continue;
    const sanitized = sanitizeMetadataValue(rawValue);
    if (sanitized === null || sanitized === "") continue;
    result[key] = sanitized;
  }
  return result;
}

function normalizeDate(value, fallback) {
  const date = new Date(value || fallback);
  if (Number.isNaN(date.getTime())) return new Date(fallback);
  return date;
}

function dateOnly(value) {
  return value.toISOString().slice(0, 10);
}

function parseDateStart(value, fallback) {
  if (!value) return fallback;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function parseDateEnd(value, fallback) {
  if (!value) return fallback;
  const date = new Date(`${String(value).slice(0, 10)}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function increment(map, key, amount = 1) {
  const safeKey = key || "-";
  map.set(safeKey, (map.get(safeKey) || 0) + amount);
}

function topCounts(map, keyName, limit = 20) {
  return Array.from(map.entries())
    .map(([key, count]) => ({ [keyName]: key, count }))
    .sort((left, right) => right.count - left.count || String(left[keyName]).localeCompare(String(right[keyName])))
    .slice(0, limit);
}

function emptySummary(now, fromDate, toDate) {
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    range: {
      from: dateOnly(fromDate),
      to: dateOnly(toDate),
      retentionDays: RETENTION_DAYS
    },
    totals: {
      visitors: 0,
      sessions: 0,
      events: 0,
      pageViews: 0
    },
    pages: [],
    events: [],
    devices: [],
    hours: [],
    visitors: [],
    recent: []
  };
}

export function normalizeSiteAnalyticsEvent(payload, options = {}) {
  const receivedAt = normalizeDate(options.now, new Date()).toISOString();
  const eventType = sanitizeText(payload?.eventType, 40);
  if (!EVENT_TYPE_SET.has(eventType)) {
    throw new SiteAnalyticsRequestError("site analytics eventType is not allowed");
  }

  const visitorId = sanitizeId(payload?.visitorId);
  const sessionId = sanitizeId(payload?.sessionId);
  if (!visitorId || !sessionId) {
    throw new SiteAnalyticsRequestError("site analytics visitorId and sessionId are required");
  }

  const occurredAt = normalizeDate(payload?.occurredAt, receivedAt).toISOString();
  const width = clampInteger(payload?.viewport?.width, 0, 10000);
  const height = clampInteger(payload?.viewport?.height, 0, 10000);
  const deviceType = ["desktop", "tablet", "mobile", "unknown"].includes(payload?.deviceType)
    ? payload.deviceType
    : "unknown";

  return {
    eventId: randomUUID(),
    visitorId,
    sessionId,
    eventType,
    page: sanitizeText(payload?.page || "unknown", 120) || "unknown",
    target: sanitizeText(payload?.target || "", 120),
    metadata: sanitizeMetadata(payload?.metadata),
    deviceType,
    viewport: {
      width: width ?? 0,
      height: height ?? 0
    },
    language: sanitizeText(payload?.language || "", 40),
    referrerOrigin: sanitizeText(payload?.referrerOrigin || "", 120),
    occurredAt,
    receivedAt
  };
}

export async function appendSiteAnalyticsEvent(filePath, payload, options = {}) {
  const event = normalizeSiteAnalyticsEvent(payload, options);
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

function visitorSummary(visitor) {
  return {
    visitorId: visitor.visitorId,
    sessions: visitor.sessions.size,
    events: visitor.events,
    pageViews: visitor.pageViews,
    firstSeen: visitor.firstSeen,
    lastSeen: visitor.lastSeen,
    topPage: topCounts(visitor.pages, "page", 1)[0]?.page || "-"
  };
}

export async function readSiteAnalyticsSummary(filePath, options = {}) {
  const now = normalizeDate(options.now, new Date());
  const defaultFrom = new Date(now.getTime() - 6 * DAY_MS);
  const fromDate = parseDateStart(options.from, defaultFrom);
  const toDate = parseDateEnd(options.to, now);
  const excludedVisitorIds = new Set(
    (Array.isArray(options.excludeVisitorIds) ? options.excludeVisitorIds : [])
      .map((visitorId) => sanitizeId(visitorId))
      .filter(Boolean)
  );
  const retentionStart = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  let text = "";

  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return emptySummary(now, fromDate, toDate);
    }
    throw error;
  }

  const visitors = new Set();
  const sessions = new Set();
  const pageVisitors = new Map();
  const pageCounts = new Map();
  const eventCounts = new Map();
  const deviceCounts = new Map();
  const hourCounts = new Map();
  const visitorMap = new Map();
  const recent = [];
  let eventTotal = 0;
  let pageViews = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (excludedVisitorIds.has(sanitizeId(event.visitorId))) continue;
    const occurredAt = normalizeDate(event.occurredAt, event.receivedAt || now);
    if (occurredAt < retentionStart || occurredAt < fromDate || occurredAt > toDate) continue;
    if (event.page === "/deploy-smoke") continue;

    eventTotal += 1;
    visitors.add(event.visitorId);
    sessions.add(event.sessionId);
    increment(eventCounts, event.eventType);
    increment(deviceCounts, event.deviceType || "unknown");
    increment(hourCounts, occurredAt.toISOString().slice(0, 13));

    if (event.eventType === "page_view") {
      pageViews += 1;
      increment(pageCounts, event.page);
      if (!pageVisitors.has(event.page)) pageVisitors.set(event.page, new Set());
      pageVisitors.get(event.page).add(event.visitorId);
    }

    if (!visitorMap.has(event.visitorId)) {
      visitorMap.set(event.visitorId, {
        visitorId: event.visitorId,
        sessions: new Set(),
        events: 0,
        pageViews: 0,
        firstSeen: occurredAt.toISOString(),
        lastSeen: occurredAt.toISOString(),
        pages: new Map()
      });
    }
    const visitor = visitorMap.get(event.visitorId);
    visitor.sessions.add(event.sessionId);
    visitor.events += 1;
    if (event.eventType === "page_view") {
      visitor.pageViews += 1;
      increment(visitor.pages, event.page);
    }
    if (occurredAt.toISOString() < visitor.firstSeen) visitor.firstSeen = occurredAt.toISOString();
    if (occurredAt.toISOString() > visitor.lastSeen) visitor.lastSeen = occurredAt.toISOString();

    recent.push({
      occurredAt: occurredAt.toISOString(),
      eventType: event.eventType,
      page: event.page || "-",
      target: event.target || "",
      deviceType: event.deviceType || "unknown",
      visitorId: event.visitorId
    });
  }

  const pages = Array.from(pageCounts.entries())
    .map(([page, count]) => ({
      page,
      count,
      visitors: pageVisitors.get(page)?.size || 0
    }))
    .sort((left, right) => right.count - left.count || left.page.localeCompare(right.page))
    .slice(0, 20);

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    range: {
      from: dateOnly(fromDate),
      to: dateOnly(toDate),
      retentionDays: RETENTION_DAYS
    },
    totals: {
      visitors: visitors.size,
      sessions: sessions.size,
      events: eventTotal,
      pageViews
    },
    pages,
    events: topCounts(eventCounts, "eventType", 20),
    devices: topCounts(deviceCounts, "deviceType", 10),
    hours: topCounts(hourCounts, "hour", 72).sort((left, right) => left.hour.localeCompare(right.hour)),
    visitors: Array.from(visitorMap.values())
      .map(visitorSummary)
      .sort((left, right) => right.events - left.events || right.lastSeen.localeCompare(left.lastSeen))
      .slice(0, 50),
    recent: recent
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 50)
  };
}
