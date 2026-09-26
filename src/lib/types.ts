/**
 * Shared types for Covered.
 *
 * Every boundary in the app (reader -> app, app -> judge, app -> S3) speaks
 * these shapes. Each type has a zod schema (`XSchema`) and an inferred TS
 * type (`X`) so callers can validate untrusted JSON at the edge and get a
 * typed value back. Import from "@/lib/types".
 */
import { z } from "zod";
import { safeImageDataUrl, safeImageUrl } from "@/lib/photo-safety";

/** Which list on the rendered Shopping grid an offer came from. Sponsored rows are ads. */
export const OfferSectionSchema = z.enum(["sponsored", "browse"]);
export type OfferSection = z.infer<typeof OfferSectionSchema>;

/**
 * One offer read from the Google Shopping grid (`udm=28`) first paint.
 * Mirrors the Record in the plan. `price` is the string as shown ("£249.00");
 * `price_pence` is the parsed integer when the string parsed cleanly.
 * Browse records often omit `offer_id`, `merchant_domain`, `specs`. Live rows
 * carry `product_url` when the reader can unwrap a shop href (plantl, `/goto?url=`,
 * or the product viewer). `image_urls` is fixtures (and any extra remote thumbs).
 * Live/extension rows also carry `image_url` (the displayed src, including
 * encrypted-tbn) and `image_data_url` (a compressed jpeg captured in the reader).
 */
export const OfferSchema = z.object({
  section: OfferSectionSchema,
  /** Sponsored slot position from `data-pla-slot-pos`. */
  position: z.number().int().optional(),
  title: z.string(),
  /** Price as displayed, e.g. "£249.00". */
  price: z.string(),
  /** Parsed pence, or null if the displayed price did not parse. */
  price_pence: z.number().int().nullable().optional(),
  /**
   * How to read the displayed figure. A monthly tariff is never a cash/handset
   * price. Omitted on old payloads — the server classifies from title + price text.
   */
  price_kind: z.enum(["cash", "monthly", "unknown"]).optional(),
  /** Monthly tariff in pence when the listing is (or also has) a pay-monthly deal. */
  monthly_pence: z.number().int().nullable().optional(),
  /** Contract length when stated, e.g. 24 from "24 months". */
  term_months: z.number().int().nullable().optional(),
  /** Upfront / "from £X upfront" in pence. Not the cash/handset price. */
  upfront_pence: z.number().int().nullable().optional(),
  /** Struck-through / "was" price. Often has no "£". */
  compare_at: z.string().nullable(),
  merchant: z.string(),
  /** Sponsored only: `data-dtld`, e.g. "argos.co.uk". */
  merchant_domain: z.string().optional(),
  /** Sponsored only: `data-merchant-id`. */
  merchant_id: z.string().optional(),
  /** Sponsored only: `data-offer-id`. Dedupe key for sponsored units. */
  offer_id: z.string().optional(),
  /** Sponsored only: `data-offer-docid`. */
  offer_docid: z.string().optional(),
  /** Sponsored only: store location text, e.g. "London". */
  location: z.string().nullable().optional(),
  /** "Sale", "£50 off", "Price drop", or null. Never a reason to buy. */
  badge: z.string().nullable(),
  /** Delivery / collect text as shown. */
  delivery: z.string().nullable(),
  /** Browse only: returns text. Feeds the rights decision. */
  returns: z.string().nullable().optional(),
  /** Sponsored only: energy label aria text. */
  energy: z.string().nullable().optional(),
  /** Rating as shown, e.g. "4.7". */
  rating: z.string().nullable(),
  /** Rating count as shown, e.g. "1k+". */
  rating_count: z.string().nullable(),
  /** Sponsored only: spec chips with the "·" separators dropped. */
  specs: z.array(z.string()).optional(),
  /** Shop URL from the clickable card (sponsored plantl, browse /goto, or viewer). Never the /aclk tracker. */
  product_url: z.string().optional(),
  /** Browse only: "& more" text meaning this price is one of several. */
  more_merchants: z.string().nullable().optional(),
  /** Browse only: aria-label summary repeating title, badge, price, merchant, delivery, rating. */
  summary: z.string().nullable().optional(),
  /** Fixtures, or extra remote thumbs. */
  image_urls: z.array(z.string()).optional(),
  /**
   * Displayed card image src (encrypted-tbn or shop CDN). Vetted at parse time by
   * `safeImageUrl`: anything but plain https becomes null, never an error.
   */
  image_url: z
    .string()
    .transform((value) => safeImageUrl(value))
    .nullable()
    .optional(),
  /**
   * One jpeg data URL per offer, captured in the reader when the canvas is clean.
   * Vetted by `safeImageDataUrl`: anything but a bounded base64 raster becomes null.
   */
  image_data_url: z
    .string()
    .transform((value) => safeImageDataUrl(value))
    .nullable()
    .optional(),
});
export type Offer = z.infer<typeof OfferSchema>;

