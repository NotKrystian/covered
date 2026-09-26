/**
 * Onboarding progress in localStorage, so a reload resumes the same step with the
 * same answers, and a finished onboarding survives the server losing its memory
 * (on a laptop without DynamoDB, memory lives in the dev server process).
 *
 * Per-browser convenience only: the server stays the source of truth, and the
 * wallet balance is never restored from here.
 */
import { z } from "zod";
import { UserSettingsSchema } from "@/lib/types";

const KEY = "covered_onboarding";

const OnboardingProgressSchema = z.object({
  step: z.number().int().min(1).max(10),
  name: z.string().max(40),
  settings: UserSettingsSchema,
  deposit: z.string().max(12),
  /** True once the final step saved: the answers can restore a lost server memory. */
  done: z.boolean(),
});
export type OnboardingProgress = z.infer<typeof OnboardingProgressSchema>;

export function loadOnboarding(): OnboardingProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = OnboardingProgressSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // Private mode or blocked storage: start fresh.
  }
}

export function saveOnboarding(progress: OnboardingProgress): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // Storage unavailable: onboarding still works, it just will not resume.
  }
}

export function clearOnboarding(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
