import { describe, it, expect } from 'vitest';
import { deflateSync } from 'fflate';
import { extractZipEntryFromBuffer, findEntryByFilename, listZipEntries } from '../../src/zip-local';
import { ZipCentralEntry } from '../../src/http-range';
import { nullLogger } from '../../src/logger';

// ── Helpers to build minimal valid ZIP buffers ──

function buildZipBuffer(
    files: { name: string; content: Buffer; compress?: boolean }[],
): Buffer {
    const localHeaders: Buffer[] = [];
    const centralEntries: Buffer[] = [];
    let localOffset = 0;

    for (const file of files) {
        const nameBytes = Buffer.from(file.name, 'utf-8');
        const uncompressed = file.content;
        const compressed =
            file.compress !== false
                ? Buffer.from(deflateSync(uncompressed))
                : uncompressed;
        const method = file.compress !== false ? 8 : 0;

        // Local file header (30 bytes fixed + name + data)
        const local = Buffer.alloc(30 + nameBytes.length + compressed.length);
        local.writeUInt32LE(0x04034b50, 0); // signature
        local.writeUInt16LE(20, 4); // version needed
        local.writeUInt16LE(0, 6); // flags
        local.writeUInt16LE(method, 8); // compression
        local.writeUInt16LE(0, 10); // mod time
        local.writeUInt16LE(0, 12); // mod date
        local.writeUInt32LE(0, 14); // crc32 (not checked by our parser)
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(uncompressed.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        local.writeUInt16LE(0, 28); // extra field length
        nameBytes.copy(local, 30);
        compressed.copy(local, 30 + nameBytes.length);

        // Central directory entry (46 bytes fixed + name)
        const central = Buffer.alloc(46 + nameBytes.length);
        central.writeUInt32LE(0x02014b50, 0); // signature
        central.writeUInt16LE(20, 4); // version made by
        central.writeUInt16LE(20, 6); // version needed
        central.writeUInt16LE(0, 8); // flags
        central.writeUInt16LE(method, 10); // compression
        central.writeUInt16LE(0, 12); // mod time
        central.writeUInt16LE(0, 14); // mod date
        central.writeUInt32LE(0, 16); // crc32
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(uncompressed.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt16LE(0, 30); // extra field length
        central.writeUInt16LE(0, 32); // comment length
        central.writeUInt16LE(0, 34); // disk number
        central.writeUInt16LE(0, 36); // internal attrs
        central.writeUInt32LE(0, 38); // external attrs
        central.writeUInt32LE(localOffset, 42);
        nameBytes.copy(central, 46);

        localHeaders.push(local);
        centralEntries.push(central);
        localOffset += local.length;
    }

    const cdOffset = localOffset;
    const cdBuffer = Buffer.concat(centralEntries);

    // EOCD (22 bytes)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4); // disk number
    eocd.writeUInt16LE(0, 6); // disk with cd
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cdBuffer.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    eocd.writeUInt16LE(0, 20); // comment length

    return Buffer.concat([...localHeaders, cdBuffer, eocd]);
}

// ── Tests ──

describe('findEntryByFilename', () => {
    const entries: ZipCentralEntry[] = [
        { fileName: 'root.txt', compressedSize: 0, uncompressedSize: 0, localHeaderOffset: 0, compressionMethod: 0 },
        { fileName: 'path/to/ALLanguage.vsix', compressedSize: 0, uncompressedSize: 0, localHeaderOffset: 0, compressionMethod: 0 },
        { fileName: 'other/file.dll', compressedSize: 0, uncompressedSize: 0, localHeaderOffset: 0, compressionMethod: 0 },
    ];

    it('finds an entry by exact filename', () => {
        const result = findEntryByFilename(entries, 'root.txt');
        expect(result?.fileName).toBe('root.txt');
    });

    it('finds a nested entry by basename', () => {
        const result = findEntryByFilename(entries, 'ALLanguage.vsix');
        expect(result?.fileName).toBe('path/to/ALLanguage.vsix');
    });

    it('returns undefined when no match', () => {
        const result = findEntryByFilename(entries, 'nonexistent.zip');
        expect(result).toBeUndefined();
    });
});

describe('extractZipEntryFromBuffer', () => {
    it('extracts a compressed entry by exact path', () => {
        const content = Buffer.from('hello world');
        const zip = buildZipBuffer([{ name: 'test.txt', content, compress: true }]);

        const result = extractZipEntryFromBuffer(zip, 'test.txt');
        expect(result.toString('utf-8')).toBe('hello world');
    });

    it('extracts a stored (uncompressed) entry', () => {
        const content = Buffer.from('stored data');
        const zip = buildZipBuffer([{ name: 'data.bin', content, compress: false }]);

        const result = extractZipEntryFromBuffer(zip, 'data.bin');
        expect(result.toString('utf-8')).toBe('stored data');
    });

    it('extracts by basename from nested path', () => {
        const content = Buffer.from('nested content');
        const zip = buildZipBuffer([
            { name: 'dir/sub/file.txt', content, compress: true },
        ]);

        const result = extractZipEntryFromBuffer(zip, 'file.txt');
        expect(result.toString('utf-8')).toBe('nested content');
    });

    it('extracts from a multi-entry ZIP', () => {
        const zip = buildZipBuffer([
            { name: 'first.txt', content: Buffer.from('aaa'), compress: true },
            { name: 'second.txt', content: Buffer.from('bbb'), compress: true },
            { name: 'third.txt', content: Buffer.from('ccc'), compress: false },
        ]);

        expect(extractZipEntryFromBuffer(zip, 'first.txt').toString()).toBe('aaa');
        expect(extractZipEntryFromBuffer(zip, 'second.txt').toString()).toBe('bbb');
        expect(extractZipEntryFromBuffer(zip, 'third.txt').toString()).toBe('ccc');
    });

    it('throws when entry is not found', () => {
        const zip = buildZipBuffer([
            { name: 'exists.txt', content: Buffer.from('x'), compress: false },
        ]);

        expect(() => extractZipEntryFromBuffer(zip, 'missing.txt')).toThrow(
            'Entry not found in ZIP buffer: missing.txt',
        );
    });

    it('logs only basename-matching entries when entry is not found', () => {
        const zip = buildZipBuffer([
            { name: 'a/foo.dll', content: Buffer.from('a'), compress: false },
            { name: 'b/foo.dll', content: Buffer.from('b'), compress: false },
            { name: 'unrelated.txt', content: Buffer.from('c'), compress: false },
        ]);

        const debugMessages: string[] = [];
        const logger = { ...nullLogger, debug: (msg: string) => debugMessages.push(msg) };

        expect(() => extractZipEntryFromBuffer(zip, 'x/y/foo.dll', logger)).toThrow();
        const notFoundMsg = debugMessages.find((m) => m.includes('not found'));
        expect(notFoundMsg).toContain("Entries matching 'foo.dll': a/foo.dll, b/foo.dll");
        expect(notFoundMsg).not.toContain('unrelated.txt');
    });

    it('logs count when no basename matches exist', () => {
        const zip = buildZipBuffer([
            { name: 'a.txt', content: Buffer.from('a'), compress: false },
            { name: 'b.txt', content: Buffer.from('b'), compress: false },
        ]);

        const debugMessages: string[] = [];
        const logger = { ...nullLogger, debug: (msg: string) => debugMessages.push(msg) };

        expect(() => extractZipEntryFromBuffer(zip, 'missing.dll', logger)).toThrow();
        const notFoundMsg = debugMessages.find((m) => m.includes('not found'));
        expect(notFoundMsg).toContain("No entries matching 'missing.dll' among 2 entries");
    });
});

describe('listZipEntries', () => {
    it('lists all entries in a ZIP buffer', () => {
        const zip = buildZipBuffer([
            { name: 'a.txt', content: Buffer.from('a'), compress: false },
            { name: 'dir/b.txt', content: Buffer.from('b'), compress: true },
        ]);

        const entries = listZipEntries(zip);
        expect(entries).toHaveLength(2);
        expect(entries.map((e) => e.fileName)).toEqual(['a.txt', 'dir/b.txt']);
    });
});