/** Where a SearchResult came from: the live grid, local fixtures, or a saved live read in `public/snapshots`. */
export const SearchSourceSchema = z.enum(["live", "fixture", "snapshot"]);
export type SearchSource = z.infer<typeof SearchSourceSchema>;

/** A deduped read of one query's first paint (or its fixture / snapshot stand-in). */
export const SearchResultSchema = z.object({
  query: z.string(),
  /** ISO 8601 timestamp of the read. */
  fetched_at: z.string(),
  source: SearchSourceSchema,
  offers: z.array(OfferSchema),
  /** Snapshot only: how the file was captured, e.g. "captured via Cursor browser". */
  note: z.string().optional(),
  /** Snapshot only: the live reader error that made the reader fall back to this snapshot. */
  fallback_from: z.lazy(() => ReaderErrorSchema).optional(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

/** Typed failure from the browser reader. `challenge` means switch to fixtures; do not bypass. */
export const ReaderErrorSchema = z.object({
  kind: z.enum(["challenge", "timeout", "no_offers", "unknown"]),
  message: z.string(),
});
export type ReaderError = z.infer<typeof ReaderErrorSchema>;

/** Discriminated result of a reader call. */
export const ReaderResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: SearchResultSchema }),
  z.object({ ok: z.literal(false), error: ReaderErrorSchema }),
]);
export type ReaderResponse = z.infer<typeof ReaderResponseSchema>;

/**
 * A seeded fixture listing with real photos. Used when the grid is a
 * challenge page, and for the wrong-jacket mislisting beat.
 */
export const ListingSchema = z.object({
  id: z.string(),
  title: z.string(),
  price_pence: z.number().int(),
  merchant: z.string(),
  /** Hint for the demo only; the judge still decides `seller_type`. */
  seller_type_hint: z.string().optional(),
  /** Where it is sold, e.g. "Facebook Marketplace", "eBay", "Shop". */
  venue: z.string(),
  /** Real product photos. The mislisting check reads these. */
  image_urls: z.array(z.string()),
  returns_text: z.string(),
  delivery_text: z.string(),
  rating: z.string().optional(),
  url: z.string().optional(),
});
export type Listing = z.infer<typeof ListingSchema>;

/** Who is selling, as judged by the model. */
export const SellerTypeSchema = z.enum([
  "uk_business",
  "private",
  "overseas_business",
  "unclear",
]);
export type SellerType = z.infer<typeof SellerTypeSchema>;

/** How enforceable the venue is. A business badge is not protection. */
export const VenueTrustSchema = z.enum([
  "shop_checkout",
  "marketplace_protected",
  "marketplace_unprotected",
  "stranger",
  "unclear",
]);
export type VenueTrust = z.infer<typeof VenueTrustSchema>;

