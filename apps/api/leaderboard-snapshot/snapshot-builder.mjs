import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { VERSION_MANIFEST_SCHEMA_VERSION } from "./version-files.mjs";

const require = createRequire(import.meta.url);
const { classifyAnalysisDecks } = require("../deck-classification/eiketsu-analysis-deck.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, "..");
const repoRoot = resolve(apiRoot, "../..");
const defaultLegacyRoot = resolve(apiRoot, "data/legacy-service");
let legacyRoot = defaultLegacyRoot;
let diagnosticsEnabled = false;
let unitTypeRepairWarnings = new Set();

const OFFICIAL_FACTION_ORDER = ["蒼", "緋", "碧", "玄", "紫", "琥", "黄"];
const FACTION_COLORS = {
  蒼: "#1e3ca0",
  緋: "#b4191b",
  碧: "#007332",
  玄: "#636261",
  紫: "#8c0078",
  琥: "#ff7800",
  黄: "#c9a227",
  unknown: "#636261"
};

const CARD_UNIT_TYPE_REPAIRS = {
  "妲嶅叺": "槍兵",
  "寮撳叺": "弓兵",
  "楱庡叺": "騎兵",
  "鍓ｈ豹": "剣豪",
  "閴勭牪闅?": "鉄砲隊",
  "閴勭牪闅�": "鉄砲隊"
};

const OFFICIAL_CARD_TYPE_PREFIXES = new Set(["ST", "EX", "PL"]);
const OFFICIAL_ASSET_BASE_URL = "https://image.eiketsu-taisen.net/";
const BATTLE_FESTIVAL_CAMP_KEYS = ["\u6240\u5c5e\u9663\u55b6", "\u6240\u5c5e\u9635\u8425"];
const BATTLE_FESTIVAL_MERIT_KEY = "\u6226\u529f";
const BATTLE_FESTIVAL_PLAYER_DECK_LIMIT = 5;
const BATTLE_FESTIVAL_FIRST_MATCH_MINUTES = 3;
const FESTIVAL_PERIOD_SOURCE_OFFICIAL = "official";
const BATTLE_FESTIVAL_MODES = new Set(["戦祭り", "戦祭", "戰祭", "战祭"]);
const VARIANT_BASE_CARD_CODE_FIELDS = ["variant_base_card_code", "variantBaseCardCode"];
const VARIANT_KIND_FIELDS = ["variant_kind", "variantKind"];

function csvParts(row) {
  return String(row || "").split(",");
}

function indexedLabels(rows, labelIndex = 1) {
  return (rows || []).map((row) => csvParts(row)[labelIndex] || "");
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

function officialVariantMatchKey(fields) {
  const extraSkills = fields.slice(19, 22)
    .map((value) => String(value || "").trim())
    .filter((value) => value && value !== "-1")
    .sort();
  return [
    fields[16],
    fields[3],
    fields[5],
    fields[6],
    fields[13],
    fields[15],
    fields[17],
    fields[18],
    extraSkills.join(":"),
    fields[22]
  ].map((value) => String(value || "").trim()).join("\u0000");
}

function officialDatalistCards(data) {
  const colorLabels = indexedLabels(data?.color);
  const periodLabels = indexedLabels(data?.period);
  const costLabels = indexedLabels(data?.cost);
  const unitTypeLabels = indexedLabels(data?.unitType);
  const skillLabels = indexedLabels(data?.skill);
  const cardTypeLabels = indexedLabels(data?.cardType);

  const entries = (data?.general || []).map((row) => {
    const fields = csvParts(row);
    const card = { hash_id: fields[0] || "" };
    const values = {
      card_code: officialDatalistCardCode(fields, colorLabels),
      name: fields[3] || "",
      faction: colorLabels[toNumber(fields[5])] || "",
      era: periodLabels[toNumber(fields[6])] || "",
      cost: costLabels[toNumber(fields[13])] || "",
      unitType: unitTypeLabels[toNumber(fields[15])] || "",
      force: fields[17] || "",
      intelligence: fields[18] || "",
      skills: officialDatalistSkills(fields.slice(19, 22), skillLabels)
    };

    for (const [key, value] of Object.entries(values)) {
      if (value) card[key] = value;
    }

    card.image_keys = {
      card_small: fields[0] || "",
      card_ds: fields[1] || "",
      card_face: fields[2] || ""
    };
    return {
      card,
      cardType: cardTypeLabels[toNumber(fields[11])] || "",
      variantMatchKey: officialVariantMatchKey(fields)
    };
  }).filter((entry) => entry.card.hash_id);

  const baseCardsByKey = new Map();
  const baseCardTypePriority = new Map([["通常", 0], ["スターター", 1]]);
  for (const entry of entries) {
    if (!baseCardTypePriority.has(entry.cardType)) continue;
    if (!baseCardsByKey.has(entry.variantMatchKey)) baseCardsByKey.set(entry.variantMatchKey, []);
    baseCardsByKey.get(entry.variantMatchKey).push(entry);
  }

  for (const entry of entries) {
    if (entry.cardType !== "EX" && entry.cardType !== "PL") continue;
    const base = (baseCardsByKey.get(entry.variantMatchKey) || [])
      .slice()
      .sort((left, right) => {
        return baseCardTypePriority.get(left.cardType) - baseCardTypePriority.get(right.cardType)
          || left.card.card_code.localeCompare(right.card.card_code, "ja");
      })[0];
    if (!base || base.card.card_code === entry.card.card_code) continue;
    entry.card.variant_base_card_code = base.card.card_code;
    entry.card.variant_kind = "reskin";
  }

  return entries.map((entry) => entry.card);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function percent(value) {
  return Number((toNumber(value) * 100).toFixed(1));
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

async function readOptionalJsonl(filePath, predicate = () => true) {
  try {
    return await readJsonl(filePath, predicate);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function latestCompletedRun(runs) {
  const candidates = runs
    .filter((run) => run.status === "completed")
    .filter((run) => toNumber(run.counts_json?.deck_groups_exported) > 0)
    .sort((left, right) => toNumber(right.id) - toNumber(left.id));

  if (!candidates.length) {
    throw new Error("No completed analysis run with exported deck groups.");
  }

  return candidates[0];
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

function cardCatalogKeys(card) {
  const keys = cardHashIds(card);
  const cardCode = firstText(card?.card_code, card?.cardCode);
  const name = labelName(firstText(card?.name, card?.label));
  if (cardCode) keys.push(`card_code:${cardCode}`);
  if (cardCode && name) keys.push(`card_code_name:${cardCode}:${name}`);
  return Array.from(new Set(keys));
}

function hasOwnCardField(card, fields) {
  return fields.some((field) => Object.prototype.hasOwnProperty.call(card || {}, field));
}

function cardDeclaresVariantMetadata(card) {
  return hasOwnCardField(card, [...VARIANT_BASE_CARD_CODE_FIELDS, ...VARIANT_KIND_FIELDS]);
}

function mergeExplicitCardData(baseCard, overrideCard) {
  const merged = mergeNonEmptyCardData(baseCard, overrideCard);
  for (const field of [...VARIANT_BASE_CARD_CODE_FIELDS, ...VARIANT_KIND_FIELDS]) {
    if (Object.prototype.hasOwnProperty.call(overrideCard || {}, field)) merged[field] = overrideCard[field];
  }
  return merged;
}

async function loadCardCatalog() {
  const base = await readJson(resolve(legacyRoot, "cards/card_catalog.json"));
  const overlay = await readJson(resolve(legacyRoot, "cards/card_catalog_overlay.json"));
  const officialDatalist = await readOptionalJson(resolve(legacyRoot, "cards/datalist_api_base.json"), null);
  const officialCards = officialDatalist ? officialDatalistCards(officialDatalist) : [];
  const byHash = new Map();

  for (const card of [...(base.cards || []), ...(overlay.cards || [])]) {
    for (const key of cardCatalogKeys(card)) {
      byHash.set(key, mergeExplicitCardData(byHash.get(key) || {}, card));
    }
  }

  for (const card of officialCards) {
    const inferredCard = { ...card };
    const hasExplicitVariantMetadata = cardCatalogKeys(card)
      .some((key) => cardDeclaresVariantMetadata(byHash.get(key)));
    if (hasExplicitVariantMetadata) {
      for (const field of [...VARIANT_BASE_CARD_CODE_FIELDS, ...VARIANT_KIND_FIELDS]) {
        delete inferredCard[field];
      }
    }
    for (const key of cardCatalogKeys(card)) {
      byHash.set(key, mergeNonEmptyCardData(byHash.get(key) || {}, inferredCard));
    }
  }

  return Object.fromEntries(byHash);
}

function catalogCardFor(cardCatalog, cardId, card = {}) {
  for (const key of [String(cardId || "").trim(), ...cardCatalogKeys(card)]) {
    if (key && cardCatalog[key]) return cardCatalog[key];
  }
  return {};
}

function normalizeFaction(raw) {
  const value = String(raw || "").trim();
  if (OFFICIAL_FACTION_ORDER.includes(value)) return value;
  const first = Array.from(value)[0] || "";
  if (OFFICIAL_FACTION_ORDER.includes(first)) return first;
  return "unknown";
}

function cardName(cardId, cardCatalog) {
  const card = cardCatalog[cardId];
  return realCardName(cardId, card?.name, card?.label, card?.imageAlt, card?.image_alt, card?.card_code) || String(cardId).slice(0, 8);
}

function shortName(value) {
  return String(value || "").split("(", 1)[0].trim();
}

function isPlaceholderCardName(value) {
  const text = String(value ?? "").trim();
  const name = shortName(text);
  return name === "未识别" || name === "未识别卡" || /^Unknown Card(?:\([^)]*\))?$/i.test(text);
}

function isHashFallbackCardName(value, cardId = "") {
  const name = shortName(value).toLowerCase();
  const hashPrefix = String(cardId || "").slice(0, 8).toLowerCase();
  if (!name) return false;
  if (hashPrefix && name === hashPrefix) return true;
  return /^[a-f0-9]{7,8}$/i.test(name);
}

function isFallbackCardName(value, cardId = "") {
  return isPlaceholderCardName(value) || isHashFallbackCardName(value, cardId);
}

function realCardName(cardId, ...values) {
  for (const value of values) {
    const name = labelName(value);
    if (name && !isFallbackCardName(name, cardId)) return name;
  }
  return "";
}

function cardCodeFaction(cardCode) {
  const first = Array.from(String(cardCode || "").trim())[0] || "";
  return OFFICIAL_FACTION_ORDER.includes(first) ? first : "unknown";
}

function labelName(value) {
  return shortName(value) || String(value || "").trim();
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function repairCardUnitType(value) {
  const repaired = CARD_UNIT_TYPE_REPAIRS[value];
  if (!repaired) return value;
  if (diagnosticsEnabled && !unitTypeRepairWarnings.has(value)) {
    unitTypeRepairWarnings.add(value);
    console.log(`repairedCardUnitType value=${value} repaired=${repaired}`);
  }
  return repaired;
}

function fallbackCardSmallUrl(cardId) {
  const value = String(cardId || "").trim();
  if (!/^[a-f0-9]{32}$/i.test(value)) return "";
  return `${OFFICIAL_ASSET_BASE_URL}general/card_small/${encodeURIComponent(value)}.jpg`;
}

function cardImageUrl(card, cardId = "") {
  void card;
  return fallbackCardSmallUrl(cardId);
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

function cardViewMetadata(card) {
  const unitType = firstText(card?.unitType, card?.unit_type, card?.unitTypeName, card?.unit_type_name, card?.["兵種"], card?.["兵种"]);
  return {
    cardCode: firstText(card?.card_code, card?.cardCode),
    cost: firstText(card?.cost, card?.cost_label, card?.costValue, card?.cost_value),
    unitType: repairCardUnitType(unitType),
    force: firstText(card?.force, card?.power, card?.strength, card?.attack, card?.["武力"]),
    intelligence: firstText(card?.intelligence, card?.intellect, card?.wisdom, card?.["知力"]),
    era: firstText(card?.era, card?.period, card?.timePeriod, card?.eraName, card?.periodName),
    skills: cardSkillList(card)
  };
}

function mergeNonEmptyCardData(baseCard, overrideCard) {
  const merged = { ...baseCard };
  const cardId = cardHashIds(overrideCard)[0] || cardHashIds(baseCard)[0] || "";
  for (const [key, value] of Object.entries(overrideCard || {})) {
    if (value === "" || value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (key === "faction" && String(value).trim() === "unknown") continue;
    if (["name", "imageAlt", "image_alt", "label"].includes(key) && isFallbackCardName(value, cardId)) continue;
    merged[key] = value;
  }
  return merged;
}

function cardView(cardId, cardCatalog) {
  const card = catalogCardFor(cardCatalog, cardId);
  const name = cardName(cardId, cardCatalog);
  return {
    cardId,
    name,
    faction: normalizeFaction(card.faction || card.card_code),
    ...cardViewMetadata(card),
    imageUrl: cardImageUrl(card, cardId),
    imageAlt: name
  };
}

function deckCards(deckId, cardCatalog) {
  return String(deckId || "")
    .split(",")
    .map((cardId) => cardId.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((cardId) => cardView(cardId, cardCatalog));
}

function deckFaction(cards, fallback) {
  const normalizedFallback = normalizeFaction(fallback);
  if (normalizedFallback !== "unknown") return normalizedFallback;

  const counts = new Map();
  for (const card of cards) {
    const faction = normalizeFaction(card.faction);
    if (faction === "unknown") continue;
    counts.set(faction, (counts.get(faction) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || OFFICIAL_FACTION_ORDER.indexOf(left[0]) - OFFICIAL_FACTION_ORDER.indexOf(right[0]))[0]?.[0] || "unknown";
}

function latestShareConfig(configRows) {
  return configRows
    .slice()
    .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")))[0] || null;
}

function latestFormalRun(runs, targetVersion, options = {}) {
  const includeSolo = Boolean(options.includeSolo);
  const includeBattleFestival = Boolean(options.includeBattleFestival);
  return runs
    .filter((run) => run.status === "ready")
    .filter((run) => !targetVersion || run.target_version === targetVersion)
    .filter((run) => {
      const runSolo = Boolean(toNumber(run.include_solo));
      if (includeBattleFestival) {
        return "include_battle_festival" in run
          ? Boolean(toNumber(run.include_battle_festival))
          : runSolo;
      }
      return Boolean(toNumber(run.include_battle_festival)) === false && runSolo === includeSolo;
    })
    .sort((left, right) => toNumber(right.id) - toNumber(left.id))[0] || null;
}

function formalRunScopeMatches(run, options = {}) {
  const includeSolo = Boolean(options.includeSolo);
  const includeBattleFestival = Boolean(options.includeBattleFestival);
  const runSolo = Boolean(toNumber(run.include_solo));
  if (includeBattleFestival) {
    return "include_battle_festival" in run
      ? Boolean(toNumber(run.include_battle_festival))
      : runSolo;
  }
  return Boolean(toNumber(run.include_battle_festival)) === false && runSolo === includeSolo;
}

function latestFormalRunsByVersion(runs, options = {}) {
  const byVersion = new Map();
  const candidates = runs
    .filter((run) => run.status === "ready")
    .filter((run) => String(run.target_version || "").trim())
    .filter((run) => formalRunScopeMatches(run, options))
    .sort((left, right) => toNumber(right.id) - toNumber(left.id));

  for (const run of candidates) {
    if (!byVersion.has(run.target_version)) {
      byVersion.set(run.target_version, run);
    }
  }

  return Array.from(byVersion.values());
}

function formalRunUpdatedAt(run) {
  return String(run.generated_at || run.updated_at || "");
}

function versionManifestEntry(run, currentTargetVersion) {
  const targetVersion = String(run.target_version || "").trim();
  return {
    targetVersion,
    sourceRunId: toNumber(run.id),
    dateFrom: String(run.date_from || ""),
    dateTo: String(run.date_to || ""),
    updatedAt: formalRunUpdatedAt(run),
    sampleSize: toNumber(run.counts_json?.side_samples),
    current: targetVersion === currentTargetVersion
  };
}

function formalCardView(card, cardCatalog = {}) {
  const cardId = String(card?.card_hash || "");
  const catalogCard = catalogCardFor(cardCatalog, cardId, card);
  const mergedCard = mergeNonEmptyCardData(catalogCard, card);
  const rawLabelName = labelName(card?.label);
  const name = isFallbackCardName(rawLabelName, cardId)
    ? realCardName(cardId, catalogCard.name, catalogCard.label, mergedCard.name, mergedCard.card_code)
      || String(card?.card_hash || "").slice(0, 8)
    : rawLabelName || realCardName(cardId, catalogCard.name, catalogCard.label, mergedCard.name, mergedCard.card_code) || String(card?.card_hash || "").slice(0, 8);
  return {
    cardId,
    name,
    faction: normalizeFaction(mergedCard.faction || cardCodeFaction(mergedCard.card_code)),
    ...cardViewMetadata(mergedCard),
    imageUrl: String(card?.image_url || ""),
    imageAlt: name
  };
}

function formalFaction(cards) {
  const counts = new Map();
  for (const card of cards) {
    const faction = normalizeFaction(card.faction);
    if (faction === "unknown") continue;
    counts.set(faction, (counts.get(faction) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || OFFICIAL_FACTION_ORDER.indexOf(left[0]) - OFFICIAL_FACTION_ORDER.indexOf(right[0]))[0]?.[0] || "unknown";
}

function formalDeckRowSample(row) {
  return toNumber(row?.row_json?.sample_count ?? row?.sample_count);
}

function deckRowCardHashes(row) {
  const cards = row?.row_json?.cards;
  if (!Array.isArray(cards)) return [];
  return cards.map((card) => String(card?.card_hash || "").trim()).filter(Boolean);
}

function deckRowFingerprintHashes(row) {
  return String(row?.row_json?.deck_fingerprint || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function hasDuplicateValues(values) {
  return new Set(values).size !== values.length;
}

function invalidDeckRowReason(row) {
  if (hasDuplicateValues(deckRowCardHashes(row))) {
    return "duplicate row_json.cards card_hash";
  }

  if (hasDuplicateValues(deckRowFingerprintHashes(row))) {
    return "duplicate row_json.deck_fingerprint card_hash";
  }

  return "";
}

function splitInvalidDeckRows(deckRows) {
  const validDeckRows = [];
  const invalidDeckRows = [];

  for (const row of deckRows) {
    const reason = invalidDeckRowReason(row);
    if (reason) {
      invalidDeckRows.push({ row, reason });
    } else {
      validDeckRows.push(row);
    }
  }

  return { validDeckRows, invalidDeckRows };
}

function logInvalidDeckRows(invalidDeckRows) {
  if (!diagnosticsEnabled || invalidDeckRows.length === 0) return;

  const sampleSize = invalidDeckRows.reduce((sum, item) => sum + formalDeckRowSample(item.row), 0);
  console.log(`excludedInvalidDeckRows=${invalidDeckRows.length} excludedInvalidDeckSampleSize=${sampleSize}`);

  invalidDeckRows.slice(0, 5).forEach((item) => {
    const name = item.row?.row_json?.deck_name || item.row?.row_json?.deck_fingerprint || item.row?.id || "";
    console.log(`invalidDeckRow rank=${item.row?.rank} sample=${formalDeckRowSample(item.row)} reason=${item.reason} deck=${name}`);
  });
}

function formalClassifierDecks(deckRows) {
  return deckRows.map((row) => {
    const json = row.row_json || {};
    const cardIds = Array.isArray(json.cards)
      ? json.cards.map((card) => String(card?.card_hash || "").trim()).filter(Boolean)
      : String(json.deck_fingerprint || "").split(",").filter(Boolean);

    return {
      deckId: String(json.deck_fingerprint || row.id),
      deckName: String(json.deck_name || json.deck_fingerprint || row.id),
      cards: cardIds,
      sampleCount: toNumber(json.sample_count ?? row.sample_count),
      winCount: toNumber(json.win_count),
      lossCount: toNumber(json.loss_count),
      drawCount: toNumber(json.draw_count)
    };
  });
}

function formalRankScore(row, json) {
  return Math.max(1, Math.round(toNumber(row.wilson_lower_bound ?? json?.wilson_lower_bound) * 100));
}

function formalRunDate(value) {
  return String(value || "").slice(0, 10);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function matchesFormalRun(match, run) {
  if (run.target_version && match.version !== run.target_version) return false;

  const playedDate = formalRunDate(match.played_at || match.created_at);
  if (run.date_from && playedDate && playedDate < run.date_from) return false;
  if (run.date_to && playedDate && playedDate > run.date_to) return false;

  return true;
}

function matchesBattleFestivalScope(match, shareConfig) {
  if (!BATTLE_FESTIVAL_MODES.has(String(match.mode || "").trim())) return false;
  if (shareConfig?.target_version && match.version !== shareConfig.target_version) return false;

  const playedDate = formalRunDate(match.played_at || match.created_at);
  if (shareConfig?.date_from && playedDate && playedDate < shareConfig.date_from) return false;
  if (shareConfig?.date_to && playedDate && playedDate > shareConfig.date_to) return false;

  return true;
}

function mergeBattleFestivalUploadScope(upload, packageById) {
  const packageRow = packageById.get(String(upload.package_id || ""));
  const modeScope = [packageRow?.mode_scope, upload.mode_scope]
    .map((value) => String(value || ""))
    .find((value) => value === "battle_festival") || upload.mode_scope || packageRow?.mode_scope || "";
  return {
    ...packageRow,
    ...upload,
    mode_scope: modeScope,
    festival_date_from: packageRow?.festival_date_from || upload.festival_date_from || "",
    festival_date_to: packageRow?.festival_date_to || upload.festival_date_to || "",
    festival_period_source: packageRow?.festival_period_source || upload.festival_period_source || ""
  };
}

function battleFestivalScopes(uploadRows, packageRows, shareConfig) {
  const packageById = new Map(packageRows.map((row) => [String(row.package_id || ""), row]));
  return uploadRows
    .map((row) => mergeBattleFestivalUploadScope(row, packageById))
    .filter((row) => String(row.mode_scope || "") === "battle_festival")
    .filter((row) => !shareConfig?.target_version || row.target_version === shareConfig.target_version)
    .slice()
    .sort((left, right) => toNumber(right.id) - toNumber(left.id));
}

function latestBattleFestivalScope(uploadRows, packageRows, shareConfig) {
  return battleFestivalScopes(uploadRows, packageRows, shareConfig)[0] || null;
}

function authoritativeBattleFestivalPeriod(scope) {
  const periodSource = String(scope?.festival_period_source || "").trim();
  if (periodSource !== FESTIVAL_PERIOD_SOURCE_OFFICIAL) return null;
  const festivalDateFrom = String(scope?.festival_date_from || "").trim();
  const festivalDateTo = String(scope?.festival_date_to || "").trim();
  if (isIsoDate(festivalDateFrom) && isIsoDate(festivalDateTo) && festivalDateFrom < festivalDateTo) {
    return { dateFrom: festivalDateFrom, dateTo: festivalDateTo, source: periodSource };
  }
  return null;
}

function latestBattleFestivalPeriodScope(uploadRows, packageRows, shareConfig) {
  return battleFestivalScopes(uploadRows, packageRows, shareConfig)
    .find((row) => authoritativeBattleFestivalPeriod(row)) || null;
}

function battleFestivalMetadataScope(shareConfig, uploadScope = null, periodScope = null) {
  const scope = uploadScope || shareConfig || {};
  const period = authoritativeBattleFestivalPeriod(periodScope);
  if (!period) return null;
  return {
    targetVersion: scope.target_version || shareConfig?.target_version || "",
    dateFrom: period.dateFrom,
    dateTo: period.dateTo,
    filterDateFrom: period.dateFrom,
    filterDateTo: period.dateTo,
    periodSourceUploadId: toNumber(periodScope?.id),
    periodSourcePackageId: String(periodScope?.package_id || ""),
    periodStatus: "official",
    festivalPeriodSource: period.source
  };
}

function battleFestivalSourceUploadMetadata(uploadScope = null) {
  return {
    sourceUploadId: toNumber(uploadScope?.id),
    sourcePackageId: String(uploadScope?.package_id || ""),
    sourceImportedMatchCount: toNumber(uploadScope?.imported_match_count),
    sourceMatchCount: toNumber(uploadScope?.match_count),
    sourceUploadCreatedAt: String(uploadScope?.created_at || "")
  };
}

function emptyBattleFestivalSnapshot(shareConfig, uploadScope = null, periodScope = null) {
  const scope = battleFestivalMetadataScope(shareConfig, uploadScope, periodScope);
  if (!scope) throw new Error("Battle festival official period is not available.");
  return {
    metadata: {
      sourceRunId: 0,
      sourceKind: "battle_festival",
      targetVersion: scope.targetVersion,
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      updatedAt: new Date().toISOString(),
      sampleSize: 0,
      periodSourceUploadId: scope.periodSourceUploadId,
      periodSourcePackageId: scope.periodSourcePackageId,
      periodStatus: scope.periodStatus,
      festivalPeriodSource: scope.festivalPeriodSource,
      ...battleFestivalSourceUploadMetadata(uploadScope)
    },
    home: {
      factionShare: [],
      representativeDecks: [],
      featuredCards: [],
      summary: "当前没有可展示的战祭数据。",
      tierRows: []
    },
    clusterRows: [],
    tierRows: [],
    battleFestival: {
      camps: [],
      campShare: [],
      rowsByCamp: {},
      meritRows: [],
      meritSummary: emptyBattleFestivalMeritSummary()
    }
  };
}

function matchSideKey(matchId, sideIndex) {
  return `${matchId}:${sideIndex}`;
}

function normalizedSideResult(value) {
  const result = String(value || "").trim();
  return ["win", "loss", "draw"].includes(result) ? result : "";
}

function firstUrl(...values) {
  return values
    .map((value) => String(value || "").trim())
    .find((value) => /^https?:\/\//.test(value)) || "";
}

function matchHighlightUrl(match) {
  return firstUrl(match?.play_url, match?.detail_url, match?.source_url);
}

function matchTimestamp(match) {
  const raw = String(match?.played_at || match?.created_at || "").trim();
  const normalized = raw.includes(" ") ? raw.replace(" ", "T") : raw;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function highlightMatchScore(match, side) {
  const result = normalizedSideResult(side?.result);
  let score = 0;
  if (result === "win") score += 1000;
  if (result === "draw") score += 400;
  if (match?.play_url) score += 120;
  if (!match?.play_url && match?.detail_url) score += 80;
  if (!match?.play_url && !match?.detail_url && match?.source_url) score += 40;
  if (match?.m3u8_url || match?.replay_id) score += 80;
  return score;
}

function highlightMatchCandidate(match, side) {
  const url = matchHighlightUrl(match);
  if (!url) return null;

  const result = normalizedSideResult(side?.result);
  const playedDate = formalRunDate(match?.played_at || match?.created_at);
  const label = `${result === "win" ? "胜利对局" : "精彩对局"}${playedDate ? ` ${playedDate}` : ""}`;
  return {
    url,
    label,
    score: highlightMatchScore(match, side),
    playedAt: matchTimestamp(match)
  };
}

function isBetterHighlightMatch(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;
  return toNumber(candidate.score) > toNumber(current.score)
    || (toNumber(candidate.score) === toNumber(current.score) && toNumber(candidate.playedAt) > toNumber(current.playedAt));
}

const SCHOOL_STAGE_LABELS = [
  { stage: "1", label: "壱之型" },
  { stage: "2", label: "弐之型" },
  { stage: "3", label: "参之型" }
];

function schoolStageActivations(school) {
  const schoolName = String(school?.name || "").trim();
  const summary = String(school?.summary || "");
  if (!schoolName || !summary) return [];

  return SCHOOL_STAGE_LABELS
    .map(({ stage, label }) => {
      const match = summary.match(new RegExp(`${label}：([^\\s)]+)`));
      const value = String(match?.[1] || "").trim();
      if (!value || value.includes("未発動")) return null;
      return { stage, name: `${schoolName} ${label}` };
    })
    .filter(Boolean);
}

function playerWinRateKey(side) {
  const followId = String(side.follow_id || "").trim();
  if (followId) return `follow:${followId}`;

  const playerName = String(side.player_name || "").trim();
  if (playerName) return `name:${playerName}`;

  return `side:${side.match_id}:${side.side_index}`;
}

async function formalPlayerAverageWinRates(run, deckRows) {
  const deckIds = new Set(deckRows
    .map((row) => String(row.row_json?.deck_fingerprint || row.id || "").trim())
    .filter(Boolean));

  if (!deckIds.size) return new Map();

  const matches = await readJsonl(
    resolve(legacyRoot, "tables/matches.jsonl"),
    (match) => matchesFormalRun(match, run)
  );
  const matchIds = new Set(matches.map((match) => toNumber(match.id)));
  if (!matchIds.size) return new Map();

  const matchDecks = await readJsonl(
    resolve(legacyRoot, "tables/match_decks.jsonl"),
    (deck) => matchIds.has(toNumber(deck.match_id)) && deckIds.has(String(deck.deck_fingerprint || "").trim())
  );
  const deckIdBySide = new Map(matchDecks.map((deck) => [
    matchSideKey(deck.match_id, deck.side_index),
    String(deck.deck_fingerprint || "").trim()
  ]));
  const targetSideKeys = new Set(deckIdBySide.keys());
  if (!targetSideKeys.size) return new Map();

  const sides = await readJsonl(
    resolve(legacyRoot, "tables/match_sides.jsonl"),
    (side) => targetSideKeys.has(matchSideKey(side.match_id, side.side_index)) && Boolean(normalizedSideResult(side.result))
  );

  const statsByDeck = new Map();
  for (const side of sides) {
    const deckId = deckIdBySide.get(matchSideKey(side.match_id, side.side_index));
    const result = normalizedSideResult(side.result);
    if (!deckId || !result) continue;

    if (!statsByDeck.has(deckId)) statsByDeck.set(deckId, new Map());
    const statsByPlayer = statsByDeck.get(deckId);
    const playerKey = playerWinRateKey(side);
    const stats = statsByPlayer.get(playerKey) || { win: 0, loss: 0, draw: 0 };
    stats[result] += 1;
    statsByPlayer.set(playerKey, stats);
  }

  const rates = new Map();
  for (const [deckId, statsByPlayer] of statsByDeck.entries()) {
    let total = 0;
    let playerCount = 0;

    for (const stats of statsByPlayer.values()) {
      const sampleCount = stats.win + stats.loss + stats.draw;
      if (!sampleCount) continue;
      total += stats.win / sampleCount;
      playerCount += 1;
    }

    if (playerCount) rates.set(deckId, total / playerCount);
  }

  return rates;
}

async function formalAuxiliaryStats(run, deckRows) {
  const deckIds = new Set(deckRows
    .map((row) => String(row.row_json?.deck_fingerprint || row.id || "").trim())
    .filter(Boolean));

  if (!deckIds.size) return emptyAuxiliaryStats();

  const matches = await readJsonl(
    resolve(legacyRoot, "tables/matches.jsonl"),
    (match) => matchesFormalRun(match, run)
  );
  const matchById = new Map(matches.map((match) => [toNumber(match.id), match]));
  const matchIds = new Set(matches.map((match) => toNumber(match.id)));
  if (!matchIds.size) return emptyAuxiliaryStats();

  const matchDecks = await readJsonl(
    resolve(legacyRoot, "tables/match_decks.jsonl"),
    (deck) => matchIds.has(toNumber(deck.match_id))
  );
  const targetMatchDecks = matchDecks.filter((deck) => deckIds.has(String(deck.deck_fingerprint || "").trim()));
  const targetSideKeys = new Set(targetMatchDecks.map((deck) => matchSideKey(deck.match_id, deck.side_index)));
  const targetDeckRowIds = new Set(targetMatchDecks.map((deck) => toNumber(deck.id)));
  if (!targetSideKeys.size || !targetDeckRowIds.size) return emptyAuxiliaryStats();

  const decksByMatch = new Map();
  for (const deck of matchDecks) {
    const matchId = toNumber(deck.match_id);
    if (!decksByMatch.has(matchId)) decksByMatch.set(matchId, []);
    decksByMatch.get(matchId).push(deck);
  }

  const sides = await readJsonl(
    resolve(legacyRoot, "tables/match_sides.jsonl"),
    (side) => targetSideKeys.has(matchSideKey(side.match_id, side.side_index))
  );
  const sideByKey = new Map(sides.map((side) => [matchSideKey(side.match_id, side.side_index), side]));

  const units = await readJsonl(
    resolve(legacyRoot, "tables/match_deck_units.jsonl"),
    (unit) => targetDeckRowIds.has(toNumber(unit.deck_id))
  );
  const unitsByDeckRowId = new Map();
  for (const unit of units) {
    const deckRowId = toNumber(unit.deck_id);
    if (!unitsByDeckRowId.has(deckRowId)) unitsByDeckRowId.set(deckRowId, []);
    unitsByDeckRowId.get(deckRowId).push(unit);
  }

  const usageByDeckCard = new Map();
  const schoolStagesByDeckStage = new Map();
  const matchupsByDeck = new Map();

  for (const deck of targetMatchDecks) {
    const side = sideByKey.get(matchSideKey(deck.match_id, deck.side_index));
    const match = matchById.get(toNumber(deck.match_id));
    const highlightMatch = highlightMatchCandidate(match, side);
    const deckId = String(deck.deck_fingerprint || "").trim();
    const bySlot = side?.profile_json?.battle_stats?.strategy_count?.by_slot;

    if (Array.isArray(bySlot)) {
      const deckUnits = (unitsByDeckRowId.get(toNumber(deck.id)) || [])
        .slice()
        .sort((left, right) => toNumber(left.slot) - toNumber(right.slot));

      for (const unit of deckUnits) {
        const cardId = String(unit.card_hash || "").trim();
        if (!deckId || !cardId) continue;

        const slotIndex = Math.max(0, toNumber(unit.slot) - 1);
        const key = `${deckId}|${cardId}`;
        const current = usageByDeckCard.get(key) || {
          deckId,
          cardId,
          strategyCount: 0,
          matchCount: 0
        };
        current.strategyCount += toNumber(bySlot[slotIndex]);
        current.matchCount += 1;
        usageByDeckCard.set(key, current);
      }
    }

    for (const activation of schoolStageActivations(side?.selected_json?.school)) {
      const key = `${deckId}|${activation.name}`;
      const current = schoolStagesByDeckStage.get(key) || {
        deckId,
        name: activation.name,
        stage: activation.stage,
        count: 0
      };
      current.count += 1;
      if (isBetterHighlightMatch(highlightMatch, current.highlightMatch)) {
        current.highlightMatch = highlightMatch;
      }
      schoolStagesByDeckStage.set(key, current);
    }

    const result = normalizedSideResult(side?.result);
    if (!result) continue;

    const opponentDeck = (decksByMatch.get(toNumber(deck.match_id)) || [])
      .find((candidate) => toNumber(candidate.side_index) !== toNumber(deck.side_index));
    const opponentDeckId = String(opponentDeck?.deck_fingerprint || "").trim();
    if (!deckId || !opponentDeckId) continue;

    if (!matchupsByDeck.has(deckId)) matchupsByDeck.set(deckId, new Map());
    const byOpponent = matchupsByDeck.get(deckId);
    const stats = byOpponent.get(opponentDeckId) || { win: 0, loss: 0, draw: 0 };
    stats[result] += 1;
    byOpponent.set(opponentDeckId, stats);
  }

  const strategyUsage = Array.from(usageByDeckCard.values());
  const strategyCountsByDeck = new Map();
  for (const item of strategyUsage) {
    if (!strategyCountsByDeck.has(item.deckId)) strategyCountsByDeck.set(item.deckId, []);
    strategyCountsByDeck.get(item.deckId).push(item);
  }

  const schoolStagesByDeck = new Map();
  for (const item of schoolStagesByDeckStage.values()) {
    if (!schoolStagesByDeck.has(item.deckId)) schoolStagesByDeck.set(item.deckId, []);
    schoolStagesByDeck.get(item.deckId).push(item);
  }

  return {
    strategyUsage,
    strategyCountsByDeck,
    schoolStagesByDeck,
    matchupsByDeck
  };
}

function emptyAuxiliaryStats() {
  return {
    strategyUsage: [],
    strategyCountsByDeck: new Map(),
    schoolStagesByDeck: new Map(),
    matchupsByDeck: new Map()
  };
}

function sourceRankTie(row) {
  const rank = toNumber(row.sourceRank);
  return rank > 0 ? rank : Number.MAX_SAFE_INTEGER;
}

function compareDeckCompositeRank(left, right) {
  const leftQualified = toNumber(left.winRate) > 50;
  const rightQualified = toNumber(right.winRate) > 50;
  if (leftQualified !== rightQualified) return leftQualified ? -1 : 1;

  const sampleDiff = toNumber(right.sampleSize) - toNumber(left.sampleSize);
  return sampleDiff ||
    toNumber(right.winRate) - toNumber(left.winRate) ||
    sourceRankTie(left) - sourceRankTie(right) ||
    String(left.deckName || "").localeCompare(String(right.deckName || ""), "ja");
}

function applyDeckCompositeRanks(rows) {
  return rows
    .slice()
    .sort(compareDeckCompositeRank)
    .map((row, index) => ({ ...row, rankScore: index + 1 }));
}

function formalDeckEvidenceTags(row) {
  const tags = [`综合 Rank ${row.rankScore}`];
  if (row.usageRate >= 2) tags.push("使用率高");
  if (row.winRate >= 54) tags.push("胜率高");
  if (row.sampleSize >= 20) tags.push("样本稳定");
  return tags;
}

function formalCardEvidenceTags(card) {
  const tags = [`综合 Rank ${card.rankScore}`];
  if (card.usageRate >= 2) tags.push("使用率高");
  if (card.winRate >= 54) tags.push("胜率高");
  if (card.sampleSize >= 50) tags.push("构筑常客");
  return tags;
}

function balancedUsageWinRows(rows, limit, options) {
  const maxUsage = Math.max(...rows.map((row) => toNumber(row.usageRate)), 0);
  const minUsage = Math.max(options.minUsageRate, maxUsage * options.minUsageShareOfMax);
  const minSample = options.minSampleSize || 0;

  const score = (row) => toNumber(row.winRate) * toNumber(row.usageRate);
  const compare = (left, right) => {
    const scoreDiff = score(right) - score(left);
    return scoreDiff || toNumber(left.sourceRank) - toNumber(right.sourceRank) || right.sampleSize - left.sampleSize;
  };

  const strict = rows
    .filter((row) => toNumber(row.winRate) >= options.minWinRate)
    .filter((row) => toNumber(row.usageRate) >= minUsage)
    .filter((row) => toNumber(row.sampleSize) >= minSample)
    .slice()
    .sort(compare);

  if (strict.length >= limit) return strict.slice(0, limit);

  const seen = new Set(strict.map((row) => row.deckId || row.cardId));
  const relaxed = rows
    .filter((row) => toNumber(row.winRate) >= options.minWinRate)
    .filter((row) => toNumber(row.usageRate) > 0)
    .filter((row) => toNumber(row.sampleSize) >= minSample)
    .filter((row) => !seen.has(row.deckId || row.cardId))
    .slice()
    .sort(compare);

  return [...strict, ...relaxed].slice(0, limit);
}

function featuredCoreCardEvidenceTags(deck) {
  const tags = ["高使用卡组核心"];
  tags.push(`综合 Rank ${deck.rankScore}`);
  if (deck.winRate >= 54) tags.push("胜率高");
  return tags;
}

function coreCardFromDeck(deck) {
  return deck.deckCards.find((card) => {
    return card.cardId && (
      (deck.imageUrl && card.imageUrl === deck.imageUrl) ||
      (deck.imageAlt && card.imageAlt === deck.imageAlt) ||
      (deck.deckName && card.name === deck.deckName)
    );
  }) || deck.deckCards[0] || null;
}

function featuredCardsFromTopUsageDecks(tierRows, limit) {
  const seenCardIds = new Set();
  const featuredCards = [];
  const sortedDecks = tierRows
    .filter((deck) => deck.sampleSize > 0 && deck.usageRate > 0)
    .slice()
    .sort((left, right) => {
      const usageDiff = right.usageRate - left.usageRate;
      return usageDiff || toNumber(left.sourceRank) - toNumber(right.sourceRank) || right.sampleSize - left.sampleSize;
    });

  for (const deck of sortedDecks) {
    const coreCard = coreCardFromDeck(deck);
    if (!coreCard || !coreCard.cardId || seenCardIds.has(coreCard.cardId)) continue;
    seenCardIds.add(coreCard.cardId);
    featuredCards.push({
      cardId: coreCard.cardId,
      name: coreCard.name || deck.deckName,
      faction: normalizeFaction(coreCard.faction || deck.faction),
      cardCode: coreCard.cardCode,
      cost: coreCard.cost,
      unitType: coreCard.unitType,
      force: coreCard.force,
      intelligence: coreCard.intelligence,
      era: coreCard.era,
      skills: coreCard.skills,
      imageUrl: coreCard.imageUrl || deck.imageUrl,
      imageAlt: coreCard.imageAlt || deck.imageAlt,
      rankScore: deck.rankScore,
      sourceRank: deck.sourceRank,
      winRate: deck.winRate,
      usageRate: deck.usageRate,
      sampleSize: deck.sampleSize,
      evidenceTags: featuredCoreCardEvidenceTags(deck)
    });
    if (featuredCards.length >= limit) break;
  }

  return featuredCards;
}

function emptyDeckConfig() {
  return {
    weapons: [],
    styles: [],
    souls: [],
    strategies: [],
    schoolStages: [],
    unfavorableMatchups: []
  };
}

function formalDeckConfigItems(items) {
  return (Array.isArray(items) ? items : [])
    .slice()
    .sort((left, right) => toNumber(right.usage_rate) - toNumber(left.usage_rate) || toNumber(right.sample_count) - toNumber(left.sample_count))
    .slice(0, 3)
    .map((item) => ({
      name: String(item?.name || "").trim() || "未识别",
      usageRate: percent(item?.usage_rate),
      sampleSize: toNumber(item?.sample_count),
      lowSample: Boolean(item?.low_sample)
    }));
}

function cardNameById(cards) {
  return new Map((cards || []).map((card) => [card.cardId, card.name]));
}

function formalStrategyConfigItems(items, cards) {
  const names = cardNameById(cards);
  const maxAverageCount = Math.max(...(items || []).map((item) => {
    const matchCount = toNumber(item.matchCount);
    return matchCount ? toNumber(item.strategyCount) / matchCount : 0;
  }), 0);

  return (items || [])
    .filter((item) => toNumber(item.strategyCount) > 0)
    .slice()
    .sort((left, right) => {
      const leftAverage = toNumber(left.matchCount) ? toNumber(left.strategyCount) / toNumber(left.matchCount) : 0;
      const rightAverage = toNumber(right.matchCount) ? toNumber(right.strategyCount) / toNumber(right.matchCount) : 0;
      return rightAverage - leftAverage || toNumber(right.matchCount) - toNumber(left.matchCount);
    })
    .slice(0, 3)
    .map((item) => {
      const strategyCount = toNumber(item.strategyCount);
      const matchCount = toNumber(item.matchCount);
      const averageCount = matchCount ? Number((strategyCount / matchCount).toFixed(2)) : 0;
      return {
        cardId: String(item.cardId || ""),
        name: names.get(String(item.cardId || "")) || String(item.cardId || "").slice(0, 8),
        usageRate: maxAverageCount ? Number((averageCount / maxAverageCount * 100).toFixed(1)) : 0,
        sampleSize: matchCount,
        strategyCount,
        averageCount
      };
    });
}

function formalSchoolStageConfigItems(items, sampleSize) {
  return (items || [])
    .slice()
    .sort((left, right) => toNumber(right.count) - toNumber(left.count) || String(left.name || "").localeCompare(String(right.name || ""), "ja"))
    .slice(0, 3)
    .map((item) => {
      const highlightMatchUrl = String(item.highlightMatch?.url || "").trim();
      const highlightMatchLabel = String(item.highlightMatch?.label || "精彩对局").trim();
      return {
        name: String(item.name || "").trim() || "未识别",
        stage: String(item.stage || ""),
        usageRate: sampleSize ? Number((toNumber(item.count) / sampleSize * 100).toFixed(1)) : 0,
        sampleSize: toNumber(item.count),
        averageCount: sampleSize ? Number((toNumber(item.count) / sampleSize).toFixed(2)) : 0,
        lowSample: toNumber(item.count) < 5,
        ...(highlightMatchUrl ? { highlightMatchUrl, highlightMatchLabel } : {})
      };
    });
}

function formalDeckConfig(behaviorStats, auxiliaryStats, deckId, cards, sampleSize) {
  return {
    weapons: formalDeckConfigItems(behaviorStats?.weapons),
    styles: formalDeckConfigItems(behaviorStats?.styles),
    souls: formalDeckConfigItems(behaviorStats?.souls),
    strategies: formalStrategyConfigItems(auxiliaryStats.strategyCountsByDeck.get(deckId), cards),
    schoolStages: formalSchoolStageConfigItems(auxiliaryStats.schoolStagesByDeck.get(deckId), sampleSize),
    unfavorableMatchups: []
  };
}

function formalUnfavorableMatchups(matchups, deckNameById) {
  const entries = Array.from((matchups || new Map()).entries());
  const totalLosses = entries.reduce((sum, [, stats]) => sum + toNumber(stats.loss), 0);

  return entries
    .map(([deckId, stats]) => {
      const lossCount = toNumber(stats.loss);
      return {
        deckId,
        deckName: deckNameById.get(deckId) || deckId.slice(0, 8),
        usageRate: totalLosses ? Number((lossCount / totalLosses * 100).toFixed(1)) : 0,
        sampleSize: lossCount
      };
    })
    .filter((item) => item.sampleSize > 0)
    .sort((left, right) => right.sampleSize - left.sampleSize || right.usageRate - left.usageRate || left.deckName.localeCompare(right.deckName, "ja"))
    .slice(0, 3);
}

function attachUnfavorableMatchups(rows, matchupsByDeck) {
  const deckNameById = new Map(rows.map((row) => [row.deckId, row.deckName]));
  return rows.map((row) => ({
    ...row,
    deckConfig: {
      ...row.deckConfig,
      unfavorableMatchups: formalUnfavorableMatchups(matchupsByDeck.get(row.deckId), deckNameById)
    }
  }));
}

function buildFormalTierRows(deckRows, classification, totalSamples, playerAverageWinRates = new Map(), auxiliaryStats = emptyAuxiliaryStats(), cardCatalog = {}) {
  const { byDeck } = categoryLookup(classification);

  const rows = deckRows
    .map((row) => {
      const json = row.row_json || {};
      const deckId = String(json.deck_fingerprint || row.id);
      const classificationResult = byDeck.get(deckId);
      const cards = (Array.isArray(json.cards) ? json.cards : [])
        .slice(0, 8)
        .map((card) => formalCardView(card, cardCatalog));
      const primaryCard = cards.find((card) => card.cardId === classificationResult?.primaryCoreCardId) || cards[0];
      const categoryName = classificationResult?.categoryName || "未分类";
      const deckName = analysisDeckDisplayName(categoryName, classificationResult, primaryCard, deckId);
      const winRateValue = percent(json.win_rate ?? 0);
      const playerAverageWinRateValue = percent(playerAverageWinRates.get(deckId) ?? json.win_rate ?? 0);
      const usageRateValue = totalSamples ? Number((toNumber(json.sample_count ?? row.sample_count) / totalSamples * 100).toFixed(1)) : 0;
      const sampleSize = toNumber(json.sample_count ?? row.sample_count);
      const result = {
        deckId,
        deckName,
        categoryId: classificationResult?.categoryId || "unclassified",
        categoryName,
        faction: deckFaction(cards, classificationResult?.primaryFaction || primaryCard?.faction),
        namingSource: namingSource(classificationResult),
        rankScore: 0,
        sourceRank: toNumber(row.rank),
        winRate: winRateValue,
        playerAverageWinRate: playerAverageWinRateValue,
        usageRate: usageRateValue,
        kabukiPoints: 0,
        sampleSize,
        imageUrl: primaryCard?.imageUrl || "",
        imageAlt: primaryCard?.name || deckName,
        deckCards: cards,
        deckConfig: formalDeckConfig(json.behavior_stats, auxiliaryStats, deckId, cards, sampleSize)
      };
      return result;
    })
    .sort((left, right) => left.sourceRank - right.sourceRank);

  return applyDeckCompositeRanks(rows).map((row) => ({ ...row, evidenceTags: formalDeckEvidenceTags(row) }));
}

function formalArchetypeCards(json, cardCatalog = {}) {
  const representativeCards = json?.representative_deck?.cards;
  const cards = Array.isArray(representativeCards) && representativeCards.length
    ? representativeCards
    : json?.core_cards;
  return (Array.isArray(cards) ? cards : [])
    .slice(0, 8)
    .map((card) => formalCardView(card, cardCatalog));
}

function formalArchetypePrimaryCard(json, cards, cardCatalog = {}) {
  const coreCards = (Array.isArray(json?.core_cards) ? json.core_cards : [])
    .map((card) => formalCardView(card, cardCatalog));
  return coreCards.find((coreCard) => cards.some((card) => card.cardId === coreCard.cardId)) || coreCards[0] || cards[0] || null;
}

function formalArchetypeRepresentativeDeckId(json) {
  return String(json?.representative_deck?.deck_fingerprint || json?.member_decks?.[0]?.deck_fingerprint || "").trim();
}

function formalArchetypeMemberDeckRows(json) {
  const rows = (Array.isArray(json?.member_decks) ? json.member_decks : [])
    .map((member) => ({
      deckId: String(member?.deck_fingerprint || "").trim(),
      sampleSize: toNumber(member?.sample_count)
    }))
    .filter((member) => member.deckId);
  const representativeDeckId = formalArchetypeRepresentativeDeckId(json);

  if (representativeDeckId && !rows.some((member) => member.deckId === representativeDeckId)) {
    rows.push({
      deckId: representativeDeckId,
      sampleSize: toNumber(json?.representative_deck?.sample_count ?? json?.sample_count)
    });
  }

  return rows;
}

function formalArchetypePlayerAverageWinRate(json, tierRowsByDeckId, fallbackWinRate) {
  const weightedRows = formalArchetypeMemberDeckRows(json)
    .map((member) => {
      const deckRow = tierRowsByDeckId.get(member.deckId);
      if (!deckRow) return null;

      const sampleSize = member.sampleSize || toNumber(deckRow.sampleSize);
      if (!sampleSize) return null;

      return {
        sampleSize,
        playerAverageWinRate: toNumber(deckRow.playerAverageWinRate)
      };
    })
    .filter(Boolean);
  const sampleSize = weightedRows.reduce((sum, row) => sum + row.sampleSize, 0);

  if (!sampleSize) return fallbackWinRate;

  return Number((weightedRows.reduce((sum, row) => (
    sum + row.playerAverageWinRate * row.sampleSize
  ), 0) / sampleSize).toFixed(1));
}

function weightedRowPercent(rows, key, sampleSize) {
  if (!sampleSize) return 0;
  return Number((rows.reduce((sum, row) => sum + toNumber(row[key]) * toNumber(row.sampleSize), 0) / sampleSize).toFixed(1));
}

function mergeFormalDeckConfigItems(rows, key, sampleSize) {
  const byName = new Map();
  for (const row of rows) {
    for (const item of row.deckConfig?.[key] || []) {
      const name = String(item.name || "").trim();
      if (!name) continue;
      const current = byName.get(name) || { name, sampleSize: 0 };
      current.sampleSize += toNumber(item.sampleSize);
      byName.set(name, current);
    }
  }

  return Array.from(byName.values())
    .map((item) => ({
      name: item.name,
      usageRate: sampleSize ? Number((item.sampleSize / sampleSize * 100).toFixed(1)) : 0,
      sampleSize: item.sampleSize,
      lowSample: item.sampleSize < 5
    }))
    .sort((left, right) => right.sampleSize - left.sampleSize || left.name.localeCompare(right.name, "ja"))
    .slice(0, 3);
}

function mergeStrategyConfigItems(rows) {
  const byCard = new Map();
  for (const row of rows) {
    for (const item of row.deckConfig?.strategies || []) {
      const cardId = String(item.cardId || item.name || "").trim();
      if (!cardId) continue;
      const current = byCard.get(cardId) || {
        cardId,
        name: String(item.name || cardId).trim(),
        strategyCount: 0,
        sampleSize: 0
      };
      current.strategyCount += toNumber(item.strategyCount);
      current.sampleSize += toNumber(item.sampleSize);
      byCard.set(cardId, current);
    }
  }

  const values = Array.from(byCard.values())
    .filter((item) => item.strategyCount > 0 && item.sampleSize > 0)
    .map((item) => ({
      ...item,
      averageCount: Number((item.strategyCount / item.sampleSize).toFixed(2))
    }));
  const maxAverageCount = Math.max(...values.map((item) => item.averageCount), 0);

  return values
    .map((item) => ({
      cardId: item.cardId,
      name: item.name,
      usageRate: maxAverageCount ? Number((item.averageCount / maxAverageCount * 100).toFixed(1)) : 0,
      sampleSize: item.sampleSize,
      strategyCount: item.strategyCount,
      averageCount: item.averageCount
    }))
    .sort((left, right) => right.averageCount - left.averageCount || right.sampleSize - left.sampleSize || left.name.localeCompare(right.name, "ja"))
    .slice(0, 3);
}

function mergeSchoolStageConfigItems(rows, sampleSize) {
  const byStage = new Map();
  for (const row of rows) {
    for (const item of row.deckConfig?.schoolStages || []) {
      const name = String(item.name || "").trim();
      const stage = String(item.stage || "").trim();
      const key = `${stage}|${name}`;
      if (!name) continue;
      const current = byStage.get(key) || {
        name,
        stage,
        sampleSize: 0,
        highlightMatchUrl: "",
        highlightMatchLabel: "",
        highlightMatchSampleSize: 0
      };
      current.sampleSize += toNumber(item.sampleSize);
      const highlightMatchUrl = String(item.highlightMatchUrl || "").trim();
      const highlightMatchSampleSize = toNumber(item.sampleSize);
      if (highlightMatchUrl && highlightMatchSampleSize >= current.highlightMatchSampleSize) {
        current.highlightMatchUrl = highlightMatchUrl;
        current.highlightMatchLabel = String(item.highlightMatchLabel || "精彩对局").trim();
        current.highlightMatchSampleSize = highlightMatchSampleSize;
      }
      byStage.set(key, current);
    }
  }

  return Array.from(byStage.values())
    .map((item) => ({
      name: item.name,
      stage: item.stage,
      usageRate: sampleSize ? Number((item.sampleSize / sampleSize * 100).toFixed(1)) : 0,
      sampleSize: item.sampleSize,
      averageCount: sampleSize ? Number((item.sampleSize / sampleSize).toFixed(2)) : 0,
      lowSample: item.sampleSize < 5,
      ...(item.highlightMatchUrl ? {
        highlightMatchUrl: item.highlightMatchUrl,
        highlightMatchLabel: item.highlightMatchLabel
      } : {})
    }))
    .sort((left, right) => right.sampleSize - left.sampleSize || left.name.localeCompare(right.name, "ja"))
    .slice(0, 3);
}

function mergeUnfavorableMatchupItems(rows, currentDeckName = "") {
  const byDeckName = new Map();
  const excludedDeckName = String(currentDeckName || "").trim();
  for (const row of rows) {
    for (const item of row.deckConfig?.unfavorableMatchups || []) {
      const deckName = String(item.deckName || item.deckId || "").trim();
      if (deckName && deckName === excludedDeckName) continue;
      if (!deckName) continue;
      const current = byDeckName.get(deckName) || {
        deckId: String(item.deckId || deckName),
        deckName,
        sampleSize: 0
      };
      current.sampleSize += toNumber(item.sampleSize);
      byDeckName.set(deckName, current);
    }
  }

  const totalLosses = Array.from(byDeckName.values())
    .reduce((sum, item) => sum + toNumber(item.sampleSize), 0);

  return Array.from(byDeckName.values())
    .filter((item) => item.sampleSize > 0)
    .map((item) => ({
      deckId: item.deckId,
      deckName: item.deckName,
      usageRate: totalLosses ? Number((item.sampleSize / totalLosses * 100).toFixed(1)) : 0,
      sampleSize: item.sampleSize
    }))
    .sort((left, right) => right.sampleSize - left.sampleSize || right.usageRate - left.usageRate || left.deckName.localeCompare(right.deckName, "ja"))
    .slice(0, 3);
}

function addDeckConfigSource(sourceRowsByKey, key, row) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;
  if (!sourceRowsByKey.has(normalizedKey)) sourceRowsByKey.set(normalizedKey, []);
  sourceRowsByKey.get(normalizedKey).push(row);
}

function deckConfigSourceRowsByKey(rows) {
  const sourceRowsByKey = new Map();
  for (const row of rows || []) {
    addDeckConfigSource(sourceRowsByKey, `category:${row.categoryId}`, row);
    addDeckConfigSource(sourceRowsByKey, `deck:${row.deckId}`, row);
  }
  return sourceRowsByKey;
}

function clusterDeckConfigSourceRows(sourceRowsByKey, clusterRows) {
  const sourceRows = [];
  const seen = new Set();
  for (const row of clusterRows) {
    const categoryId = String(row.categoryId || "").trim();
    const keys = [
      ...(categoryId && categoryId !== "unclassified" ? [`category:${categoryId}`] : []),
      `deck:${row.configSourceDeckId || ""}`,
      `deck:${row.deckId}`
    ];
    for (const key of keys) {
      for (const sourceRow of sourceRowsByKey.get(key) || []) {
        if (seen.has(sourceRow)) continue;
        seen.add(sourceRow);
        sourceRows.push(sourceRow);
      }
    }
  }
  return sourceRows.length ? sourceRows : clusterRows;
}

function clusterVariantRow(row) {
  return {
    deckId: row.deckId,
    deckName: row.deckName,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    faction: row.faction,
    namingSource: row.namingSource,
    rankScore: row.rankScore,
    sourceRank: row.sourceRank,
    winRate: row.winRate,
    playerAverageWinRate: row.playerAverageWinRate,
    usageRate: row.usageRate,
    kabukiPoints: row.kabukiPoints,
    sampleSize: row.sampleSize,
    imageUrl: row.imageUrl,
    imageAlt: row.imageAlt,
    deckCards: row.deckCards
  };
}

function mergeSameNameClusterRows(rows, configSourceRowsByKey = new Map()) {
  const byName = new Map();
  for (const row of rows) {
    const displayName = row.deckName || row.deckId;
    const cardIdentity = row.sameNameClusterIdentity || `category:${row.categoryId || row.deckId}`;
    const key = `${displayName}\u0000${cardIdentity}`;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  }

  return Array.from(byName.values())
    .map((variants) => {
      const ordered = variants.slice().sort((left, right) => sourceRankTie(left) - sourceRankTie(right) || right.sampleSize - left.sampleSize);
      const base = ordered[0];
      const sampleSize = ordered.reduce((sum, row) => sum + toNumber(row.sampleSize), 0);
      const sourceRank = Math.min(...ordered.map((row) => sourceRankTie(row)));
      const mergedSourceRank = sourceRank < Number.MAX_SAFE_INTEGER ? sourceRank : base.sourceRank;
      const configSourceRows = clusterDeckConfigSourceRows(configSourceRowsByKey, ordered);
      const configSampleSize = configSourceRows.reduce((sum, row) => sum + toNumber(row.sampleSize), 0) || sampleSize;
      const baseRow = { ...base };
      delete baseRow.sameNameClusterIdentity;
      delete baseRow.configSourceDeckId;
      const outputCategoryId = String(base.categoryId || "").trim();
      const merged = {
        ...baseRow,
        deckId: outputCategoryId && outputCategoryId !== "unclassified" ? outputCategoryId : base.deckId,
        rankScore: 0,
        sourceRank: mergedSourceRank,
        winRate: weightedRowPercent(ordered, "winRate", sampleSize),
        playerAverageWinRate: weightedRowPercent(ordered, "playerAverageWinRate", sampleSize),
        usageRate: Number(ordered.reduce((sum, row) => sum + toNumber(row.usageRate), 0).toFixed(1)),
        sampleSize,
        clusterVariants: ordered.map(clusterVariantRow),
        deckConfig: {
          ...base.deckConfig,
          weapons: mergeFormalDeckConfigItems(ordered, "weapons", sampleSize),
          styles: mergeFormalDeckConfigItems(ordered, "styles", sampleSize),
          souls: mergeFormalDeckConfigItems(ordered, "souls", sampleSize),
          strategies: mergeStrategyConfigItems(configSourceRows),
          schoolStages: mergeSchoolStageConfigItems(configSourceRows, configSampleSize),
          unfavorableMatchups: mergeUnfavorableMatchupItems(configSourceRows, base.deckName)
        }
      };
      return merged;
    })
    .sort((left, right) => sourceRankTie(left) - sourceRankTie(right) || right.sampleSize - left.sampleSize || right.winRate - left.winRate);
}

function variantBaseCardCodesByGameplayHash(cardCatalog = {}) {
  const byGameplayHash = new Map();
  for (const card of Object.values(cardCatalog)) {
    const variantKind = firstText(card?.variant_kind, card?.variantKind);
    if (variantKind && variantKind !== "reskin") continue;
    const gameplayHash = firstText(card?.gameplay_hash, card?.gameplayHash);
    const variantBaseCardCode = firstText(card?.variant_base_card_code, card?.variantBaseCardCode);
    if (!gameplayHash || !variantBaseCardCode) continue;
    if (!byGameplayHash.has(gameplayHash)) byGameplayHash.set(gameplayHash, new Set());
    byGameplayHash.get(gameplayHash).add(variantBaseCardCode);
  }
  return byGameplayHash;
}

function sameNameClusterIdentity(card, cardCatalog = {}, variantBaseByGameplayHash = new Map()) {
  const cardId = String(card?.cardId || "").trim();
  const catalogCard = catalogCardFor(cardCatalog, cardId, card);
  const variantKind = firstText(catalogCard.variant_kind, catalogCard.variantKind);
  const variantBaseCardCode = !variantKind || variantKind === "reskin" ? firstText(
    catalogCard.variant_base_card_code,
    catalogCard.variantBaseCardCode
  ) : "";
  const cardCode = firstText(
    catalogCard.card_code,
    catalogCard.cardCode,
    card?.cardCode
  );
  if (variantBaseCardCode) return `card-code:${variantBaseCardCode}`;
  if (cardDeclaresVariantMetadata(catalogCard)) {
    return cardCode ? `card-code:${cardCode}` : `card-id:${cardId}`;
  }

  const gameplayHash = firstText(catalogCard.gameplay_hash, catalogCard.gameplayHash);
  const inferredVariantBaseCardCodes = variantBaseByGameplayHash.get(gameplayHash);
  if (cardCode && inferredVariantBaseCardCodes?.has(cardCode)) return `card-code:${cardCode}`;
  if (inferredVariantBaseCardCodes?.size === 1) {
    return `card-code:${Array.from(inferredVariantBaseCardCodes)[0]}`;
  }
  if (inferredVariantBaseCardCodes?.size > 1) {
    return cardCode ? `card-code:${cardCode}` : `card-id:${cardId}`;
  }
  if (gameplayHash) return `gameplay:${gameplayHash}`;
  return cardCode ? `card-code:${cardCode}` : `card-id:${cardId}`;
}

function buildFormalClusterRows(archetypeRows, classification, totalSamples, configSourceRows = [], cardCatalog = {}) {
  const { byDeck } = categoryLookup(classification);
  const configSourceRowsByKey = deckConfigSourceRowsByKey(configSourceRows);
  const variantBaseByGameplayHash = variantBaseCardCodesByGameplayHash(cardCatalog);
  const tierRowsByDeckId = new Map((configSourceRows || [])
    .map((row) => [String(row.deckId || "").trim(), row])
    .filter(([deckId]) => deckId));
  const rows = archetypeRows
    .map((row) => {
      const json = row.row_json || {};
      const deckId = String(json.archetype_id || row.id);
      const representativeDeckId = formalArchetypeRepresentativeDeckId(json);
      const classificationResult = byDeck.get(representativeDeckId);
      const cards = formalArchetypeCards(json, cardCatalog);
      const primaryCard = cards.find((card) => card.cardId === classificationResult?.primaryCoreCardId) || formalArchetypePrimaryCard(json, cards, cardCatalog);
      const fallbackName = String(json.title || json.representative_deck?.deck_name || deckId).trim();
      const categoryName = classificationResult?.categoryName || fallbackName;
      const deckName = analysisDeckDisplayName(categoryName, classificationResult, primaryCard, deckId);
      const sampleSize = toNumber(json.sample_count ?? row.sample_count);
      const winRateValue = percent(json.win_rate ?? 0);
      const playerAverageWinRateValue = formalArchetypePlayerAverageWinRate(json, tierRowsByDeckId, winRateValue);
      const usageRateValue = totalSamples ? Number((sampleSize / totalSamples * 100).toFixed(1)) : 0;
      const sourceRank = toNumber(row.rank);
      const result = {
        deckId,
        deckName,
        categoryId: classificationResult?.categoryId || deckId,
        categoryName,
        faction: deckFaction(cards, classificationResult?.primaryFaction || primaryCard?.faction),
        namingSource: namingSource(classificationResult),
        rankScore: 0,
        sourceRank,
        winRate: winRateValue,
        playerAverageWinRate: playerAverageWinRateValue,
        usageRate: usageRateValue,
        kabukiPoints: 0,
        sampleSize,
        imageUrl: primaryCard?.imageUrl || cards[0]?.imageUrl || "",
        imageAlt: primaryCard?.name || deckName,
        deckCards: cards,
        deckConfig: formalDeckConfig(json.behavior_stats, emptyAuxiliaryStats(), deckId, cards, sampleSize),
        sameNameClusterIdentity: sameNameClusterIdentity(primaryCard, cardCatalog, variantBaseByGameplayHash),
        configSourceDeckId: representativeDeckId
      };
      return result;
    })
    .filter((row) => row.sampleSize > 0 && row.deckCards.length > 0)
    .sort((left, right) => sourceRankTie(left) - sourceRankTie(right) || right.sampleSize - left.sampleSize || right.winRate - left.winRate)
    .map((row, index) => {
      const rankedRow = { ...row, rankScore: row.rankScore || index + 1 };
      return { ...rankedRow, evidenceTags: formalDeckEvidenceTags(rankedRow) };
    });

  return applyDeckCompositeRanks(mergeSameNameClusterRows(rows, configSourceRowsByKey))
    .map((row) => ({ ...row, evidenceTags: formalDeckEvidenceTags(row) }));
}

function buildFormalFeaturedCards(cardRows, totalSamples, cardCatalog = {}) {
  return cardRows
    .map((row) => {
      const json = row.row_json || {};
      const card = formalCardView(json, cardCatalog);
      const result = {
        cardId: card.cardId || String(row.id),
        name: card.name,
        faction: card.faction,
        cardCode: card.cardCode,
        cost: card.cost,
        unitType: card.unitType,
        force: card.force,
        intelligence: card.intelligence,
        era: card.era,
        skills: card.skills,
        imageUrl: card.imageUrl,
        imageAlt: card.imageAlt,
        rankScore: formalRankScore(row, json),
        sourceRank: toNumber(row.rank),
        winRate: percent(json.win_rate ?? 0),
        usageRate: totalSamples ? Number((toNumber(json.sample_count ?? row.sample_count) / totalSamples * 100).toFixed(1)) : 0,
        sampleSize: toNumber(json.sample_count ?? row.sample_count)
      };
      return { ...result, evidenceTags: formalCardEvidenceTags(result) };
    })
    .sort((left, right) => left.sourceRank - right.sourceRank);
}

async function buildFormalSnapshot(run, rows, cardCatalog, strategyTypes, options = {}) {
  const deckRows = rows
    .filter((row) => row.run_id === run.id && row.row_type === "deck" && row.rank_scope === "all" && toNumber(row.cluster_enabled) === 0)
    .sort((left, right) => toNumber(left.rank) - toNumber(right.rank));
  const archetypeRows = rows
    .filter((row) => row.run_id === run.id && row.row_type === "archetype" && row.rank_scope === "all" && toNumber(row.cluster_enabled) === 1)
    .sort((left, right) => toNumber(left.rank) - toNumber(right.rank));
  const { validDeckRows, invalidDeckRows } = splitInvalidDeckRows(deckRows);
  const totalSamples = validDeckRows.reduce((sum, row) => sum + formalDeckRowSample(row), 0);
  const excludedInvalidDeckSampleSize = invalidDeckRows.reduce((sum, item) => sum + formalDeckRowSample(item.row), 0);
  logInvalidDeckRows(invalidDeckRows);

  const playerAverageWinRates = await formalPlayerAverageWinRates(run, validDeckRows);
  const auxiliaryStats = await formalAuxiliaryStats(run, validDeckRows);
  const classification = classifyAnalysisDecks(formalClassifierDecks(validDeckRows), cardCatalog, {
    now: run.generated_at || run.updated_at || new Date().toISOString(),
    strategyTypes,
    strategyUsage: auxiliaryStats.strategyUsage
  });
  const tierRows = attachUnfavorableMatchups(
    buildFormalTierRows(validDeckRows, classification, totalSamples, playerAverageWinRates, auxiliaryStats, cardCatalog),
    auxiliaryStats.matchupsByDeck
  );
  const archetypeTotalSamples = archetypeRows.reduce((sum, row) => sum + formalDeckRowSample(row), 0);
  const clusterRows = buildFormalClusterRows(archetypeRows, classification, totalSamples || archetypeTotalSamples, tierRows, cardCatalog);
  const homeRows = clusterRows.length ? clusterRows : tierRows;
  const factionShare = buildFactionShare(homeRows);
  const topShareTotal = factionShare.slice(0, 3).reduce((sum, item) => sum + item.share, 0);

  return {
    metadata: {
      sourceRunId: toNumber(run.id),
      sourceKind: options.sourceKind || "server_leaderboard",
      targetVersion: run.target_version,
      dateFrom: run.date_from,
      dateTo: run.date_to,
      updatedAt: run.generated_at || run.updated_at,
      sampleSize: totalSamples,
      excludedInvalidDeckRows: invalidDeckRows.length,
      excludedInvalidDeckSampleSize
    },
    home: {
      factionShare,
      representativeDecks: balancedUsageWinRows(homeRows, 4, {
        minWinRate: 54,
        minUsageRate: 0.6,
        minUsageShareOfMax: 0.15,
        minSampleSize: 10
      }),
      featuredCards: featuredCardsFromTopUsageDecks(homeRows, 4),
      summary: homeRows.length
        ? `${run.target_version} 正式榜单，前三势力合计 ${topShareTotal}%。`
        : "当前无可展示榜单数据。",
      tierRows: homeRows
    },
    clusterRows: homeRows,
    tierRows
  };
}

function normalizedLog(value, maxValue) {
  if (!maxValue) return 0;
  return Math.log1p(value) / Math.log1p(maxValue);
}

function rankScore(winRatePercent, sampleSize, maxSampleSize) {
  return Math.round(winRatePercent * 0.55 + normalizedLog(sampleSize, maxSampleSize) * 45);
}

function deckEvidenceTags(row) {
  const tags = [`综合 Rank ${row.rankScore}`];
  if (row.usageRate >= 15) tags.push("使用率高");
  if (row.winRate >= 54) tags.push("胜率高");
  if (row.sampleSize >= 100) tags.push("样本稳定");
  return tags;
}

function cardEvidenceTags(card) {
  const tags = [];
  if (card.rankScore >= 90) tags.push("综合 Rank 高");
  if (card.usageRate >= 15) tags.push("使用率高");
  if (card.winRate >= 54) tags.push("胜率高");
  if (card.usageRate >= 9) tags.push("构筑常客");
  return tags.length ? tags : ["综合观察"];
}

function namingSource(result) {
  if (result?.secondaryAxisCardId) return "combo";
  if (result?.deckType && result.deckType !== "unknown") return "type";
  return "single";
}

function categoryLookup(output) {
  const byDeck = new Map();
  for (const result of output.results || []) {
    byDeck.set(result.deckId, result);
  }
  const byCategory = new Map();
  for (const category of output.categories || []) {
    byCategory.set(category.categoryId, category);
  }
  return { byDeck, byCategory };
}

function analysisDeckDisplayName(categoryName, result, primaryCard, deckId) {
  const name = shortName(categoryName);
  if (name && name !== "Unclassified" && name !== "未分类") return name;
  return shortName(result?.primaryCoreCardName) || primaryCard?.name || deckId;
}

function buildTierRows(deckStats, classification, cardCatalog) {
  const { byDeck, byCategory } = categoryLookup(classification);
  const totalSamples = deckStats.reduce((sum, row) => sum + toNumber(row.sample_count), 0);

  const rows = deckStats
    .map((stat) => {
      const deckId = stat.deck_fingerprint;
      const result = byDeck.get(deckId);
      const category = result ? byCategory.get(result.categoryId) : null;
      const cards = deckCards(deckId, cardCatalog);
      const primaryCard = cards.find((card) => card.cardId === result?.primaryCoreCardId) || cards[0];
      const winRateValue = percent(stat.win_rate);
      const usageRateValue = totalSamples ? Number((toNumber(stat.sample_count) / totalSamples * 100).toFixed(1)) : 0;
      const categoryName = result?.categoryName || "Unclassified";
      const row = {
        deckId,
        deckName: analysisDeckDisplayName(categoryName, result, primaryCard, deckId),
        categoryId: result?.categoryId || "unclassified",
        categoryName,
        faction: deckFaction(cards, result?.primaryFaction || primaryCard?.faction),
        namingSource: namingSource(result),
        rankScore: 0,
        sourceRank: 0,
        winRate: winRateValue,
        playerAverageWinRate: winRateValue,
        usageRate: usageRateValue,
        kabukiPoints: 0,
        sampleSize: toNumber(stat.sample_count),
        imageUrl: primaryCard?.imageUrl || "",
        imageAlt: primaryCard?.name || categoryName,
        deckCards: cards,
        deckConfig: emptyDeckConfig()
      };
      return row;
    })
    .sort(compareDeckCompositeRank);

  const seenDeckIds = new Set();
  const uniqueRows = rows.filter((row) => {
    if (seenDeckIds.has(row.deckId)) return false;
    seenDeckIds.add(row.deckId);
    return true;
  });

  return applyDeckCompositeRanks(uniqueRows).map((row) => ({ ...row, evidenceTags: deckEvidenceTags(row) }));
}

function buildFactionShare(rows) {
  const byFaction = new Map();

  for (const row of rows) {
    const key = normalizeFaction(row.faction);
    if (!byFaction.has(key)) {
      byFaction.set(key, { faction: key, sampleSize: 0, representatives: [] });
    }
    const entry = byFaction.get(key);
    entry.sampleSize += row.sampleSize;
    if (entry.representatives.length < 2 && !entry.representatives.includes(row.deckName)) entry.representatives.push(row.deckName);
  }

  const ordered = Array.from(byFaction.values())
    .filter((entry) => entry.faction !== "unknown" && entry.sampleSize > 0)
    .sort((left, right) => {
      const sampleDiff = right.sampleSize - left.sampleSize;
      return sampleDiff || OFFICIAL_FACTION_ORDER.indexOf(left.faction) - OFFICIAL_FACTION_ORDER.indexOf(right.faction);
    })
    .slice(0, 7);

  const officialTotal = ordered.reduce((sum, entry) => sum + entry.sampleSize, 0);
  const rounded = ordered.map((entry) => ({
    faction: entry.faction,
    share: officialTotal ? Math.round(entry.sampleSize / officialTotal * 100) : 0,
    color: FACTION_COLORS[entry.faction] || FACTION_COLORS.unknown,
    representatives: entry.representatives
  }));

  const diff = 100 - rounded.reduce((sum, item) => sum + item.share, 0);
  if (rounded.length && Math.abs(diff) <= rounded.length) {
    rounded[0].share += diff;
  }

  return rounded.sort((left, right) => {
    const shareDiff = right.share - left.share;
    return shareDiff || OFFICIAL_FACTION_ORDER.indexOf(left.faction) - OFFICIAL_FACTION_ORDER.indexOf(right.faction);
  });
}

function buildFeaturedCards(cardStats, cardCatalog) {
  const totalSamples = cardStats.reduce((sum, row) => sum + toNumber(row.sample_count), 0);
  const maxSample = Math.max(...cardStats.map((row) => toNumber(row.sample_count)), 0);

  const rows = cardStats
    .map((stat) => {
      const card = cardView(stat.card_hash, cardCatalog);
      const winRateValue = percent(stat.win_rate);
      const usageRateValue = totalSamples ? Number((toNumber(stat.sample_count) / totalSamples * 100).toFixed(1)) : 0;
      const row = {
        cardId: stat.card_hash,
        name: card.name,
        faction: card.faction,
        imageUrl: card.imageUrl,
        imageAlt: card.imageAlt,
        rankScore: rankScore(winRateValue, toNumber(stat.sample_count), maxSample),
        winRate: winRateValue,
        usageRate: usageRateValue,
        sampleSize: toNumber(stat.sample_count)
      };
      return { ...row, evidenceTags: cardEvidenceTags(row) };
    })
    .sort((left, right) => right.rankScore - left.rankScore || right.sampleSize - left.sampleSize);

  const seenCardIds = new Set();
  return rows
    .filter((row) => {
      if (seenCardIds.has(row.cardId)) return false;
      seenCardIds.add(row.cardId);
      return true;
    })
    .slice(0, 8);
}

function battleFestivalDeckId(deck, unitsByDeckId) {
  const deckId = String(deck.deck_fingerprint || "").trim();
  if (deckId) return deckId;
  return (unitsByDeckId.get(toNumber(deck.id)) || [])
    .slice()
    .sort((left, right) => toNumber(left.slot) - toNumber(right.slot))
    .map((unit) => String(unit.card_hash || "").trim())
    .filter(Boolean)
    .join(",");
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

function battleFestivalCamp(side) {
  const profile = jsonObject(side?.profile_json);
  for (const key of BATTLE_FESTIVAL_CAMP_KEYS) {
    const value = String(profile[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function parseBattleFestivalMerit(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function battleFestivalMerit(side) {
  const profile = jsonObject(side?.profile_json);
  return parseBattleFestivalMerit(profile[BATTLE_FESTIVAL_MERIT_KEY]);
}

function emptyBattleFestivalMeritSummary() {
  return {
    observedPlayerCount: 0,
    meritPlayerCount: 0,
    meritSampleCount: 0,
    highestMerit: 0,
    topPlayerName: "",
    observedMatchCount: 0
  };
}

function mostCommonText(counter) {
  return Array.from(counter.entries())
    .filter(([value]) => value)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ja"))[0]?.[0] || "";
}

function compareObservedSamples(left, right) {
  return String(left.playedAt || "").localeCompare(String(right.playedAt || "")) ||
    toNumber(left.matchId) - toNumber(right.matchId);
}

function compareHighestMeritSamples(left, right) {
  return right.merit - left.merit ||
    String(right.playedAt || "").localeCompare(String(left.playedAt || "")) ||
    toNumber(right.matchId) - toNumber(left.matchId);
}

function battleFestivalPaceDate(value) {
  return String(value || "").slice(0, 10);
}

function battleFestivalTimestampMs(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return NaN;
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
}

function battleFestivalMinutesBetween(previousAt, currentAt) {
  const previousMs = battleFestivalTimestampMs(previousAt);
  const currentMs = battleFestivalTimestampMs(currentAt);
  if (!Number.isFinite(previousMs) || !Number.isFinite(currentMs)) return 1;
  return Math.max(1, Math.round((currentMs - previousMs) / 60000));
}

function battleFestivalRemainingMinutes(fromAt, toAt) {
  const fromMs = battleFestivalTimestampMs(fromAt);
  const toMs = battleFestivalTimestampMs(toAt);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  return Math.max(0, Math.round((toMs - fromMs) / 60000));
}

function battleFestivalRound(value) {
  return Number(toNumber(value).toFixed(1));
}

function battleFestivalMeritPerHour(meritGain, observedMinutes) {
  return observedMinutes > 0 ? battleFestivalRound(meritGain / observedMinutes * 60) : 0;
}

function battleFestivalPaceDayView(day) {
  const meritGain = Math.max(0, toNumber(day.lastMerit) - toNumber(day.firstMerit));
  const observedMinutes = toNumber(day.observedMinutes);
  return {
    date: day.date,
    firstObservedAt: day.firstObservedAt,
    lastObservedAt: day.lastObservedAt,
    firstMerit: toNumber(day.firstMerit),
    lastMerit: toNumber(day.lastMerit),
    meritGain,
    meritSampleCount: toNumber(day.meritSampleCount),
    observedMinutes,
    averageMinutesPerMatch: day.meritSampleCount ? battleFestivalRound(observedMinutes / day.meritSampleCount) : 0,
    meritPerHour: battleFestivalMeritPerHour(meritGain, observedMinutes)
  };
}

function battleFestivalPeriodPace(days) {
  const meritGain = days.reduce((sum, day) => sum + toNumber(day.meritGain), 0);
  const observedMinutes = days.reduce((sum, day) => sum + toNumber(day.observedMinutes), 0);
  const meritSampleCount = days.reduce((sum, day) => sum + toNumber(day.meritSampleCount), 0);
  return {
    date: "",
    meritGain,
    observedMinutes,
    meritSampleCount,
    averageMinutesPerMatch: meritSampleCount ? battleFestivalRound(observedMinutes / meritSampleCount) : 0,
    meritPerHour: battleFestivalMeritPerHour(meritGain, observedMinutes)
  };
}

function buildBattleFestivalMeritPace(meritSamples, finalDate) {
  const sorted = meritSamples
    .filter((sample) => Number.isFinite(toNumber(sample.merit)) && sample.playedAt)
    .slice()
    .sort(compareObservedSamples);
  if (!sorted.length) return null;

  const previousByDate = new Map();
  const daysByDate = new Map();
  const samples = [];
  for (const sample of sorted) {
    const date = battleFestivalPaceDate(sample.playedAt);
    if (!date) continue;
    const previous = previousByDate.get(date);
    const firstOfDay = !previous;
    const minutesSincePrevious = firstOfDay
      ? BATTLE_FESTIVAL_FIRST_MATCH_MINUTES
      : battleFestivalMinutesBetween(previous.playedAt, sample.playedAt);
    const meritDelta = previous ? Math.max(0, toNumber(sample.merit) - toNumber(previous.merit)) : 0;
    samples.push({
      observedAt: sample.playedAt,
      merit: toNumber(sample.merit),
      meritDelta,
      minutesSincePrevious,
      firstOfDay
    });

    const day = daysByDate.get(date) || {
      date,
      firstObservedAt: sample.playedAt,
      lastObservedAt: sample.playedAt,
      firstMerit: toNumber(sample.merit),
      lastMerit: toNumber(sample.merit),
      meritSampleCount: 0,
      observedMinutes: 0
    };
    day.lastObservedAt = sample.playedAt;
    day.lastMerit = toNumber(sample.merit);
    day.meritSampleCount += 1;
    day.observedMinutes += minutesSincePrevious;
    daysByDate.set(date, day);
    previousByDate.set(date, sample);
  }

  const days = Array.from(daysByDate.values()).map(battleFestivalPaceDayView);
  if (!days.length) return null;

  const period = battleFestivalPeriodPace(days);
  const latestDay = days[days.length - 1];
  const basis = latestDay.meritSampleCount >= 2 && latestDay.meritPerHour > 0 ? latestDay : period;
  const basisType = basis === latestDay ? "latest_day" : "all_observed";
  const latestSample = sorted[sorted.length - 1];
  const finalAt = `${finalDate || battleFestivalPaceDate(latestSample.playedAt)} 23:59`;
  const remainingMinutes = battleFestivalRemainingMinutes(latestSample.playedAt, finalAt);
  const projectedFinalMerit = Math.max(
    toNumber(latestSample.merit),
    Math.round(toNumber(latestSample.merit) + basis.meritPerHour / 60 * remainingMinutes)
  );

  return {
    days,
    samples,
    projection: {
      basis,
      basisType,
      latestObservedAt: latestSample.playedAt,
      latestMerit: toNumber(latestSample.merit),
      finalAt,
      remainingMinutes,
      projectedFinalMerit
    }
  };
}

function addBattleFestivalObservedResult(stats, result) {
  stats.sampleSize = toNumber(stats.sampleSize) + 1;
  if (result === "win") stats.winCount += 1;
  else if (result === "loss") stats.lossCount += 1;
  else if (result === "draw") stats.drawCount += 1;
  else stats.unknownCount += 1;
}

function battleFestivalObservedWinRate(stats) {
  const denominator = toNumber(stats.winCount) + toNumber(stats.lossCount) + toNumber(stats.drawCount);
  return denominator ? Number((toNumber(stats.winCount) / denominator * 100).toFixed(1)) : 0;
}

function battleFestivalMeritDeckView(deckId, stats, tierRowByDeckId, cardCatalog) {
  const row = tierRowByDeckId.get(deckId);
  const cards = row?.deckCards || deckCards(deckId, cardCatalog);
  return {
    deckId,
    deckName: row?.deckName || cards[0]?.name || deckId,
    faction: row?.faction || deckFaction(cards),
    sampleSize: toNumber(stats.sampleSize),
    winCount: toNumber(stats.winCount),
    lossCount: toNumber(stats.lossCount),
    drawCount: toNumber(stats.drawCount),
    unknownCount: toNumber(stats.unknownCount),
    winRate: battleFestivalObservedWinRate(stats),
    deckCards: cards
  };
}

function buildBattleFestivalMeritAnalysis(sides, matchById, deckIdBySideKey, tierRowByDeckId, cardCatalog, options = {}) {
  const players = new Map();
  for (const side of sides) {
    const playerName = firstText(side?.player_name);
    if (!playerName) continue;
    const matchId = toNumber(side?.match_id);
    const match = matchById.get(matchId) || {};
    const playedAt = firstText(match.played_at, match.created_at);
    const current = players.get(playerName) || {
      playerName,
      camps: new Map(),
      observedMatchIds: new Set(),
      winCount: 0,
      lossCount: 0,
      drawCount: 0,
      unknownCount: 0,
      observedSamples: [],
      meritSamples: [],
      decks: new Map()
    };

    current.observedMatchIds.add(matchId);
    const result = normalizedSideResult(side?.result);
    addBattleFestivalObservedResult(current, result);
    current.observedSamples.push({ playedAt, matchId });

    const camp = battleFestivalCamp(side);
    if (camp) current.camps.set(camp, (current.camps.get(camp) || 0) + 1);

    const merit = battleFestivalMerit(side);
    if (merit !== null) {
      current.meritSamples.push({ merit, playedAt, matchId });
    }
    const deckId = deckIdBySideKey.get(matchSideKey(side?.match_id, side?.side_index)) || "";
    if (deckId) {
      const deckStats = current.decks.get(deckId) || {
        sampleSize: 0,
        winCount: 0,
        lossCount: 0,
        drawCount: 0,
        unknownCount: 0
      };
      addBattleFestivalObservedResult(deckStats, result);
      current.decks.set(deckId, deckStats);
    }
    players.set(playerName, current);
  }

  const meritRows = Array.from(players.values())
    .map((player) => {
      const meritSamples = player.meritSamples.slice().sort(compareObservedSamples);
      if (!meritSamples.length) return null;
      const observedSamples = player.observedSamples.slice().sort(compareObservedSamples);
      const firstObserved = observedSamples[0] || meritSamples[0];
      const lastObserved = observedSamples[observedSamples.length - 1] || meritSamples[meritSamples.length - 1];
      const highestSample = meritSamples.slice().sort(compareHighestMeritSamples)[0];
      const pace = buildBattleFestivalMeritPace(meritSamples, options.finalDate);
      const decks = Array.from(player.decks.entries())
        .map(([deckId, stats]) => battleFestivalMeritDeckView(deckId, stats, tierRowByDeckId, cardCatalog))
        .sort((left, right) =>
          right.sampleSize - left.sampleSize ||
          right.winRate - left.winRate ||
          left.deckName.localeCompare(right.deckName, "ja")
        )
        .slice(0, BATTLE_FESTIVAL_PLAYER_DECK_LIMIT);
      return {
        playerName: player.playerName,
        camp: mostCommonText(player.camps),
        firstSeenAt: firstObserved.playedAt,
        lastSeenAt: lastObserved.playedAt,
        highestMerit: highestSample.merit,
        highestMeritSeenAt: highestSample.playedAt,
        meritSampleCount: meritSamples.length,
        observedMatchCount: player.observedMatchIds.size,
        winCount: player.winCount,
        lossCount: player.lossCount,
        drawCount: player.drawCount,
        unknownCount: player.unknownCount,
        winRate: battleFestivalObservedWinRate(player),
        decks,
        pace
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      return right.highestMerit - left.highestMerit ||
        right.observedMatchCount - left.observedMatchCount ||
        right.winRate - left.winRate ||
        right.meritSampleCount - left.meritSampleCount ||
        left.playerName.localeCompare(right.playerName, "ja");
    });

  const meritSummary = {
    observedPlayerCount: players.size,
    meritPlayerCount: meritRows.length,
    meritSampleCount: meritRows.reduce((sum, row) => sum + row.meritSampleCount, 0),
    highestMerit: meritRows[0]?.highestMerit || 0,
    topPlayerName: meritRows[0]?.playerName || "",
    observedMatchCount: meritRows.reduce((sum, row) => sum + row.observedMatchCount, 0)
  };
  return { meritRows, meritSummary };
}

function addBattleFestivalDeckResult(statsByDeck, deckId, result) {
  const current = statsByDeck.get(deckId) || {
    deck_fingerprint: deckId,
    sample_count: 0,
    win_count: 0,
    loss_count: 0,
    draw_count: 0
  };
  current.sample_count += 1;
  if (result === "win") current.win_count += 1;
  if (result === "loss") current.loss_count += 1;
  if (result === "draw") current.draw_count += 1;
  current.win_rate = current.sample_count ? current.win_count / current.sample_count : 0;
  statsByDeck.set(deckId, current);
}

function battleFestivalDeckStats(statsByDeck) {
  return Array.from(statsByDeck.values());
}

function battleFestivalClassifierDecks(deckStats) {
  return deckStats.map((row) => ({
    deckId: row.deck_fingerprint,
    deckName: row.deck_fingerprint,
    cards: String(row.deck_fingerprint).split(",").filter(Boolean),
    sampleCount: toNumber(row.sample_count),
    winCount: toNumber(row.win_count),
    lossCount: toNumber(row.loss_count),
    drawCount: toNumber(row.draw_count)
  }));
}

function buildBattleFestivalTierRows(deckStats, cardCatalog, strategyTypes, options = {}) {
  const classification = classifyAnalysisDecks(battleFestivalClassifierDecks(deckStats), cardCatalog, {
    now: new Date().toISOString(),
    strategyTypes
  });
  const rows = buildTierRows(deckStats, classification, cardCatalog);
  const camp = String(options.camp || "").trim();
  return camp ? rows.map((row) => ({ ...row, battleCamp: camp })) : rows;
}

function buildBattleFestivalCampShare(statsByCamp, rowsByCamp) {
  const entries = Array.from(statsByCamp.entries())
    .map(([camp, statsByDeck]) => {
      const stats = battleFestivalDeckStats(statsByDeck);
      const sampleSize = stats.reduce((sum, row) => sum + toNumber(row.sample_count), 0);
      const winCount = stats.reduce((sum, row) => sum + toNumber(row.win_count), 0);
      const rows = rowsByCamp[camp]?.tierRows || [];
      return {
        camp,
        sampleSize,
        winRate: sampleSize ? Number((winCount / sampleSize * 100).toFixed(1)) : 0,
        representatives: rows.slice(0, 2).map((row) => row.deckName)
      };
    })
    .filter((entry) => entry.camp && entry.sampleSize > 0)
    .sort((left, right) => right.sampleSize - left.sampleSize || left.camp.localeCompare(right.camp, "ja"));

  const total = entries.reduce((sum, entry) => sum + entry.sampleSize, 0);
  const rounded = entries.map((entry) => ({
    ...entry,
    share: total ? Math.round(entry.sampleSize / total * 100) : 0
  }));
  const diff = 100 - rounded.reduce((sum, entry) => sum + entry.share, 0);
  if (rounded.length && Math.abs(diff) <= rounded.length) rounded[0].share += diff;
  return rounded;
}

async function buildBattleFestivalSnapshotFromMatches(shareConfig, uploadScope = null, periodScope = null) {
  const scope = battleFestivalMetadataScope(shareConfig, uploadScope, periodScope);
  if (!scope) {
    if (uploadScope) throw new Error("Battle festival official period is not available.");
    throw new Error("No ready battle festival leaderboard run.");
  }
  const filterScope = {
    target_version: scope.targetVersion,
    date_from: scope.filterDateFrom,
    date_to: scope.filterDateTo
  };
  const matches = await readJsonl(
    resolve(legacyRoot, "tables/matches.jsonl"),
    (match) => matchesBattleFestivalScope(match, filterScope)
  );
  const matchIds = new Set(matches.map((match) => toNumber(match.id)));
  const matchById = new Map(matches.map((match) => [toNumber(match.id), match]));
  if (!matchIds.size) {
    if (uploadScope) return emptyBattleFestivalSnapshot(shareConfig, uploadScope, periodScope);
    throw new Error("No ready battle festival leaderboard run.");
  }

  const matchDecks = await readJsonl(
    resolve(legacyRoot, "tables/match_decks.jsonl"),
    (deck) => matchIds.has(toNumber(deck.match_id))
  );
  const deckRowIds = new Set(matchDecks.map((deck) => toNumber(deck.id)));
  const deckUnits = await readJsonl(
    resolve(legacyRoot, "tables/match_deck_units.jsonl"),
    (unit) => deckRowIds.has(toNumber(unit.deck_id))
  );
  const unitsByDeckId = new Map();
  for (const unit of deckUnits) {
    const deckId = toNumber(unit.deck_id);
    if (!unitsByDeckId.has(deckId)) unitsByDeckId.set(deckId, []);
    unitsByDeckId.get(deckId).push(unit);
  }
  const deckIdBySideKey = new Map(matchDecks.map((deck) => [
    matchSideKey(deck.match_id, deck.side_index),
    battleFestivalDeckId(deck, unitsByDeckId)
  ]));

  const sideKeys = new Set(matchDecks.map((deck) => matchSideKey(deck.match_id, deck.side_index)));
  const sides = await readJsonl(
    resolve(legacyRoot, "tables/match_sides.jsonl"),
    (side) => sideKeys.has(matchSideKey(side.match_id, side.side_index))
  );
  const sideByKey = new Map(sides.map((side) => [matchSideKey(side.match_id, side.side_index), side]));

  const statsByDeck = new Map();
  const statsByCamp = new Map();
  for (const deck of matchDecks) {
    const deckId = battleFestivalDeckId(deck, unitsByDeckId);
    if (!deckId) continue;
    const side = sideByKey.get(matchSideKey(deck.match_id, deck.side_index));
    const result = normalizedSideResult(side?.result);
    if (!result) continue;
    addBattleFestivalDeckResult(statsByDeck, deckId, result);
    const camp = battleFestivalCamp(side);
    if (!camp) continue;
    if (!statsByCamp.has(camp)) statsByCamp.set(camp, new Map());
    addBattleFestivalDeckResult(statsByCamp.get(camp), deckId, result);
  }

  const deckStats = battleFestivalDeckStats(statsByDeck);
  if (!deckStats.length) {
    if (uploadScope) return emptyBattleFestivalSnapshot(shareConfig, uploadScope, periodScope);
    throw new Error("No ready battle festival leaderboard run.");
  }

  const cardCatalog = await loadCardCatalog();
  const strategyTypes = await readOptionalJson(resolve(legacyRoot, "cards/card_strategy_types.json"), []);
  const tierRows = buildBattleFestivalTierRows(deckStats, cardCatalog, strategyTypes);
  const tierRowByDeckId = new Map(tierRows.map((row) => [row.deckId, row]));
  const { meritRows, meritSummary } = buildBattleFestivalMeritAnalysis(
    sides,
    matchById,
    deckIdBySideKey,
    tierRowByDeckId,
    cardCatalog,
    { finalDate: scope.dateTo }
  );
  const rowsByCamp = {};
  for (const [camp, campStatsByDeck] of statsByCamp.entries()) {
    const campStats = battleFestivalDeckStats(campStatsByDeck);
    if (!campStats.length) continue;
    const campRows = buildBattleFestivalTierRows(campStats, cardCatalog, strategyTypes, { camp });
    rowsByCamp[camp] = {
      tierRows: campRows,
      clusterRows: campRows
    };
  }
  const campShare = buildBattleFestivalCampShare(statsByCamp, rowsByCamp);
  const representativeDecks = balancedUsageWinRows(tierRows, 4, {
    minWinRate: 54,
    minUsageRate: 0.6,
    minUsageShareOfMax: 0.15,
    minSampleSize: 1
  });
  const topDeck = tierRows[0] || null;
  const topShareTotal = buildFactionShare(tierRows).slice(0, 3).reduce((sum, item) => sum + item.share, 0);

  return {
    metadata: {
      sourceRunId: 0,
      sourceKind: "battle_festival",
      targetVersion: scope.targetVersion,
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      updatedAt: new Date().toISOString(),
      sampleSize: deckStats.reduce((sum, row) => sum + toNumber(row.sample_count), 0),
      periodSourceUploadId: scope.periodSourceUploadId,
      periodSourcePackageId: scope.periodSourcePackageId,
      periodStatus: scope.periodStatus,
      festivalPeriodSource: scope.festivalPeriodSource,
      ...battleFestivalSourceUploadMetadata(uploadScope)
    },
    home: {
      factionShare: buildFactionShare(tierRows),
      representativeDecks,
      featuredCards: featuredCardsFromTopUsageDecks(tierRows, 4),
      summary: topDeck
        ? `前三区间合计 ${topShareTotal}%，战祭榜单按战祭对局样本自动排序。`
        : "当前没有可展示的战祭数据。",
      tierRows
    },
    clusterRows: tierRows,
    tierRows,
    battleFestival: {
      camps: campShare.map((item) => item.camp),
      campShare,
      rowsByCamp,
      meritRows,
      meritSummary
    }
  };
}

async function buildSnapshotFromData(options = {}) {
  const shareConfig = latestShareConfig(await readJsonl(resolve(legacyRoot, "tables/server_share_config.jsonl")));
  const formalRuns = await readJsonl(resolve(legacyRoot, "tables/server_leaderboard_runs.jsonl"));
  const targetVersion = String(options.targetVersion || shareConfig?.target_version || "").trim();
  const formalRun = latestFormalRun(formalRuns, targetVersion, {
    includeSolo: Boolean(options.includeSolo),
    includeBattleFestival: Boolean(options.includeBattleFestival)
  });

  if (formalRun) {
    const formalRows = await readJsonl(resolve(legacyRoot, "tables/server_leaderboard_rows.jsonl"));
    const cardCatalog = await loadCardCatalog();
    const strategyTypes = await readOptionalJson(resolve(legacyRoot, "cards/card_strategy_types.json"), []);
    const snapshot = await buildFormalSnapshot(formalRun, formalRows, cardCatalog, strategyTypes, {
      sourceKind: options.sourceKind
    });
    return snapshot;
  }

  if (options.includeBattleFestival) {
    const uploadRows = await readOptionalJsonl(resolve(legacyRoot, "tables/server_uploads.jsonl"));
    const packageRows = await readOptionalJsonl(resolve(legacyRoot, "tables/shared_contribution_packages.jsonl"));
    const uploadScope = latestBattleFestivalScope(uploadRows, packageRows, shareConfig);
    const periodScope = latestBattleFestivalPeriodScope(uploadRows, packageRows, shareConfig);
    return buildBattleFestivalSnapshotFromMatches(shareConfig, uploadScope, periodScope);
  }

  if (options.includeSolo) {
    throw new Error("No ready battle festival leaderboard run.");
  }

  const runs = await readJsonl(resolve(legacyRoot, "tables/analysis_runs.jsonl"));
  const run = latestCompletedRun(runs);
  const runId = toNumber(run.id);
  const deckStats = await readJsonl(
    resolve(legacyRoot, "tables/analysis_deck_stats.jsonl"),
    (row) => toNumber(row.analysis_run_id) === runId && row.sample_scope === "all_players"
  );
  const cardCatalog = await loadCardCatalog();
  const strategyTypes = await readOptionalJson(resolve(legacyRoot, "cards/card_strategy_types.json"), []);
  const classifierDecks = deckStats.map((row) => ({
    deckId: row.deck_fingerprint,
    deckName: row.deck_fingerprint,
    cards: String(row.deck_fingerprint).split(",").filter(Boolean),
    sampleCount: toNumber(row.sample_count),
    winCount: toNumber(row.win_count),
    lossCount: toNumber(row.loss_count),
    drawCount: toNumber(row.draw_count)
  }));
  const classification = classifyAnalysisDecks(classifierDecks, cardCatalog, {
    now: run.finished_at || new Date().toISOString(),
    strategyTypes
  });
  const tierRows = buildTierRows(deckStats, classification, cardCatalog);
  const representativeDecks = balancedUsageWinRows(tierRows, 4, {
    minWinRate: 54,
    minUsageRate: 0.6,
    minUsageShareOfMax: 0.15,
    minSampleSize: 10
  });
  const topDeck = tierRows[0] || null;
  const topShareTotal = buildFactionShare(tierRows).slice(0, 3).reduce((sum, item) => sum + item.share, 0);

  const snapshot = {
    metadata: {
      sourceRunId: runId,
      dateFrom: run.date_from,
      dateTo: run.date_to,
      updatedAt: run.finished_at,
      sampleSize: toNumber(run.counts_json?.side_samples)
    },
    home: {
      factionShare: buildFactionShare(tierRows),
      representativeDecks,
      featuredCards: featuredCardsFromTopUsageDecks(tierRows, 4),
      summary: topDeck
        ? `前三势力合计 ${topShareTotal}%，Top 3 卡组按综合 Rank 自动排序。`
        : "当前无可展示榜单数据。",
      tierRows
    },
    clusterRows: tierRows,
    tierRows
  };

  return snapshot;
}

export async function buildLeaderboardSnapshot(options = {}) {
  const previousLegacyRoot = legacyRoot;
  const previousDiagnosticsEnabled = diagnosticsEnabled;
  const previousUnitTypeRepairWarnings = unitTypeRepairWarnings;
  legacyRoot = options.legacyRoot ? resolve(options.legacyRoot) : defaultLegacyRoot;
  diagnosticsEnabled = Boolean(options.logDiagnostics);
  unitTypeRepairWarnings = new Set();

  try {
    return await buildSnapshotFromData({
      includeSolo: Boolean(options.includeSolo),
      includeBattleFestival: Boolean(options.includeBattleFestival),
      sourceKind: options.sourceKind,
      targetVersion: options.targetVersion
    });
  } finally {
    legacyRoot = previousLegacyRoot;
    diagnosticsEnabled = previousDiagnosticsEnabled;
    unitTypeRepairWarnings = previousUnitTypeRepairWarnings;
  }
}

export async function buildLeaderboardVersionManifest(options = {}) {
  const previousLegacyRoot = legacyRoot;
  legacyRoot = options.legacyRoot ? resolve(options.legacyRoot) : defaultLegacyRoot;

  try {
    const shareConfig = latestShareConfig(await readJsonl(resolve(legacyRoot, "tables/server_share_config.jsonl")));
    const formalRuns = await readJsonl(resolve(legacyRoot, "tables/server_leaderboard_runs.jsonl"));
    const latestRuns = latestFormalRunsByVersion(formalRuns, {
      includeSolo: Boolean(options.includeSolo),
      includeBattleFestival: Boolean(options.includeBattleFestival)
    });
    const configuredVersion = String(options.targetVersion || shareConfig?.target_version || "").trim();
    const currentRun = latestFormalRun(formalRuns, configuredVersion, {
      includeSolo: Boolean(options.includeSolo),
      includeBattleFestival: Boolean(options.includeBattleFestival)
    }) || latestRuns[0] || null;
    const currentTargetVersion = String(currentRun?.target_version || configuredVersion || "").trim();
    const versions = latestRuns
      .map((run) => versionManifestEntry(run, currentTargetVersion))
      .sort((left, right) => {
        if (left.current !== right.current) return left.current ? -1 : 1;
        return right.sourceRunId - left.sourceRunId;
      });

    return {
      schemaVersion: VERSION_MANIFEST_SCHEMA_VERSION,
      currentTargetVersion,
      versions
    };
  } finally {
    legacyRoot = previousLegacyRoot;
  }
}

export async function writeLeaderboardSnapshot(options = {}) {
  const outputPath = resolve(options.outputPath || resolve(repoRoot, "apps/web/public/data/leaderboard-snapshot.json"));
  const snapshot = await buildLeaderboardSnapshot({
    ...options,
    logDiagnostics: options.logDiagnostics ?? true
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return { snapshot, outputPath };
}

async function main() {
  const { snapshot, outputPath } = await writeLeaderboardSnapshot({ outputPath: process.argv[2] });
  const sourceKind = snapshot.metadata.sourceKind || "analysis";
  console.log(`snapshot=${outputPath}`);
  console.log(`${sourceKind}Run=${snapshot.metadata.sourceRunId} decks=${snapshot.tierRows.length} cards=${snapshot.home.featuredCards.length}`);
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
