/**
 * Grok decision — owned by the Decision+UI agent.
 *
 * xAI is OpenAI-compatible: `new OpenAI({ baseURL: "https://api.x.ai/v1", apiKey: process.env.XAI_API_KEY })`.
 * Input is the shortlist (`Offer[]` or `Listing[]`) plus the user's ask; output is a
 * `Verdict` validated with `VerdictSchema`. Grok judges same-item, mislisting (from photos),
 * seller type, venue trust and rights. The pound comparison stays in code.
 */
export type { Decision, Verdict, Listing, Offer } from "@/lib/types";
