/**
 * Pure DOM -> Offer mapping for the udm=28 first paint.
 *
 * `extractGrid` runs INSIDE `page.evaluate`, so it must be self-contained:
 * every helper is nested in the function, and nothing from module scope is
 * referenced at runtime (type imports are erased). It returns Offers without
 * `price_pence`; the Node side sets that with `parsePricePence` and dedupes.
 *
 * Selectors follow the plan. Minified class names rotate, so each field has an
 * aria-label or structural fallback, and hit counts are returned so the server
 * log shows when a class has moved.
 */
import type { Offer } from "@/lib/types";

/** Per-selector hit counts, keyed as `section.field`. `units` is the row count. */
export type SelectorHits = Record<string, number>;

export type GridExtraction = {
  sponsored: Offer[];
  browse: Offer[];
  hits: { sponsored: SelectorHits; browse: SelectorHits };
  /** Present when the "More results" link exists. Informational only; never followed. */
  more_results_href: string | null;
};

export function extractGrid(): GridExtraction {
  // ---- helpers (must stay inside this function) -------------------------
  const clean = (value: string | null | undefined): string =>
    (value ?? "").replace(/\s+/g, " ").trim();

  const textOf = (root: Element, selector: string): string | null => {
    const el = root.querySelector(selector);
    if (!el) return null;
    const text = clean(el.textContent);
    return text.length > 0 ? text : null;
  };

  const ariaOf = (root: Element, selector: string): string | null => {
    const el = root.querySelector(selector);
    if (!el) return null;
    const label = clean(el.getAttribute("aria-label"));
    return label.length > 0 ? label : null;
  };

  const attrOf = (root: Element, name: string): string | undefined => {
    const own = root.getAttribute(name);
    if (own) return own;
    const child = root.querySelector(`[${name}]`);
    const value = child?.getAttribute(name);
    return value ? value : undefined;
  };

  const firstNumber = (value: string | null | undefined): string | null => {
    if (!value) return null;
    const m = value.match(/(\d+(?:\.\d+)?)/);
    return m ? m[1] : null;
  };

  const parenthetical = (value: string | null | undefined): string | null => {
    if (!value) return null;
    const m = value.match(/\(([^)]+)\)/);
    return m ? clean(m[1]) : null;
  };

  /** "(1k+)" -> "1k+"; leaves "1k+" alone. */
  const stripParens = (value: string | null): string | null => {
    if (!value) return null;
    const m = value.match(/^\(\s*(.+?)\s*\)$/);
    return m ? clean(m[1]) : value;
  };

  /** "Rated 4.7 out of 5 (1k+)" -> "4.7". Falls back to the first number. */
  const ratedNumber = (label: string | null | undefined): string | null => {
    if (!label) return null;
    const m = label.match(/rated\s+(\d+(?:\.\d+)?)/i);
    return m ? m[1] : firstNumber(label);
  };

  /** First "Rated ..." aria-label in `root` that carries a parenthetical count. */
  const ratedCount = (root: Element): string | null => {
    for (const el of Array.from(root.querySelectorAll('[aria-label*="Rated"]'))) {
      const count = parenthetical(el.getAttribute("aria-label"));
      if (count) return count;
    }
    return null;
  };

  /** First "£12.34"-shaped token in a blob of text. Last-resort price fallback. */
  const firstPound = (value: string | null | undefined): string | null => {
    if (!value) return null;
    const m = value.match(/£\s?\d[\d,]*(?:\.\d{1,2})?/);
    return m ? m[0].replace(/\s/g, "") : null;
  };

  /** "Current price: £139.00." -> "£139.00" */
  const priceFromAria = (label: string | null): string | null => {
    if (!label) return null;
    const m = label.match(/current price:?\s*(.+?)\.?$/i);
    const value = clean(m ? m[1] : label);
    return value.length > 0 ? value : null;
  };

  /**
   * Shop URL from the clickable card. `/goto?url=`, `/aclk?adurl=` and `/url?q=`
   * are Google redirectors: unwrap the target when present, otherwise return
   * undefined so the caller falls back to `data-dtld`. Never the tracker itself.
   */
  const unwrapProductUrl = (href: string | null): string | undefined => {
    if (!href) return undefined;
    let url: URL;
    try {
      url = new URL(href, location.href);
    } catch {
      return undefined;
    }
    const isGoogle = /(^|\.)google\.[a-z.]+$/i.test(url.hostname);
    const isRedirectorPath = /^\/(goto|aclk|url)(\/|$)/.test(url.pathname);
    if (!isGoogle && !isRedirectorPath) {
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
    }
    for (const key of ["url", "adurl", "q"]) {
      const target = url.searchParams.get(key);
      if (!target) continue;
      try {
        const t = new URL(target);
        if (t.protocol === "http:" || t.protocol === "https:") return t.toString();
      } catch {
        // Not an absolute URL; try the next param.
      }
    }
    return undefined;
  };

  const bump = (hits: SelectorHits, key: string, matched: boolean): void => {
    if (matched) hits[key] = (hits[key] ?? 0) + 1;
  };

  /** Pre-seed keys so a rotated class shows up as `0/N` in the log rather than vanishing. */
  const seed = (keys: string[]): SelectorHits => {
    const hits: SelectorHits = {};
    for (const key of keys) hits[key] = 0;
    return hits;
  };

  /** "Sale", "Price drop", "£50 off", "10% off": the badge vocabulary, used when the class rotates. */
  const badgePattern = /^(sale|price drop|reduced|£\s?\d[\d,.]*\s+off|\d+%\s+off)$/i;

  const leafTexts = (root: Element): string[] =>
    Array.from(root.querySelectorAll("span,div"))
      .filter((el) => el.children.length === 0)
      .map((el) => clean(el.textContent))
      .filter((text) => text.length > 0);

  /** Displayed product img: prefer encrypted-tbn / gstatic, skip 1px and svg placeholders. */
  const cardImage = (root: Element): { img: HTMLImageElement; src: string } | null => {
    const imgs = Array.from(root.querySelectorAll("img"));
    let fallback: { img: HTMLImageElement; src: string } | null = null;
    for (const el of imgs) {
      const img = el as HTMLImageElement;
      const src = clean(img.currentSrc || img.src || img.getAttribute("src") || "");
      if (!src) continue;
      if (/^data:image\/(gif|svg)/i.test(src)) continue;
      if (/pixel|spacer|blank|1x1/i.test(src)) continue;
      const w = img.naturalWidth || img.width || 0;
      if (img.complete && w > 0 && w < 16) continue;
      if (!fallback) fallback = { img, src };
      if (/encrypted-tbn|gstatic|ggpht/i.test(src)) return { img, src };
    }
    return fallback;
  };

  /** Scale to max width 360 and export jpeg. Null if tainted or not loaded. */
  const captureJpegDataUrl = (img: HTMLImageElement): string | null => {
    try {
      if (!img.complete || !img.naturalWidth || img.naturalWidth < 8) return null;
      const maxW = 360;
      const scale = Math.min(1, maxW / img.naturalWidth);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
      return dataUrl && dataUrl.startsWith("data:image/jpeg") ? dataUrl : null;
    } catch {
      return null;
    }
  };

  const attachCardPhoto = (root: Element, offer: Offer): void => {
    const found = cardImage(root);
    if (!found) return;
    offer.image_url = found.src;
    const dataUrl = captureJpegDataUrl(found.img);
    if (dataUrl) offer.image_data_url = dataUrl;
  };

  const capDataUrls = (offers: Offer[], max: number): void => {
    let kept = 0;
    for (const offer of offers) {
      if (!offer.image_data_url) continue;
      if (kept >= max) {
        offer.image_data_url = null;
      } else {
        kept += 1;
      }
    }
  };

  // ---- sponsored row ----------------------------------------------------
  const sponsoredHits = seed([
    "data-offer-id",
    "data-dtld",
    "title:[role=heading] div",
    "price:.VbBaOe",
    "compare_at:.tWaJ3e",
    "merchant:.UsGWMe",
    "location:.rhOrK",
    "location:fallback",
    "badge:.k7oAqd",
    "badge:fallback",
    "delivery:.PPi4nd(any)",
    "delivery:matched",
    "energy:[aria-label^=Energy]",
    "rating:pla-reviews[aria-label*=Rated]",
    "rating_count",
    "specs:.OCkIVb span",
    "card:a.plantl.clickable-card",
    "product_url:unwrapped",
  ]);
  const sponsoredUnits = Array.from(
    document.querySelectorAll<HTMLElement>("div.ArOTm.top-pla-group-inner div.mnr-c.pla-unit"),
  );
  sponsoredHits.units = sponsoredUnits.length;

  const sponsored: Offer[] = [];
  for (const unit of sponsoredUnits) {
    const positionRaw = attrOf(unit, "data-pla-slot-pos");
    const position = positionRaw !== undefined ? Number.parseInt(positionRaw, 10) : Number.NaN;

    const merchantDomain = attrOf(unit, "data-dtld");
    const merchantId = attrOf(unit, "data-merchant-id");
    const offerId = attrOf(unit, "data-offer-id");
    const offerDocid = attrOf(unit, "data-offer-docid");
    bump(sponsoredHits, "data-offer-id", offerId !== undefined);
    bump(sponsoredHits, "data-dtld", merchantDomain !== undefined);

    let title = textOf(unit, '[role="heading"] div');
    bump(sponsoredHits, "title:[role=heading] div", title !== null);
    if (!title) title = textOf(unit, '[role="heading"]');
    if (!title) title = ariaOf(unit, "a.plantl.clickable-card");

    let price = textOf(unit, ".VbBaOe");
    bump(sponsoredHits, "price:.VbBaOe", price !== null);
    if (!price) price = priceFromAria(ariaOf(unit, '[aria-label^="Current price"]'));
    if (!price) price = firstPound(unit.textContent);

    const compareAt = textOf(unit, ".tWaJ3e");
    bump(sponsoredHits, "compare_at:.tWaJ3e", compareAt !== null);

    let merchant = textOf(unit, ".UsGWMe");
    bump(sponsoredHits, "merchant:.UsGWMe", merchant !== null);
    if (!merchant) merchant = merchantDomain ?? null;

    let locationText = textOf(unit, ".rhOrK");
    bump(sponsoredHits, "location:.rhOrK", locationText !== null);
    if (!locationText) {
      // 2026-09 markup: <div class="dBmERc"><img><span>London</span></div>. Try the class,
      // then the structure: a pin icon immediately followed by a short, digit-free span.
      locationText = textOf(unit, ".dBmERc span");
      if (!locationText) {
        for (const el of Array.from(unit.querySelectorAll("div > img + span"))) {
          const text = clean(el.textContent);
          if (text.length > 0 && text.length <= 30 && !/[\d£]/.test(text)) {
            locationText = text;
            break;
          }
        }
      }
      bump(sponsoredHits, "location:fallback", locationText !== null);
    }

    let badge = textOf(unit, ".k7oAqd");
    bump(sponsoredHits, "badge:.k7oAqd", badge !== null);
    if (!badge) {
      // 2026-09 markup: .jGPvkb "Sale", .fo20hd "10% off". Then any leaf matching the badge vocabulary.
      badge = textOf(unit, ".jGPvkb, .fo20hd") ?? leafTexts(unit).find((text) => badgePattern.test(text)) ?? null;
      bump(sponsoredHits, "badge:fallback", badge !== null);
    }

    const deliveryCandidates = Array.from(unit.querySelectorAll(".PPi4nd"));
    bump(sponsoredHits, "delivery:.PPi4nd(any)", deliveryCandidates.length > 0);
    let delivery: string | null = null;
    for (const el of deliveryCandidates) {
      const text = clean(el.textContent);
      if (/deliver|collect|charge|return/i.test(text)) {
        delivery = text;
        break;
      }
    }
    bump(sponsoredHits, "delivery:matched", delivery !== null);

    const energy = ariaOf(unit, '[aria-label^="Energy"]');
    bump(sponsoredHits, "energy:[aria-label^=Energy]", energy !== null);

    let ratedLabel = ariaOf(unit, 'pla-reviews [aria-label*="Rated"]');
    bump(sponsoredHits, "rating:pla-reviews[aria-label*=Rated]", ratedLabel !== null);
    if (!ratedLabel) ratedLabel = ariaOf(unit, '[aria-label*="Rated"]');
    const rating = ratedNumber(ratedLabel);
    let ratingCount = parenthetical(ratedLabel) ?? ratedCount(unit);
    if (!ratingCount) ratingCount = stripParens(textOf(unit, ".RDApEe"));
    bump(sponsoredHits, "rating_count", ratingCount !== null);

    // The hover card repeats the chip row inside the unit, so read the first `.OCkIVb` only.
    const specsRoot = unit.querySelector(".OCkIVb");
    const specs = Array.from(specsRoot ? specsRoot.querySelectorAll("span") : [])
      .map((el) => clean(el.textContent))
      .filter((text, index, all) => text.length > 0 && text !== "·" && text !== "•" && all.indexOf(text) === index);
    bump(sponsoredHits, "specs:.OCkIVb span", specs.length > 0);

    const card = unit.querySelector<HTMLAnchorElement>("a.plantl.clickable-card");
    bump(sponsoredHits, "card:a.plantl.clickable-card", card !== null);
    const productUrl = unwrapProductUrl(card?.getAttribute("href") ?? null);
    bump(sponsoredHits, "product_url:unwrapped", productUrl !== undefined);

    if (!title && !price) continue; // Not an offer card (e.g. a header inside the group).

    const offer: Offer = {
      section: "sponsored",
      title: title ?? "",
      price: price ?? "",
      compare_at: compareAt,
      merchant: merchant ?? "",
      location: locationText,
      badge,
      delivery,
      energy,
      rating,
      rating_count: ratingCount,
      specs,
    };
    if (Number.isFinite(position)) offer.position = position;
    if (merchantDomain) offer.merchant_domain = merchantDomain;
    if (merchantId) offer.merchant_id = merchantId;
    if (offerId) offer.offer_id = offerId;
    if (offerDocid) offer.offer_docid = offerDocid;
    if (productUrl) offer.product_url = productUrl;
    attachCardPhoto(unit, offer);
    sponsored.push(offer);
  }

  // ---- browse grid ------------------------------------------------------
  const browseHits = seed([
    "summary:.njFjte",
    "title:.gkQHve",
    "price:.lmQWe",
    "price:aria Current price",
    "merchant:.WJMUdc",
    "more_merchants:.Ludoze",
    "delivery:.ybnj7e",
    "returns:.l9Ycjb",
    "rating:.yi40Hd",
    "rating_count:.RDApEe",
  ]);
  let browseRows = Array.from(
    document.querySelectorAll<HTMLElement>("product-viewer-group ul product-viewer-entrypoint"),
  );
  browseHits["units:product-viewer-group ul product-viewer-entrypoint"] = browseRows.length;
  if (browseRows.length === 0) {
    browseRows = Array.from(document.querySelectorAll<HTMLElement>("product-viewer-entrypoint"));
  }
  browseHits.units = browseRows.length;

  const browse: Offer[] = [];
  for (const row of browseRows) {
    let summary = ariaOf(row, ".njFjte");
    bump(browseHits, "summary:.njFjte", summary !== null);
    if (!summary) {
      const own = clean(row.getAttribute("aria-label"));
      if (own.length > 0) summary = own;
    }
    if (!summary) {
      const labelled = Array.from(row.querySelectorAll("[aria-label]"))
        .map((el) => clean(el.getAttribute("aria-label")))
        .filter((label) => label.length > 40 && /£/.test(label));
      summary = labelled[0] ?? null;
    }

    let title = textOf(row, ".gkQHve");
    bump(browseHits, "title:.gkQHve", title !== null);
    if (!title) title = textOf(row, '[role="heading"]');
    if (!title && summary) {
      const head = summary.split(/\.\s|,\s*current price|£/i)[0];
      title = clean(head).length > 0 ? clean(head) : null;
    }

    const priceEl = row.querySelector(".lmQWe");
    bump(browseHits, "price:.lmQWe", priceEl !== null);
    let price: string | null = null;
    if (priceEl) {
      price = priceFromAria(clean(priceEl.getAttribute("aria-label")) || null) ?? (clean(priceEl.textContent) || null);
    }
    if (!price) price = priceFromAria(ariaOf(row, '[aria-label^="Current price"]'));
    bump(browseHits, "price:aria Current price", price !== null);
    if (!price) price = firstPound(summary) ?? firstPound(row.textContent);

    let merchant = textOf(row, ".WJMUdc");
    bump(browseHits, "merchant:.WJMUdc", merchant !== null);

    const moreMerchants = textOf(row, ".Ludoze");
    bump(browseHits, "more_merchants:.Ludoze", moreMerchants !== null);

    const delivery = textOf(row, ".ybnj7e");
    bump(browseHits, "delivery:.ybnj7e", delivery !== null);

    const returns = textOf(row, ".l9Ycjb");
    bump(browseHits, "returns:.l9Ycjb", returns !== null);

    const ratingRaw = textOf(row, ".yi40Hd");
    bump(browseHits, "rating:.yi40Hd", ratingRaw !== null);
    let rating = firstNumber(ratingRaw);
    if (!rating) rating = ratedNumber(ariaOf(row, '[aria-label*="Rated"]'));
    if (!rating) rating = ratedNumber(summary);

    let ratingCount = stripParens(textOf(row, ".RDApEe"));
    bump(browseHits, "rating_count:.RDApEe", ratingCount !== null);
    if (!ratingCount) ratingCount = ratedCount(row);

    if (!merchant && summary) {
      // Summary shape: "<title>. <badge>. Current price: £X. <merchant>. <delivery>. Rated ..."
      const m = summary.match(/current price:?\s*£[\d,.]+\.?\s*([^.]+?)\./i);
      merchant = m ? clean(m[1]) : null;
    }

    if (!title && !price) continue;

    const browseOffer: Offer = {
      section: "browse",
      title: title ?? "",
      price: price ?? "",
      compare_at: textOf(row, ".tWaJ3e"),
      merchant: merchant ?? "",
      badge: null,
      delivery,
      returns,
      rating,
      rating_count: ratingCount,
      more_merchants: moreMerchants,
      summary,
    };
    attachCardPhoto(row, browseOffer);
    browse.push(browseOffer);
  }

  const more = document.querySelector<HTMLAnchorElement>("a.o5sVme");
  const moreHref = more?.getAttribute("href") ?? null;

  capDataUrls([...sponsored, ...browse], 12);

  return {
    sponsored,
    browse,
    hits: { sponsored: sponsoredHits, browse: browseHits },
    more_results_href: moreHref,
  };
}
