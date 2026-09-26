/**
 * Identify the product the user asked for before any listing is judged.
 *
 * A model code like N990F is not something Haiku can be assumed to know. We
 * fetch a couple of Google-less pages (DuckDuckGo HTML / instant answer,
 * Wikipedia opensearch), then ask Bedrock for a JSON brief. Fetch or Bedrock
 * failure still returns a brief: distinctive query tokens, confidence low.
 */
import type { Message } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import { converse, errorLabel, isAccessError, judgeMode } from "./bedrock";

export const ProductBriefSchema = z.object({
  query: z.string(),
  what_it_is: z.string(),
  brand: z.string().default(""),
  model_codes: z.array(z.string()).default([]),
  category: z.string().default("unknown"),
  key_specs: z.array(z.string()).default([]),
  must_match: z.array(z.string()).default([]),
  must_not_be: z.array(z.string()).default([]),
  notes: z.string().default(""),
  confidence: z.enum(["high", "medium", "low"]).default("low"),
});
export type ProductBrief = z.infer<typeof ProductBriefSchema>;

export type ResearchSource = "duckduckgo" | "wikipedia" | "bedrock" | "tokens";

export type ResearchResult = {
  brief: ProductBrief;
  source: ResearchSource;
};

export type Snippet = { title: string; text: string };

const FETCH_MS = 6_000;
const RESEARCH_MAX_TOKENS = 800;
const SNIPPET_CAP = 8;
const UA = "Covered/1.0 (https://covered.kawuc.uk; shopping product research)";

const QUERY_STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "for",
  "of",
  "in",
  "on",
  "to",
  "with",
  "inch",
  "inches",
  "cm",
  "uk",
  "buy",
  "new",
]);

const TV_BRANDS = new Set([
  "samsung",
  "lg",
  "sony",
  "panasonic",
  "tcl",
  "hisense",
  "philips",
  "toshiba",
]);

const TV_ACCESSORIES = ["phone", "case", "cover", "soundbar", "stand", "mount", "bracket"];

const RESEARCH_SYSTEM = `You identify the product a UK shopper is trying to buy. Return JSON only. Start with "{" and end with "}". No prose, no markdown.

The query may be a model code you do not recognise. Use the web snippets. If snippets are thin, infer cautiously and set confidence to "low".

Rules:
- "samsung n990f 85 inch" is a Samsung television (model family N990F, 85-inch class), not a phone.
- must_match includes the size class (85-inch) and the model family, plus marketing names listings use (Neo QLED, UE85N990F) when snippets mention them.
- must_not_be includes phone, case, soundbar, stand, cover unless the query is itself that accessory.
- Size is identity: 85 vs 75 is not the same product.

{
  "query": "the user query",
  "what_it_is": "Samsung 85-inch TV",
  "brand": "Samsung",
  "model_codes": ["N990F"],
  "category": "television",
  "key_specs": ["85-inch"],
  "must_match": ["85-inch", "N990F"],
  "must_not_be": ["phone", "case", "soundbar", "stand"],
  "notes": "short note",
  "confidence": "high"
}`;

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key) continue;
    const folded = key.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push(key);
  }
  return out;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJson(text: string): string {
  let body = text.trim();
  body = body.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1) return body;
  return body.slice(start, end === -1 ? undefined : end + 1);
}

export function normalizeHay(text: string): string {
  return text.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9+]+/g, " ").replace(/\s+/g, " ").trim();
}

