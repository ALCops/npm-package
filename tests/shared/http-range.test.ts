import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as https from 'https';

// ── Mock https module ──
vi.mock('https', () => ({
    request: vi.fn(),
}));

const mockRequest = https.request as unknown as ReturnType<typeof vi.fn>;

import {
    fetchRange,
    getContentLength,
    parseZipCentralDirectory,
    readZipEOCD,
    extractRemoteZipEntry,
    findEntryByFilename,
    type ZipCentralEntry,
} from '../../src/http-range';

// ── Helpers for mocking https.request ──

interface MockResponseOptions {
    statusCode?: number;
    headers?: Record<string, string>;
    body?: Buffer;
}

/**
 * Create a fake IncomingMessage (readable EventEmitter) and wire it
 * into mockRequest so the next `https.request()` call receives it.
 */
function enqueueResponse(opts: MockResponseOptions) {
    mockRequest.mockImplementationOnce((_url: string, _reqOpts: unknown, cb: (res: EventEmitter & { statusCode?: number; headers: Record<string, string> }) => void) => {
        const res = new EventEmitter() as EventEmitter & {
            statusCode?: number;
            headers: Record<string, string>;
            resume: () => void;
        };
        res.statusCode = opts.statusCode ?? 200;
        res.headers = opts.headers ?? {};
        res.resume = () => {};

        // Simulate async delivery
        process.nextTick(() => {
            cb(res);
            if (opts.body) {
                res.emit('data', opts.body);
            }
            res.emit('end');
        });

        // Return a fake ClientRequest
        const req = new EventEmitter();
        (req as EventEmitter & { end: () => void }).end = () => {};
        return req;
    });
}

