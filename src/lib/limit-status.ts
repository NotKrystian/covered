import type { Limit, LimitStatus } from "@/lib/memory";

export type LimitDisplayStatus = LimitStatus | "wallet short";

/** UI status: wallet-short stays `watching` in storage and is inferred from last_result. */
export function displayLimitStatus(limit: Pick<Limit, "status" | "last_result">): LimitDisplayStatus {
  switch (limit.status) {
    case "filled":
      return "filled";
    case "paused":
      return "paused";
    case "watching":
      return /wallet is short/i.test(limit.last_result) ? "wallet short" : "watching";
    default: {
      const never: never = limit.status;
      return never;
    }
  }
}
