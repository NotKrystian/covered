import { NextResponse } from "next/server";
import { extensionRoot, zipDirectoryRoot } from "../zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function zipResponse(body: Buffer): NextResponse {
  return new NextResponse(Uint8Array.from(body), {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="covered-reader.zip"',
      "content-length": String(body.length),
      "cache-control": "no-store",
    },
  });
}

function buildZip(): Buffer {
  return zipDirectoryRoot(extensionRoot());
}

export function GET(): NextResponse {
  return zipResponse(buildZip());
}

export function HEAD(): NextResponse {
  const body = buildZip();
  return new NextResponse(null, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="covered-reader.zip"',
      "content-length": String(body.length),
      "cache-control": "no-store",
    },
  });
}