beforeEach(() => {
    vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────
// fetchRange
// ────────────────────────────────────────────────────────────────
describe('fetchRange', () => {
    it('returns the response body as a Buffer', async () => {
        const payload = Buffer.from('hello-range');
        enqueueResponse({ statusCode: 206, body: payload });

        const result = await fetchRange('https://example.com/file.zip', 0, 10);
        expect(result).toEqual(payload);
    });

    it('sets the Range header correctly', async () => {
        enqueueResponse({ statusCode: 206, body: Buffer.alloc(0) });

        await fetchRange('https://example.com/file.zip', 100, 200);

        const [, reqOpts] = mockRequest.mock.calls[0];
        expect(reqOpts.headers.Range).toBe('bytes=100-200');
    });

    it('follows redirects', async () => {
        // First response: redirect
        enqueueResponse({
            statusCode: 302,
            headers: { location: 'https://cdn.example.com/file.zip' },
        });
        // Second response: actual data
        const payload = Buffer.from('redirected-data');
        enqueueResponse({ statusCode: 206, body: payload });

        const result = await fetchRange('https://example.com/file.zip', 0, 13);
        expect(result).toEqual(payload);
        expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('rejects after too many redirects', async () => {
        for (let i = 0; i < 7; i++) {
            enqueueResponse({
                statusCode: 302,
                headers: { location: `https://example.com/hop${i}` },
            });
        }

        await expect(fetchRange('https://example.com/file.zip', 0, 10))
            .rejects.toThrow('Too many redirects');
    });
});

// ────────────────────────────────────────────────────────────────
// getContentLength
// ────────────────────────────────────────────────────────────────
describe('getContentLength', () => {
    it('returns the content-length from a HEAD response', async () => {
        enqueueResponse({
            statusCode: 200,
            headers: { 'content-length': '987654' },
        });

        const len = await getContentLength('https://example.com/file.zip');
        expect(len).toBe(987654);

        const [, reqOpts] = mockRequest.mock.calls[0];
        expect(reqOpts.method).toBe('HEAD');
    });

    it('follows redirects on HEAD requests', async () => {
        enqueueResponse({
            statusCode: 301,
            headers: { location: 'https://cdn.example.com/file.zip' },
        });
        enqueueResponse({
            statusCode: 200,
            headers: { 'content-length': '42' },
        });

        const len = await getContentLength('https://example.com/file.zip');
        expect(len).toBe(42);
        expect(mockRequest).toHaveBeenCalledTimes(2);
    });
});

// ────────────────────────────────────────────────────────────────
// parseZipCentralDirectory  (pure buffer parsing – no mocks)
// ────────────────────────────────────────────────────────────────
describe('parseZipCentralDirectory', () => {
    /** Build a minimal central directory entry buffer. */
    function buildCDEntry(opts: {
        fileName: string;
        compressedSize: number;
        uncompressedSize: number;
        localHeaderOffset: number;
        compressionMethod: number;
        extra?: Buffer;
        comment?: Buffer;
    }): Buffer {
        const nameBytes = Buffer.from(opts.fileName, 'utf-8');
        const extra = opts.extra ?? Buffer.alloc(0);
        const comment = opts.comment ?? Buffer.alloc(0);
        const fixedSize = 46;
        const buf = Buffer.alloc(fixedSize + nameBytes.length + extra.length + comment.length);

        buf.writeUInt32LE(0x02014b50, 0);     // signature
        buf.writeUInt16LE(20, 4);              // version made by
        buf.writeUInt16LE(20, 6);              // version needed
        buf.writeUInt16LE(0, 8);               // flags
        buf.writeUInt16LE(opts.compressionMethod, 10);
        buf.writeUInt16LE(0, 12);              // last mod time
        buf.writeUInt16LE(0, 14);              // last mod date
        buf.writeUInt32LE(0, 16);              // crc-32
        buf.writeUInt32LE(opts.compressedSize, 20);
        buf.writeUInt32LE(opts.uncompressedSize, 24);
        buf.writeUInt16LE(nameBytes.length, 28);
        buf.writeUInt16LE(extra.length, 30);
        buf.writeUInt16LE(comment.length, 32);
        buf.writeUInt16LE(0, 34);              // disk number start
        buf.writeUInt16LE(0, 36);              // internal file attributes
        buf.writeUInt32LE(0, 38);              // external file attributes
        buf.writeUInt32LE(opts.localHeaderOffset, 42);

        nameBytes.copy(buf, fixedSize);
        extra.copy(buf, fixedSize + nameBytes.length);
        comment.copy(buf, fixedSize + nameBytes.length + extra.length);

        return buf;
    }

    it('parses a single entry', () => {
        const cd = buildCDEntry({
            fileName: 'readme.txt',
            compressedSize: 100,
            uncompressedSize: 200,
            localHeaderOffset: 0,
            compressionMethod: 8,
        });

        const entries = parseZipCentralDirectory(cd);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toEqual<ZipCentralEntry>({
            fileName: 'readme.txt',
            compressedSize: 100,
            uncompressedSize: 200,
            localHeaderOffset: 0,
            compressionMethod: 8,
        });
    });

    it('parses multiple entries', () => {
        const entry1 = buildCDEntry({
            fileName: 'a.txt',
            compressedSize: 10,
            uncompressedSize: 10,
            localHeaderOffset: 0,
            compressionMethod: 0,
        });
        const entry2 = buildCDEntry({
            fileName: 'dir/b.bin',
            compressedSize: 500,
            uncompressedSize: 1024,
            localHeaderOffset: 200,
            compressionMethod: 8,
        });
        const cd = Buffer.concat([entry1, entry2]);

        const entries = parseZipCentralDirectory(cd);
        expect(entries).toHaveLength(2);
        expect(entries[0].fileName).toBe('a.txt');
        expect(entries[1].fileName).toBe('dir/b.bin');
        expect(entries[1].localHeaderOffset).toBe(200);
    });

    it('handles entries with extra fields and comments', () => {
        const extra = Buffer.from('EXTRA_DATA');
        const comment = Buffer.from('A comment');
        const cd = buildCDEntry({
            fileName: 'withextra.txt',
            compressedSize: 50,
            uncompressedSize: 50,
            localHeaderOffset: 400,
            compressionMethod: 0,
            extra,
            comment,
        });

        const entries = parseZipCentralDirectory(cd);
        expect(entries).toHaveLength(1);
        expect(entries[0].fileName).toBe('withextra.txt');
        expect(entries[0].localHeaderOffset).toBe(400);
    });

    it('returns empty array for empty buffer', () => {
        expect(parseZipCentralDirectory(Buffer.alloc(0))).toEqual([]);
    });

    it('returns empty array for buffer without valid signature', () => {
        const garbage = Buffer.from('not a zip central directory at all');
        expect(parseZipCentralDirectory(garbage)).toEqual([]);
    });
});

// ────────────────────────────────────────────────────────────────
// readZipEOCD
// ────────────────────────────────────────────────────────────────
describe('readZipEOCD', () => {
    /** Build a minimal EOCD buffer. */
    function buildEOCD(opts: { entryCount: number; cdSize: number; cdOffset: number }): Buffer {
        const buf = Buffer.alloc(22);
        buf.writeUInt32LE(0x06054b50, 0);  // signature
        buf.writeUInt16LE(0, 4);           // disk number
        buf.writeUInt16LE(0, 6);           // disk with CD
        buf.writeUInt16LE(opts.entryCount, 8);  // entries on this disk
        buf.writeUInt16LE(opts.entryCount, 10); // total entries
        buf.writeUInt32LE(opts.cdSize, 12);
        buf.writeUInt32LE(opts.cdOffset, 16);
        buf.writeUInt16LE(0, 20);          // comment length
        return buf;
    }

    it('reads EOCD from the tail of a remote file', async () => {
        const eocd = buildEOCD({ entryCount: 3, cdSize: 512, cdOffset: 1024 });
        // Total file size = some data + EOCD
        const prefix = Buffer.alloc(100, 0);
        const fullFile = Buffer.concat([prefix, eocd]);
        const totalSize = fullFile.length;

        // HEAD request for content-length
        enqueueResponse({ statusCode: 200, headers: { 'content-length': String(totalSize) } });
        // GET request for the tail
        enqueueResponse({ statusCode: 206, body: fullFile });

        const result = await readZipEOCD('https://example.com/file.zip');
        expect(result).toEqual({
            centralDirectoryOffset: 1024,
            centralDirectorySize: 512,
            entryCount: 3,
        });
    });

    it('finds EOCD even with a trailing comment', async () => {
        const comment = Buffer.from('This is a zip comment');
        const eocdBuf = Buffer.alloc(22);
        eocdBuf.writeUInt32LE(0x06054b50, 0);
        eocdBuf.writeUInt16LE(0, 4);
        eocdBuf.writeUInt16LE(0, 6);
        eocdBuf.writeUInt16LE(5, 8);
        eocdBuf.writeUInt16LE(5, 10);
        eocdBuf.writeUInt32LE(2048, 12);
        eocdBuf.writeUInt32LE(4096, 16);
        eocdBuf.writeUInt16LE(comment.length, 20);

        const fullTail = Buffer.concat([Buffer.alloc(10), eocdBuf, comment]);
        const totalSize = fullTail.length;

        enqueueResponse({ statusCode: 200, headers: { 'content-length': String(totalSize) } });
        enqueueResponse({ statusCode: 206, body: fullTail });

        const result = await readZipEOCD('https://example.com/file.zip');
        expect(result.entryCount).toBe(5);
        expect(result.centralDirectorySize).toBe(2048);
        expect(result.centralDirectoryOffset).toBe(4096);
    });
});

// ────────────────────────────────────────────────────────────────
// extractRemoteZipEntry  (end-to-end with mocks)
// ────────────────────────────────────────────────────────────────
describe('extractRemoteZipEntry', () => {
    /**
     * Build a complete mini-ZIP in memory with one stored (uncompressed) entry,
     * then mock the HTTP calls so extractRemoteZipEntry can fetch it.
     */
    it('extracts a stored (method=0) file', async () => {
        const fileName = 'hello.txt';
        const fileContent = Buffer.from('Hello, World!');
        const nameBytes = Buffer.from(fileName, 'utf-8');

        // ── Local file header ──
        const localHeader = Buffer.alloc(30 + nameBytes.length);
        localHeader.writeUInt32LE(0x04034b50, 0); // signature
        localHeader.writeUInt16LE(20, 4);          // version needed
        localHeader.writeUInt16LE(0, 6);           // flags
        localHeader.writeUInt16LE(0, 8);           // compression method (stored)
        localHeader.writeUInt16LE(0, 10);          // mod time
        localHeader.writeUInt16LE(0, 12);          // mod date
        localHeader.writeUInt32LE(0, 14);          // crc32
        localHeader.writeUInt32LE(fileContent.length, 18); // compressed size
        localHeader.writeUInt32LE(fileContent.length, 22); // uncompressed size
        localHeader.writeUInt16LE(nameBytes.length, 26);   // name length
        localHeader.writeUInt16LE(0, 28);                  // extra length
        nameBytes.copy(localHeader, 30);

        const localFileRecord = Buffer.concat([localHeader, fileContent]);
        const cdOffset = localFileRecord.length;

        // ── Central directory entry ──
        const cdEntry = Buffer.alloc(46 + nameBytes.length);
        cdEntry.writeUInt32LE(0x02014b50, 0);
        cdEntry.writeUInt16LE(20, 4);
        cdEntry.writeUInt16LE(20, 6);
        cdEntry.writeUInt16LE(0, 8);
        cdEntry.writeUInt16LE(0, 10);  // compression method (stored)
        cdEntry.writeUInt32LE(fileContent.length, 20); // compressed size
        cdEntry.writeUInt32LE(fileContent.length, 22); // uncompressed size
        cdEntry.writeUInt16LE(nameBytes.length, 28);
        cdEntry.writeUInt16LE(0, 30);
        cdEntry.writeUInt16LE(0, 32);
        cdEntry.writeUInt32LE(0, 42); // local header offset = 0
        nameBytes.copy(cdEntry, 46);

        const cdSize = cdEntry.length;
        const eocdOffset = cdOffset + cdSize;

        // ── EOCD ──
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(0, 4);
        eocd.writeUInt16LE(0, 6);
        eocd.writeUInt16LE(1, 8);
        eocd.writeUInt16LE(1, 10);
        eocd.writeUInt32LE(cdSize, 12);
        eocd.writeUInt32LE(cdOffset, 16);
        eocd.writeUInt16LE(0, 20);

        const fullZip = Buffer.concat([localFileRecord, cdEntry, eocd]);
        const totalSize = fullZip.length;

        // Mock calls in order:
        // 1. HEAD for getContentLength (readZipEOCD → getContentLength)
        enqueueResponse({ statusCode: 200, headers: { 'content-length': String(totalSize) } });
        // 2. GET tail for EOCD (readZipEOCD → fetchRange)
        enqueueResponse({ statusCode: 206, body: fullZip });
        // 3. GET central directory (extractRemoteZipEntry → fetchRange for CD)
        enqueueResponse({ statusCode: 206, body: cdEntry });
        // 4. GET 30-byte local file header
        enqueueResponse({ statusCode: 206, body: localHeader.subarray(0, 30) });
        // 5. GET compressed data
        enqueueResponse({ statusCode: 206, body: fileContent });

        const result = await extractRemoteZipEntry('https://example.com/test.zip', 'hello.txt');
        expect(result.toString('utf-8')).toBe('Hello, World!');
    });

    it('throws when entry is not found', async () => {
        const nameBytes = Buffer.from('only.txt', 'utf-8');

        // Build minimal CD + EOCD
        const cdEntry = Buffer.alloc(46 + nameBytes.length);
        cdEntry.writeUInt32LE(0x02014b50, 0);
        cdEntry.writeUInt16LE(20, 4);
        cdEntry.writeUInt16LE(20, 6);
        cdEntry.writeUInt16LE(0, 10);
        cdEntry.writeUInt32LE(10, 20);
        cdEntry.writeUInt32LE(10, 22);
        cdEntry.writeUInt16LE(nameBytes.length, 28);
        cdEntry.writeUInt16LE(0, 30);
        cdEntry.writeUInt16LE(0, 32);
        cdEntry.writeUInt32LE(0, 42);
        nameBytes.copy(cdEntry, 46);

        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(1, 8);
        eocd.writeUInt16LE(1, 10);
        eocd.writeUInt32LE(cdEntry.length, 12);
        eocd.writeUInt32LE(0, 16);
        eocd.writeUInt16LE(0, 20);

        const fullZip = Buffer.concat([cdEntry, eocd]);
        const totalSize = fullZip.length;

        enqueueResponse({ statusCode: 200, headers: { 'content-length': String(totalSize) } });
        enqueueResponse({ statusCode: 206, body: fullZip });
        enqueueResponse({ statusCode: 206, body: cdEntry });

        await expect(extractRemoteZipEntry('https://example.com/test.zip', 'missing.txt'))
            .rejects.toThrow('Entry not found in ZIP: missing.txt');
    });

    it('extracts by basename when exact match fails (forward slash path)', async () => {
        const nestedName = 'subdir/hello.txt';
        const fileContent = Buffer.from('nested content');
        const nameBytes = Buffer.from(nestedName, 'utf-8');

        const localHeader = Buffer.alloc(30 + nameBytes.length);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt32LE(fileContent.length, 18);
        localHeader.writeUInt32LE(fileContent.length, 22);
        localHeader.writeUInt16LE(nameBytes.length, 26);
        localHeader.writeUInt16LE(0, 28);
        nameBytes.copy(localHeader, 30);

        const localFileRecord = Buffer.concat([localHeader, fileContent]);
        const cdOffset = localFileRecord.length;

        const cdEntry = Buffer.alloc(46 + nameBytes.length);
        cdEntry.writeUInt32LE(0x02014b50, 0);
        cdEntry.writeUInt16LE(0, 10);
        cdEntry.writeUInt32LE(fileContent.length, 20);
        cdEntry.writeUInt32LE(fileContent.length, 22);
        cdEntry.writeUInt16LE(nameBytes.length, 28);
        cdEntry.writeUInt16LE(0, 30);
        cdEntry.writeUInt16LE(0, 32);
        cdEntry.writeUInt32LE(0, 42);
        nameBytes.copy(cdEntry, 46);

        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(1, 8);
        eocd.writeUInt16LE(1, 10);
        eocd.writeUInt32LE(cdEntry.length, 12);
        eocd.writeUInt32LE(cdOffset, 16);
        eocd.writeUInt16LE(0, 20);

        const fullZip = Buffer.concat([localFileRecord, cdEntry, eocd]);

        enqueueResponse({ statusCode: 200, headers: { 'content-length': String(fullZip.length) } });
        enqueueResponse({ statusCode: 206, body: fullZip });
        enqueueResponse({ statusCode: 206, body: cdEntry });
        enqueueResponse({ statusCode: 206, body: localHeader.subarray(0, 30) });
        enqueueResponse({ statusCode: 206, body: fileContent });

        const result = await extractRemoteZipEntry('https://example.com/test.zip', 'hello.txt');
        expect(result.toString('utf-8')).toBe('nested content');
    });

    it('extracts by basename when path uses backslash separators', async () => {
        const nestedName = 'ModernDev\\program files\\ALLanguage.vsix';
        const fileContent = Buffer.from('vsix-data');
        const nameBytes = Buffer.from(nestedName, 'utf-8');

        const localHeader = Buffer.alloc(30 + nameBytes.length);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt32LE(fileContent.length, 18);
        localHeader.writeUInt32LE(fileContent.length, 22);
        localHeader.writeUInt16LE(nameBytes.length, 26);
        localHeader.writeUInt16LE(0, 28);
        nameBytes.copy(localHeader, 30);

        const localFileRecord = Buffer.concat([localHeader, fileContent]);
        const cdOffset = localFileRecord.length;

        const cdEntry = Buffer.alloc(46 + nameBytes.length);
        cdEntry.writeUInt32LE(0x02014b50, 0);
        cdEntry.writeUInt16LE(0, 10);
        cdEntry.writeUInt32LE(fileContent.length, 20);
        cdEntry.writeUInt32LE(fileContent.length, 22);
        cdEntry.writeUInt16LE(nameBytes.length, 28);
        cdEntry.writeUInt16LE(0, 30);
        cdEntry.writeUInt16LE(0, 32);
        cdEntry.writeUInt32LE(0, 42);
        nameBytes.copy(cdEntry, 46);

        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(1, 8);
        eocd.writeUInt16LE(1, 10);
        eocd.writeUInt32LE(cdEntry.length, 12);
        eocd.writeUInt32LE(cdOffset, 16);
        eocd.writeUInt16LE(0, 20);

        const fullZip = Buffer.concat([localFileRecord, cdEntry, eocd]);

        enqueueResponse({ statusCode: 200, headers: { 'content-length': String(fullZip.length) } });
        enqueueResponse({ statusCode: 206, body: fullZip });
        enqueueResponse({ statusCode: 206, body: cdEntry });
        enqueueResponse({ statusCode: 206, body: localHeader.subarray(0, 30) });
        enqueueResponse({ statusCode: 206, body: fileContent });

        const result = await extractRemoteZipEntry('https://example.com/test.zip', 'ALLanguage.vsix');
        expect(result.toString('utf-8')).toBe('vsix-data');
    });
});

describe('findEntryByFilename', () => {
    it('matches exact filename', () => {
        const entries: ZipCentralEntry[] = [
            { fileName: 'ALLanguage.vsix', compressedSize: 10, uncompressedSize: 10, localHeaderOffset: 0, compressionMethod: 0 },
        ];
        expect(findEntryByFilename(entries, 'ALLanguage.vsix')?.fileName).toBe('ALLanguage.vsix');
    });

    it('matches forward-slash nested path', () => {
        const entries: ZipCentralEntry[] = [
            { fileName: 'subdir/nested/ALLanguage.vsix', compressedSize: 10, uncompressedSize: 10, localHeaderOffset: 0, compressionMethod: 0 },
        ];
        expect(findEntryByFilename(entries, 'ALLanguage.vsix')?.fileName).toBe('subdir/nested/ALLanguage.vsix');
    });

    it('matches backslash-separated path', () => {
        const entries: ZipCentralEntry[] = [
            { fileName: 'ModernDev\\program files\\ALLanguage.vsix', compressedSize: 10, uncompressedSize: 10, localHeaderOffset: 0, compressionMethod: 0 },
        ];
        expect(findEntryByFilename(entries, 'ALLanguage.vsix')?.fileName).toContain('ALLanguage.vsix');
    });

    it('returns undefined when no match', () => {
        const entries: ZipCentralEntry[] = [
            { fileName: 'other.txt', compressedSize: 10, uncompressedSize: 10, localHeaderOffset: 0, compressionMethod: 0 },
        ];
        expect(findEntryByFilename(entries, 'ALLanguage.vsix')).toBeUndefined();
    });
});
