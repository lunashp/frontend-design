import { describe, it, expect } from 'vitest';
import { crc32, zipSync } from '../src/lib/zip.js';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

interface DecodedEntry {
  name: string;
  content: string;
  crc: number;
}

/**
 * A small, independent STORE-method reader. It walks the local file headers,
 * then the central directory, then the end-of-central-directory record, and
 * decodes each stored payload back to text — proving the archive zipSync writes
 * is structurally valid and round-trips, not merely "some bytes".
 */
function decodeZip(bytes: Uint8Array): DecodedEntry[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries: DecodedEntry[] = [];

  let p = 0;
  while (p + 4 <= bytes.length && dv.getUint32(p, true) === SIG_LOCAL) {
    const method = dv.getUint16(p + 8, true);
    if (method !== 0) throw new Error(`expected STORE (0), got method ${method}`);
    const crc = dv.getUint32(p + 14, true);
    const compSize = dv.getUint32(p + 18, true);
    const uncompSize = dv.getUint32(p + 22, true);
    if (compSize !== uncompSize) throw new Error('STORE must have compSize === uncompSize');
    const nameLen = dv.getUint16(p + 26, true);
    const extraLen = dv.getUint16(p + 28, true);
    const nameStart = p + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen));
    const content = decoder.decode(bytes.subarray(dataStart, dataStart + uncompSize));
    entries.push({ name, content, crc });
    p = dataStart + uncompSize;
  }

  // Central directory must follow, one record per entry.
  let centralCount = 0;
  while (p + 4 <= bytes.length && dv.getUint32(p, true) === SIG_CENTRAL) {
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    // The central-dir offset must point at a real local header.
    if (dv.getUint32(localOffset, true) !== SIG_LOCAL) {
      throw new Error('central directory offset does not point at a local header');
    }
    centralCount++;
    p = p + 46 + nameLen + extraLen + commentLen;
  }

  if (dv.getUint32(p, true) !== SIG_EOCD) throw new Error('missing end-of-central-directory record');
  const totalEntries = dv.getUint16(p + 10, true);
  if (totalEntries !== entries.length || centralCount !== entries.length) {
    throw new Error('entry counts disagree across sections');
  }
  return entries;
}

describe('crc32', () => {
  it('matches the canonical CRC-32 check value for "123456789"', () => {
    // 0xCBF43926 is the standard check value every CRC-32 implementation must
    // produce for the ASCII string "123456789" — a broken table fails here.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('is 0 for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('zipSync', () => {
  it('produces a structurally valid archive that round-trips its files', () => {
    const files = {
      '/tokens.css': ':root{--color-1:#fff}',
      '/src/components/Card/Card.tsx': 'export const Card = () => null;\n',
    };
    const decoded = decodeZip(zipSync(files));
    // Entry names are stored relative: the leading slash is stripped so a tool
    // does not create an odd top-level folder on extract.
    const byName = new Map(decoded.map((e) => [e.name, e.content]));
    expect(byName.get('tokens.css')).toBe(files['/tokens.css']);
    expect(byName.get('src/components/Card/Card.tsx')).toBe(
      files['/src/components/Card/Card.tsx'],
    );
  });

  it('records a correct CRC-32 for each stored file', () => {
    const files = { '/a.txt': 'hello world' };
    const [entry] = decodeZip(zipSync(files));
    expect(entry).toBeDefined();
    expect(entry?.crc).toBe(crc32(new TextEncoder().encode('hello world')));
  });

  it('handles an empty file', () => {
    const decoded = decodeZip(zipSync({ '/empty': '' }));
    expect(decoded).toHaveLength(1);
    expect(decoded[0]?.content).toBe('');
    expect(decoded[0]?.crc).toBe(0);
  });

  it('preserves multibyte UTF-8 content byte-for-byte', () => {
    const files = { '/i18n.ts': "export const label = 'café ☕ — 日本語';\n" };
    const decoded = decodeZip(zipSync(files));
    expect(decoded[0]?.content).toBe(files['/i18n.ts']);
  });

  it('writes a valid (empty) archive for no files', () => {
    const decoded = decodeZip(zipSync({}));
    expect(decoded).toEqual([]);
  });
});
