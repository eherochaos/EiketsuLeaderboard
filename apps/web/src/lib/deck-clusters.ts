import type { DeckRow } from "../types";

export type DeckCluster = {
  key: string;
  rows: DeckRow[];
  activeIndex: number;
  activeRow: DeckRow;
  displayRow: DeckRow;
};

type DeckRowComparator = (left: DeckRow, right: DeckRow) => number;

export function compareDeckRowsByRank(left: DeckRow, right: DeckRow): number {
  return left.rankScore - right.rankScore ||
    right.sampleSize - left.sampleSize ||
    right.winRate - left.winRate ||
    left.deckName.localeCompare(right.deckName, "ja");
}

function compareClusterVariants(left: DeckRow, right: DeckRow): number {
  return right.sampleSize - left.sampleSize ||
    left.rankScore - right.rankScore ||
    right.winRate - left.winRate ||
    left.deckName.localeCompare(right.deckName, "ja");
}

function rounded(value: number, digits = 1): number {
  return Number((Number.isFinite(value) ? value : 0).toFixed(digits));
}

function weightedPercent(rows: DeckRow[], key: "winRate" | "playerAverageWinRate"): number {
  const sampleSize = rows.reduce((sum, row) => sum + row.sampleSize, 0);
  if (!sampleSize) return 0;
  return rounded(rows.reduce((sum, row) => sum + row[key] * row.sampleSize, 0) / sampleSize);
}

function aggregateChoiceItems(rows: DeckRow[], key: "weapons" | "styles" | "souls", sampleSize: number): DeckRow["deckConfig"]["weapons"] {
  const byName = new Map<string, { name: string; sampleSize: number }>();
  for (const row of rows) {
    for (const item of row.deckConfig[key] ?? []) {
      const name = item.name || "未识别";
      const current = byName.get(name) || { name, sampleSize: 0 };
      current.sampleSize += item.sampleSize;
      byName.set(name, current);
    }
  }

  return Array.from(byName.values())
    .map((item) => ({
      name: item.name,
      sampleSize: item.sampleSize,
      usageRate: sampleSize ? rounded(item.sampleSize / sampleSize * 100) : 0,
      lowSample: item.sampleSize < 5
    }))
    .sort((left, right) => right.sampleSize - left.sampleSize || left.name.localeCompare(right.name, "ja"))
    .slice(0, 3);
}

function aggregateStrategyItems(rows: DeckRow[]): DeckRow["deckConfig"]["strategies"] {
  const byCard = new Map<string, { cardId: string; name: string; strategyCount: number; sampleSize: number }>();
  for (const row of rows) {
    for (const item of row.deckConfig.strategies ?? []) {
      const key = item.cardId || item.name;
      const current = byCard.get(key) || { cardId: item.cardId, name: item.name, strategyCount: 0, sampleSize: 0 };
      current.strategyCount += item.strategyCount;
      current.sampleSize += item.sampleSize;
      byCard.set(key, current);
    }
  }

  const items = Array.from(byCard.values()).map((item) => ({
    ...item,
    averageCount: item.sampleSize ? rounded(item.strategyCount / item.sampleSize, 2) : 0,
    usageRate: 0
  }));
  const maxAverage = Math.max(...items.map((item) => item.averageCount), 0);

  return items
    .map((item) => ({
      ...item,
      usageRate: maxAverage ? rounded(item.averageCount / maxAverage * 100) : 0
    }))
    .sort((left, right) => right.averageCount - left.averageCount || right.sampleSize - left.sampleSize || left.name.localeCompare(right.name, "ja"))
    .slice(0, 3);
}

function aggregateSchoolStages(rows: DeckRow[], sampleSize: number): DeckRow["deckConfig"]["schoolStages"] {
  const byStage = new Map<string, { name: string; stage: string; sampleSize: number }>();
  for (const row of rows) {
    for (const item of row.deckConfig.schoolStages ?? []) {
      const key = `${item.stage}:${item.name}`;
      const current = byStage.get(key) || { name: item.name, stage: item.stage, sampleSize: 0 };
      current.sampleSize += item.sampleSize;
      byStage.set(key, current);
    }
  }

  return Array.from(byStage.values())
    .map((item) => ({
      name: item.name,
      stage: item.stage,
      sampleSize: item.sampleSize,
      usageRate: sampleSize ? rounded(item.sampleSize / sampleSize * 100) : 0,
      averageCount: sampleSize ? rounded(item.sampleSize / sampleSize, 2) : 0,
      lowSample: item.sampleSize < 5
    }))
    .sort((left, right) => right.averageCount - left.averageCount || right.sampleSize - left.sampleSize || left.name.localeCompare(right.name, "ja"))
    .slice(0, 3);
}

