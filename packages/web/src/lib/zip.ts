/**
 * A minimal ZIP writer using the STORE method (no compression).
 *
 * Hand-rolled rather than adding a dependency: a kit download is a handful of
 * small text files, STORE is a byte-for-byte copy, and a correct local-header +
 * central-directory + EOCD layout is short and fully testable. Correctness is
 * pinned two ways in zip.test.ts: the standard CRC-32 check value (0xCBF43926 for
 * "123456789") and a round-trip through an independent decoder. Every multi-byte
 * field below is little-endian, per the PKZIP APPNOTE.
 */

/** CRC-32 (IEEE 802.3) lookup table, built once at module load. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of a byte buffer, as an unsigned 32-bit integer. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc = (CRC_TABLE[(crc ^ b) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
/** General-purpose bit 11: file name and content are UTF-8. */
const UTF8_FLAG = 0x0800;
/** A valid DOS date placeholder (1980-01-01); zip has no need of a real mtime here. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;
/** Version needed to extract: 2.0 — the floor for the STORE method. */
const VERSION = 20;

interface StagedEntry {
  readonly nameBytes: Uint8Array;
  readonly data: Uint8Array;
  readonly crc: number;
  /** Byte offset of this entry's local header from the start of the archive. */
  readonly offset: number;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Encode a map of `path -> text` as a STORE-method ZIP archive.
 *
 * Entry names are stored relative: a leading `/` is stripped so extractors do not
 * synthesize an odd top-level folder from the bundle's absolute-looking paths.
 */
export function zipSync(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const staged: StagedEntry[] = [];
  let offset = 0;

  for (const [rawName, content] of Object.entries(files)) {
    const name = rawName.replace(/^\/+/, '');
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);

    const header = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(header.buffer);
    dv.setUint32(0, SIG_LOCAL, true);
    dv.setUint16(4, VERSION, true);
    dv.setUint16(6, UTF8_FLAG, true);
    dv.setUint16(8, 0, true); // method: store
    dv.setUint16(10, DOS_TIME, true);
    dv.setUint16(12, DOS_DATE, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true); // compressed size == uncompressed for store
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true); // extra length
    header.set(nameBytes, 30);

    localParts.push(header, data);
    staged.push({ nameBytes, data, crc, offset });
    offset += header.length + data.length;
  }

  const centralStart = offset;
  for (const e of staged) {
    const record = new Uint8Array(46 + e.nameBytes.length);
    const dv = new DataView(record.buffer);
    dv.setUint32(0, SIG_CENTRAL, true);
    dv.setUint16(4, VERSION, true); // version made by
    dv.setUint16(6, VERSION, true); // version needed
    dv.setUint16(8, UTF8_FLAG, true);
    dv.setUint16(10, 0, true); // method: store
    dv.setUint16(12, DOS_TIME, true);
    dv.setUint16(14, DOS_DATE, true);
    dv.setUint32(16, e.crc, true);
    dv.setUint32(20, e.data.length, true);
    dv.setUint32(24, e.data.length, true);
    dv.setUint16(28, e.nameBytes.length, true);
    dv.setUint16(30, 0, true); // extra length
    dv.setUint16(32, 0, true); // comment length
    dv.setUint16(34, 0, true); // disk number start
    dv.setUint16(36, 0, true); // internal attributes
    dv.setUint32(38, 0, true); // external attributes
    dv.setUint32(42, e.offset, true); // local header offset
    record.set(e.nameBytes, 46);
    centralParts.push(record);
    offset += record.length;
  }
  const centralSize = offset - centralStart;

  const eocd = new Uint8Array(22);
  const dv = new DataView(eocd.buffer);
  dv.setUint32(0, SIG_EOCD, true);
  dv.setUint16(4, 0, true); // this disk number
  dv.setUint16(6, 0, true); // disk with central dir
  dv.setUint16(8, staged.length, true); // entries on this disk
  dv.setUint16(10, staged.length, true); // total entries
  dv.setUint32(12, centralSize, true);
  dv.setUint32(16, centralStart, true);
  dv.setUint16(20, 0, true); // comment length

  return concatBytes([...localParts, ...centralParts, eocd]);
}
