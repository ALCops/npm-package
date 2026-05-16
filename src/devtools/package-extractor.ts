import * as fs from 'fs';
import * as path from 'path';
import { unzipSync } from 'fflate';
import { Logger, nullLogger } from '../logger';

export interface ExtractOptions {
    /** Raw ZIP/nupkg/vsix buffer */
    zipBuffer: Buffer;
    /** Path prefix to match inside the archive (e.g. 'tools/net8.0/any/') */
    pathPrefix: string;
    /** Output directory to write extracted files */
    outputDir: string;
    /** Optional glob pattern to filter filenames (simple *.ext matching) */
    includePattern?: string;
    logger?: Logger;
}

export interface ExtractResult {
    outputDir: string;
    files: string[];
    fileCount: number;
}

/**
 * Extract files from an in-memory ZIP buffer that match a given path prefix.
 * Writes matched files flat into the output directory (preserving subdirectory structure
 * relative to the prefix).
 */
export function extractFromBuffer(options: ExtractOptions): ExtractResult {
    const { zipBuffer, pathPrefix, outputDir, includePattern, logger = nullLogger } = options;

    const normalized = normalizePrefixPath(pathPrefix);
    logger.debug(`Extracting files with prefix '${normalized}' to ${outputDir}`);

    const unzipped = unzipSync(new Uint8Array(zipBuffer));
    const allEntries = Object.keys(unzipped);
    logger.debug(`Archive contains ${allEntries.length} entries`);

    const matchingEntries = allEntries.filter((entry) => {
        const normalizedEntry = entry.replace(/\\/g, '/');
        if (!normalizedEntry.startsWith(normalized)) return false;
        // Skip directory entries (trailing slash or empty name after prefix)
        const relativePath = normalizedEntry.slice(normalized.length);
        if (relativePath.length === 0 || relativePath.endsWith('/')) return false;
        // Apply include filter if specified
        if (includePattern) {
            const fileName = relativePath.split('/').pop()!;
            if (!matchesGlob(fileName, includePattern)) return false;
        }
        return true;
    });

    if (matchingEntries.length === 0) {
        const prefixEntries = allEntries
            .filter((e) => e.replace(/\\/g, '/').startsWith(normalized.split('/')[0] + '/'))
            .slice(0, 10);
        logger.debug(`No entries match prefix '${normalized}'. Sample entries under '${normalized.split('/')[0]}/': ${prefixEntries.join(', ')}`);
        throw new Error(
            `No files found matching prefix '${pathPrefix}' in archive. ` +
            `Archive has ${allEntries.length} entries total.`,
        );
    }

    logger.info(`Found ${matchingEntries.length} files to extract`);

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const files: string[] = [];
    for (const entry of matchingEntries) {
        const normalizedEntry = entry.replace(/\\/g, '/');
        const relativePath = normalizedEntry.slice(normalized.length);

        const destPath = path.join(outputDir, ...relativePath.split('/'));
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        fs.writeFileSync(destPath, Buffer.from(unzipped[entry]));
        files.push(destPath);
    }

    logger.info(`Extracted ${files.length} files to ${outputDir}`);
    return { outputDir: path.resolve(outputDir), files, fileCount: files.length };
}

/**
 * Normalize a path prefix: forward slashes, ensure trailing slash.
 */
function normalizePrefixPath(prefix: string): string {
    let p = prefix.replace(/\\/g, '/');
    if (p.length > 0 && !p.endsWith('/')) {
        p += '/';
    }
    return p;
}

/**
 * Simple glob matching for filename patterns.
 * Supports: *.ext, prefix*, *suffix, exact match.
 * For v1, this covers the common cases without pulling in a dependency.
 */
export function matchesGlob(filename: string, pattern: string): boolean {
    if (pattern === '*') return true;

    // Convert glob to regex: escape special chars, replace * with .*
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');

    return new RegExp(`^${escaped}$`, 'i').test(filename);
}