export function extractInchSizes(text: string): string[] {
  const found = [
    ...text.matchAll(/\b(\d{2,3})\s*(?:-?\s*)?(?:inch|inches|in)\b/gi),
    ...text.matchAll(/\b(\d{2,3})"\b/g),
  ].map((m) => m[1] ?? "");
  return unique(found);
}

function looksLikeModelCode(token: string): boolean {
  return /[a-z]/i.test(token) && /\d/.test(token) && token.length >= 4 && token.length <= 16;
}

function tokenIn(hay: string, token: string): boolean {
  const t = normalizeHay(token);
  if (!t) return false;
  if (hay.includes(t)) return true;
  const compactHay = hay.replace(/\s/g, "");
  const compactTok = t.replace(/\s/g, "");
  return compactTok.length >= 4 && compactHay.includes(compactTok);
}

export function distinctiveFromQuery(query: string): {
  brand: string;
  codes: string[];
  sizes: string[];
  tokens: string[];
} {
  const raw = query.trim();
  const parts = raw.split(/[^a-z0-9]+/i).filter(Boolean);
  const codes = unique(parts.filter(looksLikeModelCode).map((p) => p.toUpperCase()));
  const sizes = extractInchSizes(raw);
  const words = parts.map((p) => p.toLowerCase()).filter((w) => w && !QUERY_STOP.has(w));
  const brandWord = words.find((w) => /^[a-z]{3,}$/.test(w)) ?? "";
  const brand = brandWord ? brandWord[0].toUpperCase() + brandWord.slice(1) : "";
  return { brand, codes, sizes, tokens: unique([...codes.map((c) => c.toLowerCase()), ...sizes, ...words]) };
}

function queryLooksLikeTv(query: string, tokens: ReturnType<typeof distinctiveFromQuery>): boolean {
  const hay = normalizeHay(query);
  if (/\b(tv|television|qled|oled)\b/.test(hay)) return true;
  if (/\b(phone|iphone|galaxy s\d|smartphone|case|soundbar)\b/.test(hay)) return false;
  return tokens.sizes.length > 0 && tokens.codes.length > 0 && TV_BRANDS.has(tokens.brand.toLowerCase());
}

function snippetsLookLikeTv(blob: string): boolean {
  return /\b(tv|television|qled|oled|neo qled|led tv|qn\d|ue\d{2})\b/i.test(blob);
}

/** Deterministic brief used when Bedrock is off or unusable. */
export function fallbackProductBrief(query: string, snippets: Snippet[] = []): ProductBrief {
  const tokens = distinctiveFromQuery(query);
  const blob = snippets.map((s) => `${s.title} ${s.text}`).join("\n");
  const hay = normalizeHay(blob);
  const tv = snippetsLookLikeTv(hay) || queryLooksLikeTv(query, tokens);
  const sizeLabel = tokens.sizes[0] ? `${tokens.sizes[0]}-inch` : "";
  const must_match = unique([
    ...tokens.tokens,
    ...tokens.codes,
    ...(sizeLabel ? [sizeLabel] : []),
  ]);
  const model_codes = [...tokens.codes];
  const marketing = hay.match(/\bneo qled\b/i);
  if (marketing) must_match.push("Neo QLED");
  const longCode = hay.match(/\bue\s*\d{0,2}n990f\b/i);
  if (longCode) model_codes.push(longCode[0].replace(/\s+/g, "").toUpperCase());

  if (tv) {
    const brand = tokens.brand || "Unknown";
    const what = `${brand === "Unknown" ? "" : `${brand} `}${sizeLabel ? `${sizeLabel} ` : ""}TV`.replace(/\s+/g, " ").trim();
    return {
      query,
      what_it_is: what || "Television",
      brand: tokens.brand,
      model_codes: unique(model_codes),
      category: "television",
      key_specs: unique([...(sizeLabel ? [sizeLabel] : []), ...tokens.codes]),
      must_match: unique([...must_match, sizeLabel].filter(Boolean)),
      must_not_be: [...TV_ACCESSORIES],
      notes: snippets.length
        ? "Identified as a television from the query and web snippets."
        : "Research fetch empty; inferred a television from the model code and size in the query.",
      confidence: snippets.length ? "medium" : "low",
    };
  }

  return {
    query,
    what_it_is: query.trim(),
    brand: tokens.brand,
    model_codes: unique(model_codes),
    category: "unknown",
    key_specs: unique([...(sizeLabel ? [sizeLabel] : []), ...tokens.codes]),
    must_match,
    must_not_be: [],
    notes: snippets.length
      ? "Inferred from query tokens and web snippets; model was not asked."
      : "Research fetch failed or returned nothing; matching query tokens only.",
    confidence: snippets.length ? "medium" : "low",
  };
}

export function identityFromBrief(
  title: string,
  brief: ProductBrief,
): { same_item: boolean; why: string } {
  const hay = normalizeHay(title);
  const codeHit = brief.model_codes.some((c) => tokenIn(hay, c));
  const badHit = brief.must_not_be.find((b) => tokenIn(hay, b));
  if (badHit) {
    const accessory = /^(phone|case|cover|soundbar|stand|mount|bracket|remote|cable|charger)$/i.test(badHit);
    if (accessory || !codeHit) {
      return { same_item: false, why: `listing is a ${badHit}, not the ${brief.category || "item"}` };
    }
  }

  const wanted = unique([
    ...extractInchSizes(`${brief.what_it_is} ${brief.key_specs.join(" ")} ${brief.must_match.join(" ")}`),
    ...brief.key_specs.map((s) => extractInchSizes(s)[0] ?? "").filter(Boolean),
  ]);
  const listed = extractInchSizes(title);
  if (wanted.length > 0 && listed.length > 0 && !listed.some((s) => wanted.includes(s))) {
    return { same_item: false, why: `size ${listed.join("/")} is not ${wanted.join("/")}` };
  }

  if (codeHit) return { same_item: true, why: "model code matches the product we are buying" };

  const matchHits = brief.must_match.filter((t) => tokenIn(hay, t));
  const need = Math.max(1, Math.ceil(brief.must_match.length * 0.5));
  if (brief.must_match.length > 0 && matchHits.length >= need) {
    return { same_item: true, why: "listing matches the product we are buying" };
  }

  const brand = normalizeHay(brief.brand);
  const category = normalizeHay(brief.category);
  const sizeHit = wanted.length > 0 && listed.some((s) => wanted.includes(s));
  const catHit =
    category.length > 0 &&
    (tokenIn(hay, category) || (category.startsWith("tele") && /\btv\b/.test(hay)));
  if (sizeHit && brand && tokenIn(hay, brand) && catHit) {
    return { same_item: true, why: "brand, size and category match the product we are buying" };
  }

  return { same_item: false, why: "does not match the product we are buying" };
}

export function scoreAgainstBrief(title: string, brief: ProductBrief): number {
  const hay = normalizeHay(title);
  let score = 0;
  for (const code of brief.model_codes) {
    if (tokenIn(hay, code)) score += 10;
  }
  if (brief.brand && tokenIn(hay, brief.brand)) score += 3;
  for (const token of brief.must_match) {
    if (tokenIn(hay, token)) score += 4;
  }
  for (const spec of brief.key_specs) {
    if (tokenIn(hay, spec)) score += 2;
  }
  for (const bad of brief.must_not_be) {
    if (tokenIn(hay, bad)) score -= 8;
  }
  const wanted = extractInchSizes(`${brief.what_it_is} ${brief.key_specs.join(" ")} ${brief.must_match.join(" ")}`);
  const listed = extractInchSizes(title);
  if (wanted.length > 0 && listed.length > 0) {
    score += listed.some((s) => wanted.includes(s)) ? 5 : -6;
  }
  return score;
}

export function researchTraceDetail(brief: ProductBrief, source: ResearchSource): string {
  const codes = brief.model_codes.filter(Boolean).slice(0, 2).join(", ");
  const label = brief.what_it_is.trim() || brief.category || brief.query;
  return `${label}${codes ? ` (${codes})` : ""} · ${source}`;
}

async function fetchText(url: string): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: {
        "user-agent": UA,
        accept: "text/html, application/json;q=0.9, */*;q=0.8",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseDdgHtml(html: string): Snippet[] {
  const titles = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) =>
    stripTags(m[1] ?? ""),
  );
  const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|span|div)>/gi)].map((m) =>
    stripTags(m[1] ?? ""),
  );
  const n = Math.min(SNIPPET_CAP, Math.max(titles.length, snippets.length));
  const out: Snippet[] = [];
  for (let i = 0; i < n; i += 1) {
    const title = titles[i] ?? "";
    const text = snippets[i] ?? "";
    if (title || text) out.push({ title: title || text.slice(0, 80), text });
  }
  return out;
}

