/**
 * Money helpers. All arithmetic in the app is on integer pence or basis points.
 * The rights-premium comparison is code, never the model.
 */

/**
 * Parse a displayed price like "£249.00", "£1,249", "249.00", or "£8.50" into pence.
 * Returns null when there is no single parseable amount (e.g. "£20 – £30", "Free", "").
 */
/** True when the string itself is a monthly tariff, not a one-off. */
export function priceStringLooksMonthly(input: string): boolean {
  return /\/\s*mo(?:nth)?s?\b|per\s+month|\ba\s+month\b|\bp\s*\/\s*m\b|(?:^|[^\w/])pm(?:$|[^\w])|\bmonthly\b/i.test(
    input,
  );
}

export function parsePricePence(input: string | null | undefined): number | null {
  if (!input) return null;
  if (priceStringLooksMonthly(input)) return null;
  const cleaned = input.replace(/[£,\s]/g, "").replace(/^GBP/i, "");
  // Reject ranges and anything with more than one number.
  if (/[–\-]/.test(cleaned) || (cleaned.match(/\d+(\.\d+)?/g) ?? []).length !== 1) {
    return null;
  }
  const match = cleaned.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const pounds = Number(match[1]);
  const penceStr = (match[2] ?? "").padEnd(2, "0");
  const pence = Number(penceStr);
  if (!Number.isFinite(pounds) || !Number.isFinite(pence)) return null;
  return pounds * 100 + pence;
}

/** Format a monthly tariff as "£30/mo" (drop trailing .00). */
export function formatMonthlyPence(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(Math.round(pence));
  const pounds = Math.floor(abs / 100);
  const rem = abs % 100;
  const amount =
    rem === 0
      ? `${sign}£${pounds.toLocaleString("en-GB")}`
      : `${sign}£${pounds.toLocaleString("en-GB")}.${String(rem).padStart(2, "0")}`;
  return `${amount}/mo`;
}

/** Format integer pence as "£249.00". Negative values keep the sign: "-£3.50". */
export function formatPence(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(Math.round(pence));
  const pounds = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}£${pounds.toLocaleString("en-GB")}.${String(rem).padStart(2, "0")}`;
}

/** Format integer basis points as a percent label: 2500 → "25%". */
export function formatBps(bps: number): string {
  return `${Math.round(bps / 100)}%`;
}
