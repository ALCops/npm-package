import * as https from 'https';
import { inflateSync } from 'fflate';
import { Logger, nullLogger } from './logger';

/**
 * Fetch a range of bytes from a URL using HTTP Range requests.
 * Returns the byte data as a Buffer.
 * Follows redirects (up to 5 hops).
 */
export async function fetchRange(url: string, start: number, end: number, logger: Logger = nullLogger): Promise<Buffer> {
    logger.debug(`Range request: bytes=${start}-${end}`);
    return doRequest(url, {
        headers: { Range: `bytes=${start}-${end}` },
    }, 0, logger);
}

/**
 * Get the total content length of a URL via a HEAD request.
 * Follows redirects.
 */
export async function getContentLength(url: string, logger: Logger = nullLogger): Promise<number> {
    const buf = await doRequest(url, { method: 'HEAD' }, 0, logger);
    // doRequest stores the content-length on the returned buffer when method is HEAD
    const len = (buf as Buffer & { __contentLength?: number }).__contentLength;
    if (len === undefined) {
        throw new Error('Server did not return Content-Length header');
    }
    logger.debug(`Content-Length: ${len}`);
    return len;
}

/** ZIP End of Central Directory record. */
export interface ZipEOCD {
    centralDirectoryOffset: number;
    centralDirectorySize: number;
    entryCount: number;
}

/**
 * Read the EOCD from the last ~65KB of a remote ZIP file.
 */
export async function readZipEOCD(url: string, logger: Logger = nullLogger): Promise<ZipEOCD> {
    const totalSize = await getContentLength(url, logger);
    const tailSize = Math.min(totalSize, 65557);
    const tailStart = totalSize - tailSize;
    const tail = await fetchRange(url, tailStart, totalSize - 1, logger);

    const EOCD_SIG = 0x06054b50;

    // Scan backwards for EOCD signature
    for (let i = tail.length - 22; i >= 0; i--) {
        if (tail.readUInt32LE(i) === EOCD_SIG) {
            const entryCount = tail.readUInt16LE(i + 10);
            const centralDirectorySize = tail.readUInt32LE(i + 12);
            const centralDirectoryOffset = tail.readUInt32LE(i + 16);
            logger.debug(`EOCD: ${entryCount} entries, central directory at offset ${centralDirectoryOffset} (${centralDirectorySize} bytes)`);
            return { centralDirectoryOffset, centralDirectorySize, entryCount };
        }
    }

    throw new Error('ZIP EOCD signature not found');
}

/** A single entry from the ZIP central directory. */
export interface ZipCentralEntry {
    fileName: string;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
    compressionMethod: number;
}

/**
 * Parse ZIP central directory entries from raw bytes.
 */
export function parseZipCentralDirectory(buffer: Buffer): ZipCentralEntry[] {
    const CD_SIG = 0x02014b50;
    const entries: ZipCentralEntry[] = [];
    let offset = 0;

    while (offset + 46 <= buffer.length) {
        if (buffer.readUInt32LE(offset) !== CD_SIG) break;

        const compressionMethod = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const fileNameLength = buffer.readUInt16LE(offset + 28);
        const extraFieldLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);

        if (offset + 46 + fileNameLength > buffer.length) {
            break;
        }

        const fileName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf-8');

        entries.push({
            fileName,
            compressedSize,
            uncompressedSize,
            localHeaderOffset,
            compressionMethod,
        });

        offset += 46 + fileNameLength + extraFieldLength + commentLength;
    }

    return entries;
}

/**
 * Find a ZIP central directory entry by its filename (basename match).
 * Matches entries whose filename equals `target` exactly,
 * or whose path ends with `/<target>` or `\<target>` (Windows-style ZIP entries).
 */
export function findEntryByFilename(
    entries: ZipCentralEntry[],
    target: string,
): ZipCentralEntry | undefined {
    return entries.find(
        (e) => e.fileName === target
            || e.fileName.endsWith(`/${target}`)
            || e.fileName.endsWith(`\\${target}`),
    );
}

/**
 * Extract a single file from a remote ZIP using a known central directory entry.
 * Reads the local file header, fetches compressed data, and decompresses.
 */
export async function extractRemoteZipCentralEntry(url: string, entry: ZipCentralEntry, logger: Logger = nullLogger): Promise<Buffer> {
    logger.debug(`Extracting entry '${entry.fileName}': ${entry.compressedSize} bytes compressed, method=${entry.compressionMethod}`);

    const localHeader = await fetchRange(url, entry.localHeaderOffset, entry.localHeaderOffset + 29, logger);

    const LOCAL_SIG = 0x04034b50;
    if (localHeader.readUInt32LE(0) !== LOCAL_SIG) {
        throw new Error('Invalid local file header signature');
    }

    const localNameLen = localHeader.readUInt16LE(26);
    const localExtraLen = localHeader.readUInt16LE(28);

    const dataOffset = entry.localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedData = await fetchRange(url, dataOffset, dataOffset + entry.compressedSize - 1, logger);

    if (entry.compressionMethod === 0) {
        return Buffer.from(compressedData);
    } else if (entry.compressionMethod === 8) {
        return Buffer.from(inflateSync(compressedData));
    } else {
        throw new Error(`Unsupported compression method: ${entry.compressionMethod}`);
    }
}

/**
 * Extract a single file from a remote ZIP by name.
 * 1. Read EOCD → find central directory
 * 2. Parse central directory → find the target entry (exact match, then basename fallback)
 * 3. Read local file header to determine actual data offset
 * 4. Read compressed data and decompress if needed (deflate via fflate)
 */
export async function extractRemoteZipEntry(url: string, entryPath: string, logger: Logger = nullLogger): Promise<Buffer> {
    logger.info(`Extracting '${entryPath}' from remote ZIP`);
    const eocd = await readZipEOCD(url, logger);
    const cdBytes = await fetchRange(
        url,
        eocd.centralDirectoryOffset,
        eocd.centralDirectoryOffset + eocd.centralDirectorySize - 1,
        logger,
    );
    const entries = parseZipCentralDirectory(cdBytes);

    const entry = entries.find((e) => e.fileName === entryPath)
        ?? findEntryByFilename(entries, entryPath);
    if (!entry) {
        logger.debug(`Entry '${entryPath}' not found among ${entries.length} entries`);
        throw new Error(`Entry not found in ZIP: ${entryPath}`);
    }

    return extractRemoteZipCentralEntry(url, entry, logger);
}

// ── Internal helpers ──

function doRequest(
    url: string,
    options: { method?: string; headers?: Record<string, string> },
    redirectCount = 0,
    logger: Logger = nullLogger,
): Promise<Buffer> {
    if (redirectCount > 5) {
        return Promise.reject(new Error('Too many redirects'));
    }

    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: options.method ?? 'GET', headers: options.headers ?? {} }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                logger.debug(`Redirect ${res.statusCode} → ${res.headers.location}`);
                resolve(doRequest(res.headers.location, options, redirectCount + 1, logger));
                return;
            }

            if (options.method === 'HEAD') {
                const cl = parseInt(res.headers['content-length'] ?? '', 10);
                const buf = Buffer.alloc(0) as Buffer & { __contentLength?: number };
                buf.__contentLength = isNaN(cl) ? undefined : cl;
                res.resume(); // drain the response
                resolve(buf);
                return;
            }

            if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                return;
            }

            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });

        req.on('error', reject);
        req.end();
    });
}
