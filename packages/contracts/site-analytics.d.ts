export const SITE_ANALYTICS_EVENT_ENDPOINT: string;
export const SITE_ANALYTICS_SUMMARY_ENDPOINT: string;
export const SITE_ANALYTICS_EVENT_TYPES: readonly SiteAnalyticsEventType[];

export type SiteAnalyticsEventType =
  | "page_view"
  | "nav_click"
  | "search"
  | "filter_change"
  | "video_open"
  | "deck_config_open"
  | "card_picker_open"
  | "card_select"
  | "card_remove";

export type SiteAnalyticsDeviceType = "desktop" | "tablet" | "mobile" | "unknown";

export interface SiteAnalyticsEventPayload {
  visitorId: string;
  sessionId: string;
  eventType: SiteAnalyticsEventType;
  page: string;
  target?: string;
  metadata?: Record<string, string | number | boolean | null | string[]>;
  deviceType: SiteAnalyticsDeviceType;
  viewport: {
    width: number;
    height: number;
  };
  language?: string;
  referrerOrigin?: string;
  occurredAt: string;
}

export interface SiteAnalyticsSummary {
  schemaVersion: number;
  generatedAt: string;
  range: {
    from: string;
    to: string;
    retentionDays: number;
  };
  totals: {
    visitors: number;
    sessions: number;
    events: number;
    pageViews: number;
  };
  pages: Array<{
    page: string;
    count: number;
    visitors: number;
  }>;
  events: Array<{
    eventType: SiteAnalyticsEventType | string;
    count: number;
  }>;
  devices: Array<{
    deviceType: SiteAnalyticsDeviceType | string;
    count: number;
  }>;
  hours: Array<{
    hour: string;
    count: number;
  }>;
  visitors: Array<{
    visitorId: string;
    sessions: number;
    events: number;
    pageViews: number;
    firstSeen: string;
    lastSeen: string;
    topPage: string;
  }>;
  recent: Array<{
    occurredAt: string;
    eventType: SiteAnalyticsEventType | string;
    page: string;
    target: string;
    deviceType: SiteAnalyticsDeviceType | string;
    visitorId: string;
  }>;
}