/** The judge's call on one offer or listing. */
export const RecommendationSchema = z.enum(["buy", "skip", "ask"]);
export type Recommendation = z.infer<typeof RecommendationSchema>;

/**
 * The judge's structured decision for one offer/listing. JSON only.
 * The model judges identity, mislisting, seller, venue and rights.
 * The rights-premium comparison (percent of the full-rights price) stays in code.
 */
export const DecisionSchema = z.object({
  /** Is this the item the user asked for. */
  same_item: z.boolean(),
  /** Do the photos contradict the title. A mislisting never reaches the price rule. */
  mislisting: z.boolean(),
  /** Which photo gave the mislisting away, or null. */
  photo_reason: z.string().nullable(),
  /** Was the row an ad. Never a reason to buy. */
  sponsored: z.boolean(),
  seller_type: SellerTypeSchema,
  venue_trust: VenueTrustSchema,
  /** Which UK rights apply, in plain words (e.g. "14-day cancellation", "CRA 2015 fault remedy"). */
  rights: z.array(z.string()),
  recommendation: RecommendationSchema,
  /** The one sentence the user sees. */
  reason: z.string(),
});
export type Decision = z.infer<typeof DecisionSchema>;

/** The judge's verdict over a whole shortlist. Keys of `per_offer` are offer/listing ids. */
export const VerdictSchema = z.object({
  /** Id of the chosen offer/listing, or null when nothing should be bought. */
  chosen_id: z.string().nullable(),
  per_offer: z.record(z.string(), DecisionSchema),
  summary: z.string(),
});
export type Verdict = z.infer<typeof VerdictSchema>;

/** `section` on a Receipt: a grid section, or "fixture" when the chosen item was a fixture Listing. */
export const ReceiptSectionSchema = z.union([
  OfferSectionSchema,
  z.literal("fixture"),
]);
export type ReceiptSection = z.infer<typeof ReceiptSectionSchema>;

/** Written to S3 at `receipts/{id}.json` on Approve. */
export const ReceiptSchema = z.object({
  id: z.string(),
  /** ISO 8601 timestamp. */
  created_at: z.string(),
  query: z.string(),
  chosen: z.union([OfferSchema, ListingSchema]),
  decision: DecisionSchema,
  section: ReceiptSectionSchema,
  /** Legacy pound premium at approve time. The live rule uses bps, not this. */
  protection_premium_pence: z.number().int(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

/** Default rights premium: 25% of the cheapest full-rights listing (2500 bps). */
export const DEFAULT_PROTECTION_PREMIUM_BPS = 2500;
/** UI and API cap: 50%. */
export const MAX_PROTECTION_PREMIUM_BPS = 5000;

/** What the user sets once. Defaults: 25% rights premium, £8 switch minimum, ask before buying. */
export const UserSettingsSchema = z.object({
  /**
   * How far below a UK shop the cheaper listing can be, in basis points of the
   * full-rights price. 2500 = 25%. Missing on old memory items — those ignore
   * any leftover `protection_premium_pence` and get 2500. The rule uses bps only.
   */
  protection_premium_bps: z
    .number()
    .int()
    .min(0)
    .max(MAX_PROTECTION_PREMIUM_BPS)
    .default(DEFAULT_PROTECTION_PREMIUM_BPS),
  /**
   * Kept so old clients that still read a pound premium do not crash.
   * Ignored by `applyPremium`. Old items that only have this field get 2500 bps.
   */
  protection_premium_pence: z.number().int().default(1000),
  /** "Inside 14 days, only move me if I clear this after postage." Default 800 (£8). */
  switch_minimum_pence: z.number().int().default(800),
  /** "ask" texts for a YES; "auto" goes once the number clears. */
  approval: z.enum(["ask", "auto"]).default("ask"),
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;

/** Settings with every default applied. */
export const DEFAULT_USER_SETTINGS: UserSettings = UserSettingsSchema.parse({});