function parseDdgInstant(text: string): Snippet[] {
  try {
    const json = JSON.parse(text) as {
      Heading?: string;
      AbstractText?: string;
      Answer?: string;
      RelatedTopics?: unknown;
    };
    const out: Snippet[] = [];
    if (json.AbstractText) {
      out.push({ title: json.Heading || "DuckDuckGo", text: json.AbstractText });
    }
    if (json.Answer) out.push({ title: "Answer", text: json.Answer });
    const walk = (topics: unknown): void => {
      if (!Array.isArray(topics)) return;
      for (const topic of topics) {
        if (!topic || typeof topic !== "object") continue;
        const rec = topic as { Text?: string; Topics?: unknown };
        if (typeof rec.Text === "string" && rec.Text.trim()) {
          out.push({ title: rec.Text.slice(0, 80), text: rec.Text });
        }
        if (rec.Topics) walk(rec.Topics);
      }
    };
    walk(json.RelatedTopics);
    return out;
  } catch {
    return [];
  }
}

function parseWiki(text: string): Snippet[] {
  try {
    const json: unknown = JSON.parse(text);
    if (!Array.isArray(json) || json.length < 3) return [];
    const titles = json[1];
    const descs = json[2];
    if (!Array.isArray(titles) || !Array.isArray(descs)) return [];
    const out: Snippet[] = [];
    for (let i = 0; i < titles.length; i += 1) {
      const title = String(titles[i] ?? "");
      const snippet = String(descs[i] ?? "");
      if (title) out.push({ title, text: snippet });
    }
    return out;
  } catch {
    return [];
  }
}

