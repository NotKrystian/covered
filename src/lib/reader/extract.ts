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

  // ---- sponsored row ----------------------------------------------------
  const sponsoredHits: SelectorHits = {};
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

    const locationText = textOf(unit, ".rhOrK");
    bump(sponsoredHits, "location:.rhOrK", locationText !== null);

    const badge = textOf(unit, ".k7oAqd");
    bump(sponsoredHits, "badge:.k7oAqd", badge !== null);

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

    const specs = Array.from(unit.querySelectorAll(".OCkIVb span"))
      .map((el) => clean(el.textContent))
      .filter((text) => text.length > 0 && text !== "·" && text !== "•");
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
    sponsored.push(offer);
  }

  // ---- browse grid ------------------------------------------------------
  const browseHits: SelectorHits = {};
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

    let ratingRaw = textOf(row, ".yi40Hd");
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

    browse.push({
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
    });
  }

  const more = document.querySelector<HTMLAnchorElement>("a.o5sVme");
  const moreHref = more?.getAttribute("href") ?? null;

  return {
    sponsored,
    browse,
    hits: { sponsored: sponsoredHits, browse: browseHits },
    more_results_href: moreHref,
  };
}
