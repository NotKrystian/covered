import { createHash } from "node:crypto";
import manifest from "../../../extension/manifest.json";

/** Chrome/Brave id from a Manifest V3 `key` (SPKI DER, base64). */
export function chromeExtensionIdFromPublicKey(spkiBase64: string): string {
  const der = Buffer.from(spkiBase64, "base64");
  const hex = createHash("sha256").update(der).digest().subarray(0, 16).toString("hex");
  return [...hex]
    .map((c) => String.fromCharCode("a".charCodeAt(0) + Number.parseInt(c, 16)))
    .join("");
}

const key = typeof manifest.key === "string" && manifest.key.length > 0 ? manifest.key : null;

/** Unpacked id for this repo's `extension/manifest.json` `key`. Null if the key is missing. */
export const COVERED_READER_EXTENSION_ID = key ? chromeExtensionIdFromPublicKey(key) : null;
