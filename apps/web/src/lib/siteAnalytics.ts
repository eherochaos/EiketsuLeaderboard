import type {
  SiteAnalyticsDeviceType,
  SiteAnalyticsEventPayload,
  SiteAnalyticsEventType,
  SiteAnalyticsSummary,
} from "../types";

const eventUrl = import.meta.env.VITE_SITE_ANALYTICS_EVENT_URL || "/api/site-analytics-event";
const summaryUrl = import.meta.env.VITE_SITE_ANALYTICS_SUMMARY_URL || "/api/site-analytics-summary";
const analyticsDisabled = import.meta.env.VITE_SITE_ANALYTICS_DISABLED === "1";
const visitorKey = "eiketsu.analytics.visitorId";
const sessionKey = "eiketsu.analytics.sessionId";

type SiteAnalyticsMetadata = NonNullable<SiteAnalyticsEventPayload["metadata"]>;

function browserReady(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function randomId(prefix: string): string {
  const cryptoId = window.crypto?.randomUUID?.().replace(/-/g, "");
  const fallback = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${cryptoId || fallback}`.slice(0, 80);
}

function storageId(storage: Storage, key: string, prefix: string): string {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const next = randomId(prefix);
  storage.setItem(key, next);
  return next;
}

function visitorId(): string {
  try {
    return storageId(window.localStorage, visitorKey, "visitor");
  } catch {
    return randomId("visitor");
  }
}

export function currentSiteVisitorId(): string {
  if (!browserReady()) return "";
  return visitorId();
}

function sessionId(): string {
  try {
    return storageId(window.sessionStorage, sessionKey, "session");
  } catch {
    return randomId("session");
  }
}

function deviceType(): SiteAnalyticsDeviceType {
  const width = window.innerWidth || 0;
  if (!width) return "unknown";
  if (width <= 760) return "mobile";
  if (width <= 1100) return "tablet";
  return "desktop";
}

function referrerOrigin(): string {
  try {
    return document.referrer ? new URL(document.referrer).origin : "";
  } catch {
    return "";
  }
}

function safeMetadata(metadata: SiteAnalyticsMetadata = {}): SiteAnalyticsMetadata {
  const result: SiteAnalyticsMetadata = {};
  for (const [key, value] of Object.entries(metadata).slice(0, 20)) {
    if (/token|cookie|secret|authorization|password/i.test(key)) continue;
    if (Array.isArray(value)) {
      result[key] = value.slice(0, 8).map((item) => String(item).slice(0, 120));
    } else if (typeof value === "string") {
      result[key] = value.slice(0, 160);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      result[key] = value;
    }
  }
  return result;
}

export function trackSiteEvent(
  eventType: SiteAnalyticsEventType,
  target = "",
  metadata: SiteAnalyticsMetadata = {}
): void {
  if (analyticsDisabled || !browserReady()) return;

  const payload: SiteAnalyticsEventPayload = {
    visitorId: visitorId(),
    sessionId: sessionId(),
    eventType,
    page: window.location.pathname || "unknown",
    target,
    metadata: safeMetadata(metadata),
    deviceType: deviceType(),
    viewport: {
      width: window.innerWidth || 0,
      height: window.innerHeight || 0,
    },
    language: navigator.language || "",
    referrerOrigin: referrerOrigin(),
    occurredAt: new Date().toISOString(),
  };
  const body = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon(eventUrl, blob)) return;
  }

  void fetch(eventUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    cache: "no-store",
  }).catch(() => {});
}

export function trackPageView(target = ""): void {
  trackSiteEvent("page_view", target || window.location.pathname || "unknown");
}

export async function loadSiteAnalyticsSummary(
  token: string,
  from: string,
  to: string,
  excludedVisitorIds: string[] = []
): Promise<SiteAnalyticsSummary> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  for (const visitorId of excludedVisitorIds) {
    if (visitorId) params.append("excludeVisitorId", visitorId);
  }
  const response = await fetch(`${summaryUrl}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(String(body.error || `站长统计读取失败：${response.status}`));
  }

  return await response.json() as SiteAnalyticsSummary;
}
