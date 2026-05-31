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

function dateTimeSource(value: string): string {
  const text = String(value || "").trim().replace(" ", "T");
  if (!text) return "";
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`;
}

export function dateTime(value: string): string {
  const date = new Date(dateTimeSource(value));
  if (Number.isNaN(date.getTime())) {
    return String(value || "").replace("T", " ").slice(0, 16) || "无更新时间";
  }

  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

export function periodLabel(value: string): string {
  const date = dateOnly(value);
  return date === "无更新时间" ? date : `${date} 数据概览`;
}

export function topFactionSummary(items: { faction: string; share: number }[], limit = 3): string {
  return items.slice(0, limit).map((item) => `${item.faction} ${item.share}%`).join(" / ");
}
