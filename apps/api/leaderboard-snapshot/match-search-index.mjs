import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const DEFAULT_LEGACY_ROOT = resolve("apps/api/data/legacy-service");
const DEFAULT_SNAPSHOT_FILE = resolve("apps/api/data/leaderboard-snapshot.json");
const DEFAULT_INDEX_FILE = resolve("apps/api/data/match-search-index.json");
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const OFFICIAL_ASSET_BASE_URL = "https://image.eiketsu-taisen.net/";
const OFFICIAL_FACTION_ORDER = ["蒼", "緋", "碧", "玄", "紫", "琥", "黄"];
const OFFICIAL_CARD_TYPE_PREFIXES = new Set(["ST", "EX", "PL"]);
const CARD_UNIT_TYPE_REPAIRS = {
  "妲嶅叺": "槍兵",
  "寮撳叺": "弓兵",
  "楱庡叺": "騎兵",
  "鍓ｈ豹": "剣豪",
  "閴勭牪闅?": "鉄砲隊",
  "閴勭牪闅�": "鉄砲隊"
};

export class MatchSearchRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "MatchSearchRequestError";
  }
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function csvParts(row) {
  return String(row || "").split(",");
}

function indexedLabels(rows, labelIndex = 1) {
  return (rows || []).map((row) => csvParts(row)[labelIndex] || "");
}

function officialDatalistAssetTemplates(data) {
  const templates = {};
  for (const row of data?.path || []) {
    const [name, prefix, suffix] = csvParts(row);
    if (!name || !prefix || !suffix) continue;
    templates[name] = { prefix, suffix };
  }
  return templates;
}

function officialDatalistAssetUrl(templates, name, assetCode) {
  const template = templates[name];
  const code = String(assetCode || "").trim();
  if (!template || !code) return "";
  return `${OFFICIAL_ASSET_BASE_URL}${template.prefix}${encodeURIComponent(code)}${template.suffix}`;
}

function officialDatalistSkills(rawSkillIndexes, skillLabels) {
  const values = Array.isArray(rawSkillIndexes) ? rawSkillIndexes : String(rawSkillIndexes || "").split(":");
  return values
    .map((value) => String(value).trim())
    .filter((value) => value && value !== "-1")
    .map((value) => skillLabels[toNumber(value)] || "")
    .filter(Boolean);
}

function officialDatalistCardCode(fields, colorLabels) {
  const type = String(fields[8] || "").trim();
  const serial = String(fields[12] || "").trim();
  if (!serial) return "";
  const prefix = OFFICIAL_CARD_TYPE_PREFIXES.has(type) ? type : colorLabels[toNumber(fields[5])] || "";
  return prefix ? `${prefix}${serial.padStart(3, "0")}` : "";
}

function officialDatalistCards(data) {
  const colorLabels = indexedLabels(data?.color);
  const periodLabels = indexedLabels(data?.period);
  const costLabels = indexedLabels(data?.cost);
  const unitTypeLabels = indexedLabels(data?.unitType);
  const skillLabels = indexedLabels(data?.skill);
  const assetTemplates = officialDatalistAssetTemplates(data);

  return (data?.general || []).map((row) => {
    const fields = csvParts(row);
    const imageKeys = {
      card_small: fields[0] || "",
      card_ds: fields[1] || "",
      card_face: fields[2] || ""
    };
    return {
      hash_id: fields[0] || "",
      card_code: officialDatalistCardCode(fields, colorLabels),
      name: fields[3] || "",
      faction: colorLabels[toNumber(fields[5])] || "",
      era: periodLabels[toNumber(fields[6])] || "",
      cost: costLabels[toNumber(fields[13])] || "",
      unitType: unitTypeLabels[toNumber(fields[15])] || "",
      force: fields[17] || "",
      intelligence: fields[18] || "",
      skills: officialDatalistSkills(fields.slice(19, 22), skillLabels),
      image_keys: imageKeys,
      image_url: officialDatalistAssetUrl(assetTemplates, "card_small", imageKeys.card_small)
    };
  }).filter((card) => card.hash_id);
}