function dedupeSnippets(snippets: Snippet[]): Snippet[] {
  const seen = new Set<string>();
  const out: Snippet[] = [];
  for (const snippet of snippets) {
    const key = normalizeHay(`${snippet.title} ${snippet.text}`).slice(0, 160);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: snippet.title.slice(0, 160), text: snippet.text.slice(0, 400) });
    if (out.length >= SNIPPET_CAP) break;
  }
  return out;
}

export async function fetchResearchSnippets(query: string): Promise<{ snippets: Snippet[]; source: ResearchSource }> {
  const q = encodeURIComponent(query);
  const [ddgHtml, ddgInstant, wiki] = await Promise.all([
    fetchText(`https://html.duckduckgo.com/html/?q=${q}`),
    fetchText(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`),
    fetchText(
      `https://en.wikipedia.org/w/api.php?action=opensearch&search=${q}&limit=5&namespace=0&format=json`,
    ),
  ]);

  const collected: Snippet[] = [];
  if (ddgInstant) collected.push(...parseDdgInstant(ddgInstant));
  if (ddgHtml) collected.push(...parseDdgHtml(ddgHtml));
  if (wiki) collected.push(...parseWiki(wiki));
  const snippets = dedupeSnippets(collected);

  let source: ResearchSource = "tokens";
  if (ddgHtml || ddgInstant) source = "duckduckgo";
  else if (wiki) source = "wikipedia";
  return { snippets, source };
}

function parseBrief(text: string, query: string): ProductBrief {
  const parsed = ProductBriefSchema.parse(JSON.parse(extractJson(text)));
  return { ...parsed, query: parsed.query || query };
}

async function briefFromBedrock(query: string, snippets: Snippet[]): Promise<ProductBrief | null> {
  const snippetBlock =
    snippets.length === 0
      ? "No web snippets were retrieved. Infer from the query only and set confidence to \"low\"."
      : snippets.map((s, i) => `${i + 1}. ${s.title}\n   ${s.text}`).join("\n");
  const messages: Message[] = [
    {
      role: "user",
      content: [{ text: `User query: "${query}"\n\nWeb snippets:\n${snippetBlock}\n\nReturn the JSON object now.` }],
    },
  ];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let raw = "";
    try {
      const out = await converse(messages, {
        system: RESEARCH_SYSTEM,
        maxTokens: RESEARCH_MAX_TOKENS,
        temperature: 0.1,
      });
      raw = out.text;
      return parseBrief(raw, query);
    } catch (err) {
      console.warn(`[covered/research] attempt ${attempt} failed: ${errorLabel(err)}`);
      if (isAccessError(err)) return null;
      if (attempt === 1 && raw) {
        messages.push({ role: "assistant", content: [{ text: raw }] });
        messages.push({
          role: "user",
          content: [
            {
              text: `That JSON failed validation: ${errorLabel(err)}\nReturn the corrected JSON object only.`,
            },
          ],
        });
      }
    }
  }
  return null;
}

/** Never throws. Always returns a ProductBrief the shortlist and judge can use. */
export async function researchProduct(query: string): Promise<ResearchResult> {
  const trimmed = query.trim();
  let snippets: Snippet[] = [];
  let source: ResearchSource = "tokens";
  try {
    const fetched = await fetchResearchSnippets(trimmed);
    snippets = fetched.snippets;
    source = fetched.source;
  } catch (err) {
    console.warn(`[covered/research] fetch failed: ${errorLabel(err)}`);
  }

  const { mode } = await judgeMode();
  if (mode === "bedrock") {
    const fromModel = await briefFromBedrock(trimmed, snippets);
    if (fromModel) {
      return { brief: fromModel, source: snippets.length > 0 ? source : "bedrock" };
    }
  }

  return { brief: fallbackProductBrief(trimmed, snippets), source };
}
