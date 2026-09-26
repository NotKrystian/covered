/**
 * GET /api/image?url= — same-origin proxy for Google Shopping thumbs that
 * refuse to hotlink. Only https hosts `*.gstatic.com` and `*.googleusercontent.com`.
 */
import { NextResponse } from "next/server";
import { isProxyImageUrl, sniffImageFormat } from "@/lib/photo-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 1_000_000;

const TYPE_BY_FORMAT = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
} as const;

export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw || !isProxyImageUrl(raw)) {
    return NextResponse.json({ error: "url must be https on *.gstatic.com or *.googleusercontent.com" }, { status: 400 });
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(raw, { redirect: "error", cache: "no-store", signal: ac.signal, credentials: "omit" });
    if (!res.ok) return new Response(null, { status: 502 });
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) return new Response(null, { status: 413 });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return new Response(null, { status: 413 });
    const format = sniffImageFormat(buf);
    if (!format) return new Response(null, { status: 415 });
    return new Response(buf, {
      status: 200,
      headers: {
        "content-type": TYPE_BY_FORMAT[format],
        "cache-control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response(null, { status: 504 });
  } finally {
    clearTimeout(timer);
  }
}
