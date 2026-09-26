import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

const SKIP_DIR = new Set(["node_modules"]);
const SKIP_FILE = new Set([".DS_Store"]);

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type ZipEntry = { name: string; data: Buffer };

function collect(dir: string, prefix: string): ZipEntry[] {
  const out: ZipEntry[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (SKIP_DIR.has(entry) || SKIP_FILE.has(entry)) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collect(full, prefix ? `${prefix}/${entry}` : entry));
      continue;
    }
    if (!st.isFile()) continue;
    if (entry.endsWith(".test.js") || entry.endsWith(".test.ts")) continue;
    const name = prefix ? `${prefix}/${entry}` : entry;
    out.push({ name, data: readFileSync(full) });
  }
  return out;
}

/** PKZIP (deflate) of `extension/` files at the zip root — no wrapping folder. */
export function zipDirectoryRoot(dir: string): Buffer {
  const files = collect(dir, "");
  if (files.length === 0) throw new Error(`no files to zip in ${dir}`);

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const compressed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const method = 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const localFile = Buffer.concat([local, name, compressed]);
    locals.push(localFile);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centrals.push(Buffer.concat([central, name]));
    offset += localFile.length;
  }

  const localBlob = Buffer.concat(locals);
  const centralBlob = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBlob.length, 12);
  eocd.writeUInt32LE(localBlob.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localBlob, centralBlob, eocd]);
}

export function extensionRoot(): string {
  const candidates = [path.join(process.cwd(), "extension"), path.resolve(process.cwd(), "..", "extension")];
  for (const dir of candidates) {
    try {
      if (statSync(path.join(dir, "manifest.json")).isFile()) return dir;
    } catch {
      // try next
    }
  }
  throw new Error("extension/manifest.json not found from process.cwd()");
}
