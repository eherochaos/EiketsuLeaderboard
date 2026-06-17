import type { MatchSearchOptions, MatchSearchRequest, MatchSearchResponse } from "../types";
import { apiUrlWithVersion } from "./versionOptions";

const optionsUrl = import.meta.env.VITE_MATCH_SEARCH_OPTIONS_URL || "/api/match-search-options";
const searchUrl = import.meta.env.VITE_MATCH_SEARCH_URL || "/api/match-search";

export async function loadMatchSearchOptions(targetVersion = ""): Promise<MatchSearchOptions> {
  const response = await fetch(apiUrlWithVersion(optionsUrl, targetVersion), { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`对局搜索选项读取失败：${response.status}`);
  }

  return await response.json() as MatchSearchOptions;
}

export async function searchMatches(payload: MatchSearchRequest): Promise<MatchSearchResponse> {
  const response = await fetch(searchUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    cache: "no-store",
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(String(body.error || `对局搜索失败：${response.status}`));
  }

  return await response.json() as MatchSearchResponse;
}
