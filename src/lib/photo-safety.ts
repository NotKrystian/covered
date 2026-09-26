/**
 * Safety checks for listing photos (`image_url`, `image_data_url` on Offer and
 * ShortlistItem). Pure and client-safe: used by `OfferSchema` at parse time, the
 * server photo fetch, the judge and the shortlist UI.
 *
 * - A data URL must be a base64 raster (jpeg, png, webp, gif): no SVG, no HTML.
 * - A display URL must be plain https (no credentials, no port). Showing it only
 *   costs the viewer's browser a request, like browsing Google Shopping itself.
 * - The server fetches only Google's image CDNs, which is where grid thumbnails live.
 * - Bytes sent to the model must sniff as a raster, whatever the label claimed.
 */

/** Largest data URL kept (a 360 px jpeg at quality 0.6 is ~20–60 KB of base64). */
export const IMAGE_DATA_URL_MAX = 500_000;
const IMAGE_URL_MAX = 2048;

const DATA_URL_RE = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const GOOGLE_IMAGE_HOST_RE = /^[a-z0-9-]+\.(?:gstatic\.com|googleusercontent\.com|ggpht\.com)$/;

/** The data URL when it is a bounded base64 raster image, else null. */
export function safeImageDataUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > IMAGE_DATA_URL_MAX) return null;
  return DATA_URL_RE.test(value) ? value : null;
}

/** The URL when it is plain https with no credentials or port, else null. */
export function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > IMAGE_URL_MAX) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  return url.toString();
}

/** True only for https URLs on Google's image CDNs: the hosts the server may fetch. */
export function isGoogleImageUrl(value: unknown): boolean {
  const safe = safeImageUrl(value);
  return safe !== null && GOOGLE_IMAGE_HOST_RE.test(new URL(safe).hostname);
}

export type ImageFormatName = "jpeg" | "png" | "gif" | "webp";

/** Raster format from the file's magic bytes; null for anything else (SVG, HTML, truncated). */
export function sniffImageFormat(bytes: Uint8Array): ImageFormatName | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}
