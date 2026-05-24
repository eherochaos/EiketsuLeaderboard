export const sourceLabels: Record<string, string> = {
  single: "单卡",
  combo: "组合",
  type: "类型"
};

export function percent(value: number): string {
  return `${Number(value || 0).toFixed(1)}%`;
}

export function integer(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value || 0));
}

export function dateOnly(value: string): string {
  return String(value || "").slice(0, 10) || "无更新时间";
}

export function dateTime(value: string): string {
  return String(value || "").replace("T", " ").slice(0, 16) || "无更新时间";
}

export function periodLabel(value: string): string {
  const date = dateOnly(value);
  return date === "无更新时间" ? date : `${date} 数据概览`;
}

export function topFactionSummary(items: { faction: string; share: number }[], limit = 3): string {
  return items.slice(0, limit).map((item) => `${item.faction} ${item.share}%`).join(" / ");
}