function cardHashIds(card) {
  return [
    card.hash_id,
    card.hashId,
    card.card_id,
    card.cardId,
    card.card_hash,
    card.cardHash,
    card.canonical_hash,
    card.canonicalHash,
    card.gameplay_hash,
    card.gameplayHash,
    card.id,
    ...(Array.isArray(card.hash_ids) ? card.hash_ids : [])
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readOptionalJson(filePath, fallback = null) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readJsonl(filePath, predicate = () => true) {
  const rows = [];
  const reader = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed);
    if (predicate(row)) rows.push(row);
  }

  return rows;
}

async function writeJson(path, payload) {
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function mergeNonEmptyCardData(baseCard, overrideCard) {
  const merged = { ...baseCard };
  for (const [key, value] of Object.entries(overrideCard || {})) {
    if (value === "" || value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    merged[key] = value;
  }
  return merged;
}

function cardCatalogKeys(card) {
  const keys = cardHashIds(card);
  const cardCode = firstText(card?.card_code, card?.cardCode);
  const name = firstText(card?.name, card?.imageAlt);
  if (cardCode) keys.push(`card_code:${cardCode}`);
  if (cardCode && name) keys.push(`card_code_name:${cardCode}:${name}`);
  return Array.from(new Set(keys));
}

function snapshotCards(snapshot) {
  const rows = [
    ...(Array.isArray(snapshot?.tierRows) ? snapshot.tierRows : []),
    ...(Array.isArray(snapshot?.clusterRows) ? snapshot.clusterRows : []),
    ...(Array.isArray(snapshot?.home?.tierRows) ? snapshot.home.tierRows : []),
    ...(Array.isArray(snapshot?.home?.representativeDecks) ? snapshot.home.representativeDecks : [])
  ];
  const cards = Array.isArray(snapshot?.home?.featuredCards) ? [...snapshot.home.featuredCards] : [];
  for (const row of rows) {
    if (Array.isArray(row?.deckCards)) cards.push(...row.deckCards);
    if (Array.isArray(row?.clusterVariants)) {
      for (const variant of row.clusterVariants) {
        if (Array.isArray(variant?.deckCards)) cards.push(...variant.deckCards);
      }
    }
  }
  return cards;
}

async function loadCardCatalog(legacyRoot, snapshot = null) {
  const base = await readJson(resolve(legacyRoot, "cards/card_catalog.json"));
  const overlay = await readOptionalJson(resolve(legacyRoot, "cards/card_catalog_overlay.json"), { cards: [] });
  const officialDatalist = await readOptionalJson(resolve(legacyRoot, "cards/datalist_api_base.json"), null);
  const officialCards = officialDatalist ? officialDatalistCards(officialDatalist) : [];
  const officialAssetTemplates = officialDatalist ? officialDatalistAssetTemplates(officialDatalist) : {};
  const byHash = new Map();

  for (const card of [...(base.cards || []), ...(overlay.cards || []), ...officialCards, ...snapshotCards(snapshot)]) {
    for (const key of cardCatalogKeys(card)) {
      const merged = mergeNonEmptyCardData(byHash.get(key) || {}, card);
      if (!firstImageUrl(merged)) {
        const imageUrl = officialDatalistAssetUrl(officialAssetTemplates, "card_small", cardSmallAssetCode(merged));
        if (imageUrl) merged.image_url = imageUrl;
      }
      byHash.set(key, merged);
    }
  }

  return Object.fromEntries(byHash);
}

function fallbackCardSmallUrl(cardId) {
  const value = String(cardId || "").trim();
  if (!/^[a-f0-9]{32}$/i.test(value)) return "";
  return `${OFFICIAL_ASSET_BASE_URL}general/card_small/${encodeURIComponent(value)}.jpg`;
}

function normalizeFaction(raw) {
  const value = String(raw || "").trim();
  if (OFFICIAL_FACTION_ORDER.includes(value)) return value;
  const first = Array.from(value)[0] || "";
  if (OFFICIAL_FACTION_ORDER.includes(first)) return first;
  return "unknown";
}

function repairCardUnitType(value) {
  return CARD_UNIT_TYPE_REPAIRS[value] || value;
}

function cardSkillList(card) {
  const raw = card?.skills || card?.specials || card?.specialTraits || card?.special_traits || card?.abilities || [];
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(raw || "")
    .split(/[、,\s/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function jsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function cardSmallAssetCode(card) {
  for (const imageKeysKey of ["image_keys", "imageKeys", "image_keys_json"]) {
    const imageKeys = jsonObject(card?.[imageKeysKey]);
    const assetCode = firstText(imageKeys.card_small, imageKeys.cardSmall, imageKeys.card_small_code, imageKeys.cardSmallCode);
    if (assetCode) return assetCode;
  }
  return firstText(card?.card_small_code, card?.cardSmallCode);
}

function firstImageUrl(card) {
  for (const containerKey of ["image_urls", "imageUrls", "images", "image_urls_json"]) {
    const imageUrls = jsonObject(card?.[containerKey]);
    for (const key of [
      "card_small",
      "cardSmall",
      "card_small_url",
      "cardSmallUrl",
      "small",
      "card_ds",
      "cardDs",
      "card_ds_url",
      "cardDsUrl",
      "card_face",
      "cardFace",
      "card_face_url",
      "cardFaceUrl",
      "face"
    ]) {
      const url = String(imageUrls[key] || "").trim();
      if (/^https?:\/\//.test(url)) return url;
    }
  }

  for (const key of ["image_url", "imageUrl", "card_small_url", "cardSmallUrl", "card_ds_url", "cardDsUrl", "card_face_url", "cardFaceUrl"]) {
    const url = String(card?.[key] || "").trim();
    if (/^https?:\/\//.test(url)) return url;
  }

  return "";
}

function cardView(cardId, cardCatalog, usageCount = 0) {
  const card = cardCatalog[cardId] || {};
  const name = firstText(card?.name, card?.card_code, String(cardId).slice(0, 8));
  const unitType = firstText(card?.unitType, card?.unit_type, card?.unitTypeName, card?.unit_type_name, card?.["兵種"], card?.["兵种"]);
  return {
    cardId,
    name,
    faction: normalizeFaction(card?.faction || card?.card_code),
    cardCode: firstText(card?.card_code, card?.cardCode),
    cost: firstText(card?.cost, card?.cost_label, card?.costValue, card?.cost_value),
    unitType: repairCardUnitType(unitType),
    force: firstText(card?.force, card?.power, card?.strength, card?.attack, card?.["武力"]),
    intelligence: firstText(card?.intelligence, card?.intellect, card?.wisdom, card?.["知力"]),
    era: firstText(card?.era, card?.period, card?.timePeriod, card?.eraName, card?.periodName),
    skills: cardSkillList(card),
    imageUrl: firstImageUrl(card) || fallbackCardSmallUrl(cardId),
    imageAlt: name,
    usageCount
  };
}

function formalDate(value) {
  return String(value || "").slice(0, 10);
}

function matchInSnapshotScope(match, metadata) {
  if (metadata.targetVersion && match.version !== metadata.targetVersion) return false;

  const playedDate = formalDate(match.played_at || match.created_at);
  if (metadata.dateFrom && playedDate && playedDate < metadata.dateFrom) return false;
  if (metadata.dateTo && playedDate && playedDate > metadata.dateTo) return false;

  return true;
}

function firstUrl(...values) {
  return values
    .map((value) => String(value || "").trim())
    .find((value) => /^https?:\/\//.test(value)) || "";
}

function matchVideoUrl(match) {
  return firstUrl(match?.play_url, match?.m3u8_url, match?.detail_url, match?.source_url);
}

function matchHasVideo(match) {
  return Boolean(firstUrl(match?.play_url, match?.m3u8_url) || String(match?.replay_id || "").trim());
}

function matchSideKey(matchId, sideIndex) {
  return `${matchId}:${sideIndex}`;
}

function sideRole(side) {
  const role = String(side?.role || "").trim();
  if (role === "player" || role === "enemy") return role;
  return toNumber(side?.side_index) === 0 ? "player" : "enemy";
}

function normalizedSideResult(value) {
  const result = String(value || "").trim();
  return ["win", "loss", "draw"].includes(result) ? result : "";
}

function weaponActivation(summary) {
  const text = String(summary || "");
  if (text.includes("未発動")) return "no";
  if (/\d+(?:\.\d+)?\s*c\b/i.test(text) || text.includes("発動")) return "yes";
  return "unknown";
}

function strategyCountForSlot(bySlot, index, slot) {
  if (Array.isArray(bySlot)) return toNumber(bySlot[index]);
  if (bySlot && typeof bySlot === "object") return toNumber(bySlot[slot] ?? bySlot[String(slot)]);
  return 0;
}

function sideIndexFromDeck(deck) {
  return toNumber(deck.side_index);
}

function deckCardIds(deck, unitsByDeckId) {
  const units = (unitsByDeckId.get(toNumber(deck?.id)) || [])
    .slice()
    .sort((left, right) => toNumber(left.slot) - toNumber(right.slot));
  if (units.length) {
    return units
      .map((unit) => String(unit.card_hash || "").trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  return String(deck?.deck_fingerprint || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function buildIndexedSide(side, deck, unitsByDeckId) {
  const cardIds = deckCardIds(deck, unitsByDeckId);
  const bySlot = side?.profile_json?.battle_stats?.strategy_count?.by_slot;
  const units = (unitsByDeckId.get(toNumber(deck?.id)) || [])
    .slice()
    .sort((left, right) => toNumber(left.slot) - toNumber(right.slot));
  const strategyCounts = {};

  cardIds.forEach((cardId, index) => {
    const unit = units[index] || {};
    strategyCounts[cardId] = strategyCountForSlot(bySlot, index, unit.slot ?? index + 1);
  });

  const weapon = side?.selected_json?.weapon || {};
  const weaponName = firstText(weapon?.name);
  const weaponSummary = firstText(weapon?.summary);
  const school = side?.selected_json?.school || {};

  return {
    result: normalizedSideResult(side?.result),
    playerName: firstText(side?.player_name),
    castleRate: firstText(side?.castle_rate),
    weaponName,
    weaponActivated: weaponName ? weaponActivation(weaponSummary) : "unknown",
    weaponSummary,
    schoolName: firstText(school?.name),
    cardIds,
    strategyCounts
  };
}

function addWeaponStats(stats, side) {
  const name = String(side?.weaponName || "").trim();
  if (!name) return;
  const entry = stats.get(name) || {
    name,
    usageCount: 0,
    activatedCount: 0,
    notActivatedCount: 0,
    unknownCount: 0
  };
  entry.usageCount += 1;
  if (side.weaponActivated === "yes") entry.activatedCount += 1;
  else if (side.weaponActivated === "no") entry.notActivatedCount += 1;
  else entry.unknownCount += 1;
  stats.set(name, entry);
}

function indexMetadata(snapshot, indexedMatches) {
  const metadata = snapshot?.metadata || {};
  return {
    sourceRunId: metadata.sourceRunId,
    sourceKind: metadata.sourceKind,
    targetVersion: metadata.targetVersion,
    dateFrom: metadata.dateFrom,
    dateTo: metadata.dateTo,
    updatedAt: metadata.updatedAt,
    sampleSize: metadata.sampleSize,
    indexedAt: new Date().toISOString(),
    matchCount: indexedMatches.length,
    videoMatchCount: indexedMatches.length
  };
}

export async function buildMatchSearchIndex(options = {}) {
  const legacyRoot = resolve(options.legacyRoot || DEFAULT_LEGACY_ROOT);
  const snapshotFile = resolve(options.snapshotFile || DEFAULT_SNAPSHOT_FILE);
  const snapshot = await readJson(snapshotFile);
  const metadata = snapshot.metadata || {};

  const matches = await readJsonl(
    resolve(legacyRoot, "tables/matches.jsonl"),
    (match) => matchInSnapshotScope(match, metadata) && matchHasVideo(match)
  );
  const matchById = new Map(matches.map((match) => [toNumber(match.id), match]));
  const matchIds = new Set(matchById.keys());

  const matchDecks = await readJsonl(
    resolve(legacyRoot, "tables/match_decks.jsonl"),
    (deck) => matchIds.has(toNumber(deck.match_id))
  );
  const deckBySideKey = new Map(matchDecks.map((deck) => [matchSideKey(deck.match_id, deck.side_index), deck]));
  const deckRowIds = new Set(matchDecks.map((deck) => toNumber(deck.id)));

  const sides = await readJsonl(
    resolve(legacyRoot, "tables/match_sides.jsonl"),
    (side) => matchIds.has(toNumber(side.match_id))
  );
  const sidesByMatch = new Map();
  for (const side of sides) {
    const matchId = toNumber(side.match_id);
    if (!sidesByMatch.has(matchId)) sidesByMatch.set(matchId, []);
    sidesByMatch.get(matchId).push(side);
  }

  const units = await readJsonl(
    resolve(legacyRoot, "tables/match_deck_units.jsonl"),
    (unit) => deckRowIds.has(toNumber(unit.deck_id))
  );
  const unitsByDeckId = new Map();
  for (const unit of units) {
    const deckId = toNumber(unit.deck_id);
    if (!unitsByDeckId.has(deckId)) unitsByDeckId.set(deckId, []);
    unitsByDeckId.get(deckId).push(unit);
  }

  const cardUsage = new Map();
  const weaponStats = new Map();
  const indexedMatches = [];

  for (const match of matches) {
    const matchId = toNumber(match.id);
    const matchSides = sidesByMatch.get(matchId) || [];
    const playerSide = matchSides.find((side) => sideRole(side) === "player");
    const enemySide = matchSides.find((side) => sideRole(side) === "enemy");
    if (!playerSide || !enemySide) continue;

    const playerDeck = deckBySideKey.get(matchSideKey(matchId, sideIndexFromDeck(playerSide)));
    const enemyDeck = deckBySideKey.get(matchSideKey(matchId, sideIndexFromDeck(enemySide)));
    if (!playerDeck || !enemyDeck) continue;

    const sideA = buildIndexedSide(playerSide, playerDeck, unitsByDeckId);
    const sideB = buildIndexedSide(enemySide, enemyDeck, unitsByDeckId);

    for (const cardId of [...sideA.cardIds, ...sideB.cardIds]) {
      cardUsage.set(cardId, (cardUsage.get(cardId) || 0) + 1);
    }
    addWeaponStats(weaponStats, sideA);
    addWeaponStats(weaponStats, sideB);

    indexedMatches.push({
      matchId: match.id,
      version: firstText(match.version),
      mode: firstText(match.mode),
      playedAt: firstText(match.played_at, match.created_at),
      videoUrl: matchVideoUrl(match),
      playUrl: firstUrl(match.play_url),
      detailUrl: firstUrl(match.detail_url, match.source_url),
      m3u8Url: firstUrl(match.m3u8_url),
      replayId: firstText(match.replay_id),
      sideA,
      sideB
    });
  }

  const cardCatalog = await loadCardCatalog(legacyRoot, snapshot);
  const cards = Array.from(cardUsage.entries())
    .map(([cardId, usageCount]) => cardView(cardId, cardCatalog, usageCount))
    .sort((left, right) => right.usageCount - left.usageCount || left.name.localeCompare(right.name, "ja"));
  const weapons = Array.from(weaponStats.values())
    .sort((left, right) => right.usageCount - left.usageCount || left.name.localeCompare(right.name, "ja"));

  return {
    schemaVersion: SCHEMA_VERSION,
    metadata: indexMetadata(snapshot, indexedMatches),
    cards,
    weapons,
    matches: indexedMatches
  };
}

function tempIndexPath(outputPath) {
  return resolve(dirname(outputPath), `.${basename(outputPath)}.${Date.now()}.${process.pid}.tmp`);
}

export async function refreshMatchSearchIndex(options = {}) {
  const env = typeof process !== "undefined" ? process.env : {};
  const outputPath = resolve(options.outputPath || env.LEADERBOARD_MATCH_SEARCH_INDEX_FILE || DEFAULT_INDEX_FILE);
  const temporaryPath = tempIndexPath(outputPath);
  await mkdir(dirname(outputPath), { recursive: true });

  try {
    const index = await buildMatchSearchIndex({
      legacyRoot: options.legacyRoot || env.LEADERBOARD_LEGACY_ROOT || DEFAULT_LEGACY_ROOT,
      snapshotFile: options.snapshotFile || env.LEADERBOARD_SNAPSHOT_FILE || DEFAULT_SNAPSHOT_FILE
    });
    await writeJson(temporaryPath, index);
    await rename(temporaryPath, outputPath);
    return { outputPath, index };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function normalizePositiveInt(value, fallback, maxValue = Number.MAX_SAFE_INTEGER) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.min(number, maxValue);
}

function normalizeCardIds(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean))).slice(0, 8);
}

function normalizeStrategyFilter(value) {
  return ["used", "unused"].includes(value) ? value : "any";
}

function normalizeResultFilter(value) {
  return ["win", "loss", "draw"].includes(value) ? value : "any";
}

function normalizeWeaponActivationFilter(value) {
  return ["yes", "no"].includes(value) ? value : "any";
}

function normalizeSideRequest(value) {
  const side = value && typeof value === "object" ? value : {};
  const cardIds = normalizeCardIds(side.cardIds);
  const strategyByCard = {};
  if (side.strategyByCard && typeof side.strategyByCard === "object") {
    for (const cardId of cardIds) {
      strategyByCard[cardId] = normalizeStrategyFilter(side.strategyByCard[cardId]);
    }
  }
  return {
    cardIds,
    strategyByCard,
    weaponName: firstText(side.weaponName),
    weaponActivated: normalizeWeaponActivationFilter(side.weaponActivated),
    result: normalizeResultFilter(side.result)
  };
}

function normalizeSearchRequest(request = {}) {
  const payload = request && typeof request === "object" ? request : {};
  const normalized = {
    page: normalizePositiveInt(payload.page, 1),
    pageSize: normalizePositiveInt(payload.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    cardMatchMode: payload.cardMatchMode === "any" ? "any" : "all",
    sideA: normalizeSideRequest(payload.sideA),
    sideB: normalizeSideRequest(payload.sideB)
  };

  if (!hasAnyFilter(normalized.sideA) && !hasAnyFilter(normalized.sideB)) {
    throw new MatchSearchRequestError("at least one search condition is required");
  }

  return normalized;
}

function hasAnyFilter(side) {
  return side.cardIds.length > 0
    || Boolean(side.weaponName)
    || side.weaponActivated !== "any"
    || side.result !== "any";
}

function cardStrategyMatches(side, cardId, filter) {
  if (!side.cardIds.includes(cardId)) return false;
  if (filter === "used") return toNumber(side.strategyCounts?.[cardId]) > 0;
  if (filter === "unused") return toNumber(side.strategyCounts?.[cardId]) === 0;
  return true;
}

function sideCardsMatch(side, filter, cardMatchMode) {
  if (!filter.cardIds.length) return true;
  const checks = filter.cardIds.map((cardId) => cardStrategyMatches(side, cardId, filter.strategyByCard[cardId] || "any"));
  return cardMatchMode === "any" ? checks.some(Boolean) : checks.every(Boolean);
}

function sideMatches(side, filter, cardMatchMode) {
  if (!sideCardsMatch(side, filter, cardMatchMode)) return false;
  if (filter.weaponName && side.weaponName !== filter.weaponName) return false;
  if (filter.weaponActivated !== "any" && side.weaponActivated !== filter.weaponActivated) return false;
  if (filter.result !== "any" && side.result !== filter.result) return false;
  return true;
}

function compareMatches(left, right) {
  const leftTime = Date.parse(String(left.playedAt || "").replace(" ", "T"));
  const rightTime = Date.parse(String(right.playedAt || "").replace(" ", "T"));
  const timeDiff = (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  return timeDiff || toNumber(right.matchId) - toNumber(left.matchId);
}

function selectedStrategyCounts(side, filter) {
  return Object.fromEntries(filter.cardIds.map((cardId) => [cardId, toNumber(side.strategyCounts?.[cardId])]));
}

function responseSide(side, filter, cardsById) {
  return {
    result: side.result || "",
    playerName: side.playerName || "",
    castleRate: side.castleRate || "",
    weaponName: side.weaponName || "",
    weaponActivated: side.weaponActivated || "unknown",
    weaponSummary: side.weaponSummary || "",
    schoolName: side.schoolName || "",
    cards: side.cardIds.map((cardId) => cardsById.get(cardId)).filter(Boolean),
    selectedStrategyCounts: selectedStrategyCounts(side, filter)
  };
}

function responseItem(match, request, cardsById) {
  return {
    matchId: match.matchId,
    version: match.version || "",
    mode: match.mode || "",
    playedAt: match.playedAt || "",
    videoUrl: match.videoUrl || match.playUrl || match.detailUrl || match.m3u8Url || "",
    playUrl: match.playUrl || "",
    detailUrl: match.detailUrl || "",
    m3u8Url: match.m3u8Url || "",
    replayId: match.replayId || "",
    sideA: responseSide(match.sideA, request.sideA, cardsById),
    sideB: responseSide(match.sideB, request.sideB, cardsById)
  };
}

export function matchSearchOptions(index) {
  return {
    schemaVersion: SCHEMA_VERSION,
    metadata: index.metadata,
    cards: index.cards || [],
    weapons: index.weapons || []
  };
}

export function searchMatchIndex(index, requestPayload) {
  const request = normalizeSearchRequest(requestPayload);
  const cardsById = new Map((index.cards || []).map((card) => [card.cardId, card]));
  const matches = (index.matches || [])
    .filter((match) => sideMatches(match.sideA || {}, request.sideA, request.cardMatchMode))
    .filter((match) => sideMatches(match.sideB || {}, request.sideB, request.cardMatchMode))
    .slice()
    .sort(compareMatches);
  const start = (request.page - 1) * request.pageSize;
  const items = matches
    .slice(start, start + request.pageSize)
    .map((match) => responseItem(match, request, cardsById));

  return {
    schemaVersion: SCHEMA_VERSION,
    metadata: index.metadata,
    total: matches.length,
    page: request.page,
    pageSize: request.pageSize,
    items
  };
}

async function main() {
  const { outputPath, index } = await refreshMatchSearchIndex();
  console.log(`matchSearchIndex=${outputPath}`);
  console.log(
    `sourceRun=${index.metadata.sourceRunId || ""} matches=${index.metadata.matchCount} cards=${index.cards.length} weapons=${index.weapons.length} indexedAt=${index.metadata.indexedAt}`
  );
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