function aggregateUnfavorableMatchups(rows: DeckRow[]): DeckRow["deckConfig"]["unfavorableMatchups"] {
  const byDeck = new Map<string, { deckId: string; deckName: string; sampleSize: number }>();
  for (const row of rows) {
    for (const item of row.deckConfig.unfavorableMatchups ?? []) {
      const current = byDeck.get(item.deckId) || { deckId: item.deckId, deckName: item.deckName, sampleSize: 0 };
      current.sampleSize += item.sampleSize;
      byDeck.set(item.deckId, current);
    }
  }

  const totalLosses = rows.reduce((sum, row) => sum + row.sampleSize * Math.max(100 - row.winRate, 0) / 100, 0);
  return Array.from(byDeck.values())
    .map((item) => ({
      ...item,
      usageRate: totalLosses ? rounded(item.sampleSize / totalLosses * 100) : 0
    }))
    .sort((left, right) => right.sampleSize - left.sampleSize || right.usageRate - left.usageRate || left.deckName.localeCompare(right.deckName, "ja"))
    .slice(0, 3);
}

function clusterEvidenceTags(row: DeckRow, variantCount: number): string[] {
  const tags = [`综合 Rank ${row.rankScore}`, `${variantCount} 式样`];
  if (row.usageRate >= 2) tags.push("使用率高");
  if (row.winRate >= 54) tags.push("胜率高");
  if (row.sampleSize >= 20) tags.push("样本稳定");
  return tags;
}

function aggregateClusterRow(key: string, variants: DeckRow[], activeRow: DeckRow): DeckRow {
  const sampleSize = variants.reduce((sum, row) => sum + row.sampleSize, 0);
  const usageRate = rounded(variants.reduce((sum, row) => sum + row.usageRate, 0));
  const rankScore = Math.min(...variants.map((row) => row.rankScore));
  const sourceRank = Math.min(...variants.map((row) => row.sourceRank ?? Number.MAX_SAFE_INTEGER));

  return {
    ...activeRow,
    deckId: activeRow.deckId,
    deckName: key,
    rankScore,
    sourceRank: Number.isFinite(sourceRank) ? sourceRank : activeRow.sourceRank,
    winRate: weightedPercent(variants, "winRate"),
    playerAverageWinRate: weightedPercent(variants, "playerAverageWinRate"),
    usageRate,
    sampleSize,
    deckConfig: {
      weapons: aggregateChoiceItems(variants, "weapons", sampleSize),
      styles: aggregateChoiceItems(variants, "styles", sampleSize),
      souls: aggregateChoiceItems(variants, "souls", sampleSize),
      strategies: aggregateStrategyItems(variants),
      schoolStages: aggregateSchoolStages(variants, sampleSize),
      unfavorableMatchups: aggregateUnfavorableMatchups(variants)
    },
    evidenceTags: clusterEvidenceTags(activeRow, variants.length)
  };
}

export function createSameNameDeckClusters(
  rows: DeckRow[],
  options: { variantIndexes?: Record<string, number>; compareRows?: DeckRowComparator } = {}
): DeckCluster[] {
  const grouped = new Map<string, DeckRow[]>();
  for (const row of rows) {
    const key = row.deckName || row.deckId;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  const compareRows = options.compareRows ?? compareDeckRowsByRank;
  const variantIndexes = options.variantIndexes ?? {};

  return Array.from(grouped.entries())
    .map(([key, groupRows]) => {
      const variants = groupRows.slice().sort(compareClusterVariants);
      const savedIndex = variantIndexes[key] ?? 0;
      const activeIndex = Math.min(Math.max(savedIndex, 0), Math.max(variants.length - 1, 0));
      const activeRow = variants[activeIndex] ?? variants[0];
      return activeRow ? {
        key,
        rows: variants,
        activeIndex,
        activeRow,
        displayRow: aggregateClusterRow(key, variants, activeRow)
      } : null;
    })
    .filter((cluster): cluster is DeckCluster => Boolean(cluster))
    .sort((left, right) => compareRows(left.displayRow, right.displayRow));
}
