import * as fs from 'fs';
import * as path from 'path';
import { unzipSync } from 'fflate';
import { TargetFramework } from '../types';
import { Logger, nullLogger } from '../logger';

/**
 * Find the best matching TFM folder from available folders for a given target.
 *
 * Matching strategy (ported from VS Code extension's findMatchingLibFolder):
 * 1. Direct match: exact TFM folder exists
 * 2. Net version fallback: for net* targets, try descending versions then netstandard2.1
 * 3. Netstandard upward compat: for netstandard* targets, accept the lowest higher minor version
 */
export function findMatchingTfmFolder(availableFolders: string[], targetTfm: string): string | null {
    if (availableFolders.includes(targetTfm)) {
        return targetTfm;
    }

    if (targetTfm.startsWith('net') && !targetTfm.startsWith('netstandard')) {
        const match = targetTfm.match(/^net(\d+)\.(\d+)$/);
        if (match) {
            const targetMajor = parseInt(match[1]);

            // Try descending net versions (from target+5 down to 6)
            for (let v = targetMajor + 5; v >= 6; v--) {
                const candidate = `net${v}.0`;
                if (availableFolders.includes(candidate)) {
                    return candidate;
                }
            }
        }

        // Fall back to netstandard2.1
        if (availableFolders.includes('netstandard2.1')) {
            return 'netstandard2.1';
        }
    }

    // Netstandard upward compatibility: accept a higher minor version
    if (targetTfm.startsWith('netstandard')) {
        const match = targetTfm.match(/^netstandard(\d+)\.(\d+)$/);
        if (match) {
            const major = parseInt(match[1]);
            const minor = parseInt(match[2]);
            let bestCandidate: string | null = null;
            let bestMinor = Infinity;

            for (const folder of availableFolders) {
                const fm = folder.match(/^netstandard(\d+)\.(\d+)$/);
                if (!fm) { continue; }
                const fMajor = parseInt(fm[1]);
                const fMinor = parseInt(fm[2]);
                if (fMajor === major && fMinor >= minor && fMinor < bestMinor) {
                    bestMinor = fMinor;
                    bestCandidate = folder;
                }
            }

            if (bestCandidate) {
                return bestCandidate;
            }
        }
    }

    return null;
}

/**
 * Extract analyzer DLLs from a .nupkg file for the given TFM.
 * .nupkg is a ZIP. Analyzers are in `lib/{tfm}/*.dll`.
 * Uses TFM compatibility matching to find the best folder.
 * Returns the extraction path, file list, and actual TFM used.
 */
export async function extractAnalyzers(
    nupkgPath: string,
    targetTfm: TargetFramework,
    outputDir: string,
    logger: Logger = nullLogger,
): Promise<{ extractedPath: string; files: string[]; actualTfm: TargetFramework }> {
    logger.info(`Extracting analyzers for TFM: ${targetTfm}`);
    const zipData = fs.readFileSync(nupkgPath);
    const unzipped = unzipSync(new Uint8Array(zipData));

    const libEntries = Object.keys(unzipped).filter(
        (name) => name.startsWith('lib/') && name.endsWith('.dll'),
    );

    const availableFolders = [...new Set(libEntries.map((e) => e.split('/')[1]))];
    logger.debug(`Available TFM folders: ${availableFolders.join(', ')}`);

    const actualTfm = findMatchingTfmFolder(availableFolders, targetTfm);

    if (!actualTfm) {
        throw new Error(
            `No compatible TFM folder found in package. Requested: ${targetTfm}, available: ${availableFolders.join(', ')}`,
        );
    }

    const prefix = `lib/${actualTfm}/`;
    const matchingEntries = libEntries.filter((name) => name.startsWith(prefix));

    if (matchingEntries.length === 0) {
        throw new Error(
            `TFM folder '${actualTfm}' matched but contains no DLLs`,
        );
    }

    if (actualTfm !== targetTfm) {
        logger.warn(`Exact TFM '${targetTfm}' not found in package, using fallback: ${actualTfm}`);
    }

    const extractedPath = outputDir;
    if (!fs.existsSync(extractedPath)) {
        fs.mkdirSync(extractedPath, { recursive: true });
    }

    const files: string[] = [];
    for (const entry of matchingEntries) {
        const fileName = path.basename(entry);
        const destFile = path.join(extractedPath, fileName);
        fs.writeFileSync(destFile, Buffer.from(unzipped[entry]));
        files.push(destFile);
    }

    logger.info(`Extracted ${files.length} analyzer DLLs to ${extractedPath}`);
    return { extractedPath, files, actualTfm };
}
