/**
 * Money helpers. All arithmetic in the app is on integer pence.
 * The pound comparison is code, never Grok.
 */

/**
 * Parse a displayed price like "£249.00", "£1,249", "249.00", or "£8.50" into pence.
 * Returns null when there is no single parseable amount (e.g. "£20 – £30", "Free", "").
 */
export function parsePricePence(input: string | null | undefined): number | null {
  if (!input) return null;
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

/** Format integer pence as "£249.00". Negative values keep the sign: "-£3.50". */
export function formatPence(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(Math.round(pence));
  const pounds = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}£${pounds.toLocaleString("en-GB")}.${String(rem).padStart(2, "0")}`;
}
