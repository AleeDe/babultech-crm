export type ProductOptionKind = "category" | "unit";

export function optionKey(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").replace(/^license$/, "licence");
}

export function similarOption(a: string, b: string) {
  const x = optionKey(a), y = optionKey(b);
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 4) return false;
  const distance = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let diagonal = distance[0];
    distance[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const previous = distance[j];
      distance[j] = Math.min(distance[j] + 1, distance[j - 1] + 1, diagonal + (x[i - 1] === y[j - 1] ? 0 : 1));
      diagonal = previous;
    }
  }
  return distance[y.length] <= (Math.min(x.length, y.length) >= 8 ? 2 : 1);
}

export const BILLING_OPTIONS = ["FIXED", "HOURLY", "MONTHLY", "RETAINER", "MILESTONE", "ANNUAL"] as const;

export function priceBasis(billing: string, unit?: string | null) {
  const period: Record<string, string> = { HOURLY: "hour", MONTHLY: "month", ANNUAL: "year", MILESTONE: "milestone" };
  const per = period[billing];
  const item = unit?.trim().toLowerCase();
  if (per) return item && item !== "each" && optionKey(item) !== optionKey(per)
    ? `per ${item}, per ${per}` : `per ${per}`;
  return `${item ? `per ${item}` : "per unit"}${billing === "FIXED" ? ", one-time" : ", per agreed retainer period"}`;
}
