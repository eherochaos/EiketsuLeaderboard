import type { LeaderboardSnapshot, LeaderboardVersionManifest } from "../types";

const versionOptionsUrl = import.meta.env.VITE_LEADERBOARD_VERSION_OPTIONS_URL || "/api/version-options";
const versionParamName = "version";
type SnapshotWithMetadata = { metadata: LeaderboardSnapshot["metadata"] };

function freshUrl(value: string): string {
  const url = new URL(value, window.location.origin);
  url.searchParams.set("_ts", String(Date.now()));
  return url.toString();
}

export function apiUrlWithVersion(value: string, targetVersion = ""): string {
  const url = new URL(value, window.location.origin);
  if (targetVersion) {
    url.searchParams.set(versionParamName, targetVersion);
  }
  url.searchParams.set("_ts", String(Date.now()));
  return url.toString();
}

export function readVersionParam(): string {
  if (typeof window === "undefined") return "";
  return new URL(window.location.href).searchParams.get(versionParamName)?.trim() || "";
}

export function writeVersionParam(targetVersion: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (targetVersion) {
    url.searchParams.set(versionParamName, targetVersion);
  } else {
    url.searchParams.delete(versionParamName);
  }
  window.history.replaceState(window.history.state, "", url.toString());
  window.dispatchEvent(new CustomEvent("eiketsu-version-change", { detail: targetVersion }));
}

export function versionedPageHref(href: string, targetVersion: string): string {
  if (!targetVersion || !["/leaderboard/", "/tier-list/", "/match-search/"].includes(href)) return href;
  const url = new URL(href, window.location.origin);
  url.searchParams.set(versionParamName, targetVersion);
  return `${url.pathname}${url.search}`;
}

export function selectedVersionFromManifest(manifest: LeaderboardVersionManifest | null, requestedVersion = ""): string {
  const versions = manifest?.versions ?? [];
  if (requestedVersion && versions.some((item) => item.targetVersion === requestedVersion)) {
    return requestedVersion;
  }
  if (manifest?.currentTargetVersion && versions.some((item) => item.targetVersion === manifest.currentTargetVersion)) {
    return manifest.currentTargetVersion;
  }
  return versions[0]?.targetVersion || "";
}

export function manifestFromSnapshot(snapshot: SnapshotWithMetadata): LeaderboardVersionManifest {
  const metadata = snapshot.metadata;
  const targetVersion = metadata.targetVersion || "";
  return {
    schemaVersion: 1,
    currentTargetVersion: targetVersion,
    versions: targetVersion ? [{
      targetVersion,
      sourceRunId: metadata.sourceRunId,
      dateFrom: metadata.dateFrom,
      dateTo: metadata.dateTo,
      updatedAt: metadata.updatedAt,
      sampleSize: metadata.sampleSize,
      current: true,
    }] : [],
  };
}

export async function loadVersionOptions(): Promise<LeaderboardVersionManifest> {
  const response = await fetch(freshUrl(versionOptionsUrl), { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`版本选项读取失败：${response.status}`);
  }

  return await response.json() as LeaderboardVersionManifest;
}
