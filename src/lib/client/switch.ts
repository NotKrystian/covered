/**
 * Client calls for the 14-day price-drop switch. "Check now" reads the grid in the
 * buyer's own browser session (same path as a search), then asks the server to judge
 * it; the demo simulation is built server-side and always labelled as such.
 */
import type { SwitchWatch } from "@/lib/switch";
import type { OrderRecord } from "@/lib/memory";
import { liveGridErrorLine, readLiveGrid } from "@/lib/client/shop";

export type { SwitchWatch };

export type SwitchCheckResult = { ok: true; order: OrderRecord; found: boolean } | { ok: false; error: string };
export type SwitchAcceptResult =
  | { ok: true; new_order_id: string; refund_pence: number; clear_pence: number; balance_pence: number }
  | { ok: false; status: number; error: string };

export async function fetchSwitchWatches(): Promise<SwitchWatch[]> {
  try {
    const res = await fetch("/api/switch");
    const json = (await res.json().catch(() => null)) as { ok?: boolean; watches?: SwitchWatch[] } | null;
    return res.ok && json?.ok && Array.isArray(json.watches) ? json.watches : [];
  } catch {
    return [];
  }
}

async function postJson<T>(url: string, body: unknown): Promise<{ status: number; json: T | null }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as T | null };
}

/** Re-read the order's query in this browser and judge whether a switch clears. */
export async function checkSwitchNow(order: OrderRecord): Promise<SwitchCheckResult> {
  const read = await readLiveGrid(order.query);
  if (!read.ok) return { ok: false, error: liveGridErrorLine(read.reason) };
  try {
    const { json } = await postJson<SwitchCheckResult>("/api/switch/run", {
      order_id: order.id,
      offers: read.result.offers,
    });
    return json ?? { ok: false, error: "Check failed." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Check failed." };
  }
}

/** The labelled demo: the same listing cheaper, through the real judge and rule. */
export async function simulateSwitch(orderId: string): Promise<SwitchCheckResult> {
  try {
    const { json } = await postJson<SwitchCheckResult>("/api/switch/simulate", { order_id: orderId });
    return json ?? { ok: false, error: "Simulation failed." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Simulation failed." };
  }
}

export async function acceptSwitch(orderId: string): Promise<SwitchAcceptResult> {
  try {
    const { status, json } = await postJson<SwitchAcceptResult>("/api/switch/accept", { order_id: orderId });
    if (!json) return { ok: false, status, error: `Switch failed (${status}).` };
    return json.ok ? json : { ...json, status };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "Switch failed." };
  }
}
