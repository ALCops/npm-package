import { parseZipCentralDirectory, ZipCentralEntry, findEntryByFilename } from './http-range';
import { inflateSync } from 'fflate';
import { Logger, nullLogger } from './logger';

// Re-export for consumers that imported from here
export { findEntryByFilename } from './http-range';

/**
 * Extract a single file from an in-memory ZIP buffer.
 * The `entryPath` can be an exact path or a basename; if basename,
 * the central directory is scanned for a match via `findEntryByFilename`.
 */
export function extractZipEntryFromBuffer(
    zipBuffer: Buffer,
    entryPath: string,
    logger: Logger = nullLogger,
): Buffer {
    const eocd = readEOCDFromBuffer(zipBuffer);
    const cdBytes = zipBuffer.subarray(
        eocd.centralDirectoryOffset,
        eocd.centralDirectoryOffset + eocd.centralDirectorySize,
    );
    const entries = parseZipCentralDirectory(cdBytes);
    logger.debug(`ZIP buffer: ${entries.length} entries, searching for '${entryPath}'`);

    // Try exact match first, then basename match
    let entry = entries.find((e) => e.fileName === entryPath);
    if (!entry) {
        entry = findEntryByFilename(entries, entryPath);
    }
    if (!entry) {
        const basename = entryPath.split('/').pop()!;
        const basenameMatches = entries.filter(
            (e) => e.fileName === basename
                || e.fileName.endsWith(`/${basename}`)
                || e.fileName.endsWith(`\\${basename}`),
        );
        if (basenameMatches.length > 0) {
            logger.debug(`Entry '${entryPath}' not found. Entries matching '${basename}': ${basenameMatches.map(e => e.fileName).join(', ')}`);
        } else {
            logger.debug(`Entry '${entryPath}' not found. No entries matching '${basename}' among ${entries.length} entries`);
        }
        throw new Error(`Entry not found in ZIP buffer: ${entryPath}`);
    }
    logger.debug(`Found entry '${entry.fileName}': ${entry.uncompressedSize} bytes`);

    return extractEntryData(zipBuffer, entry);
}

/**
 * List all entries in an in-memory ZIP buffer.
 */
export function listZipEntries(zipBuffer: Buffer): ZipCentralEntry[] {
    const eocd = readEOCDFromBuffer(zipBuffer);
    const cdBytes = zipBuffer.subarray(
        eocd.centralDirectoryOffset,
        eocd.centralDirectoryOffset + eocd.centralDirectorySize,
    );
    return parseZipCentralDirectory(cdBytes);
}

// ── Internal helpers ──

interface BufferEOCD {
    centralDirectoryOffset: number;
    centralDirectorySize: number;
    entryCount: number;
}

function readEOCDFromBuffer(buf: Buffer): BufferEOCD {
    const EOCD_SIG = 0x06054b50;
    const searchStart = Math.max(0, buf.length - 65557);

    for (let i = buf.length - 22; i >= searchStart; i--) {
        if (buf.readUInt32LE(i) === EOCD_SIG) {
            return {
                entryCount: buf.readUInt16LE(i + 10),
                centralDirectorySize: buf.readUInt32LE(i + 12),
                centralDirectoryOffset: buf.readUInt32LE(i + 16),
            };
        }
    }

    throw new Error('ZIP EOCD signature not found in buffer');
}

function extractEntryData(zipBuffer: Buffer, entry: ZipCentralEntry): Buffer {
    const LOCAL_SIG = 0x04034b50;
    const offset = entry.localHeaderOffset;

    if (offset + 30 > zipBuffer.length) {
        throw new Error('Local file header extends beyond buffer');
    }
    if (zipBuffer.readUInt32LE(offset) !== LOCAL_SIG) {
        throw new Error('Invalid local file header signature');
    }

    const localNameLen = zipBuffer.readUInt16LE(offset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(offset + 28);
    const dataStart = offset + 30 + localNameLen + localExtraLen;
    const compressedData = zipBuffer.subarray(
        dataStart,
        dataStart + entry.compressedSize,
    );

    if (entry.compressionMethod === 0) {
        return Buffer.from(compressedData);
    } else if (entry.compressionMethod === 8) {
        return Buffer.from(inflateSync(compressedData));
    } else {
        throw new Error(
            `Unsupported compression method: ${entry.compressionMethod}`,
        );
    }
}
