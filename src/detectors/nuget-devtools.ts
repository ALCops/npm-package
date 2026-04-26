import * as https from 'https';
import { TfmDetectionResult, TFM_PREFERENCE, NUGET_FLAT_CONTAINER } from '../types';
import { readZipEOCD, fetchRange, parseZipCentralDirectory, extractRemoteZipCentralEntry, ZipCentralEntry } from '../http-range';
import { detectTfmFromBuffer } from '../binary-tfm';
import { Logger, nullLogger } from '../logger';

const DEVTOOLS_PACKAGE = 'microsoft.dynamics.businesscentral.development.tools';
const CODE_ANALYSIS_DLL = 'Microsoft.Dynamics.Nav.CodeAnalysis.dll';

/**
 * Fetch JSON from a URL, following redirects up to maxRedirects.
 */
function fetchJson(url: string, maxRedirects = 5): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (
                res.statusCode &&
                res.statusCode >= 300 &&
                res.statusCode < 400 &&
                res.headers.location
            ) {
                if (maxRedirects <= 0) {
                    reject(new Error('Too many redirects'));
                    return;
                }
                fetchJson(res.headers.location, maxRedirects - 1).then(resolve, reject);
                return;
            }
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
                } catch {
                    reject(new Error(`Invalid JSON from ${url}`));
                }
            });
            res.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Resolve the DevTools version: 'latest', 'prerelease', or specific.
 */
export async function resolveDevToolsVersion(requested: string, logger: Logger = nullLogger): Promise<string> {
    if (requested !== 'latest' && requested !== 'prerelease') {
        logger.info(`Using specified DevTools version: ${requested}`);
        return requested;
    }
    logger.info(`Resolving DevTools version: '${requested}'`);
    const url = `${NUGET_FLAT_CONTAINER}/${DEVTOOLS_PACKAGE}/index.json`;
    logger.debug(`NuGet index URL: ${url}`);
    const data = await fetchJson(url);
    const versions = data.versions as string[];
    if (requested === 'latest') {
        const stable = versions.filter((v) => !v.includes('-'));
        const resolved = stable[stable.length - 1];
        logger.info(`Resolved to: ${resolved}`);
        return resolved;
    }
    const resolved = versions[versions.length - 1];
    logger.info(`Resolved to: ${resolved}`);
    return resolved;
}

/**
 * Select the best CodeAnalysis DLL entry from central directory entries.
 * Entries are in `lib/{tfm}/Microsoft.Dynamics.Nav.CodeAnalysis.dll` format.
 * Returns the entry whose TFM is highest in TFM_PREFERENCE order.
 */
export function selectBestDllEntry(entries: ZipCentralEntry[]): ZipCentralEntry | undefined {
    const dllEntries = entries.filter(
        (e) => e.fileName.endsWith(`/${CODE_ANALYSIS_DLL}`) || e.fileName.endsWith(`\\${CODE_ANALYSIS_DLL}`),
    );

    if (dllEntries.length === 0) {
        return undefined;
    }

    // Parse TFM from path and sort by preference
    const ranked = dllEntries
        .map((entry) => {
            const parts = entry.fileName.replace(/\\/g, '/').split('/');
            // Expected: lib/{tfm}/filename.dll
            const tfm = parts.length >= 3 ? parts[parts.length - 2] : null;
            const preferenceIndex = tfm ? TFM_PREFERENCE.indexOf(tfm) : -1;
            return { entry, tfm, preferenceIndex };
        })
        .filter((r) => r.tfm !== null)
        .sort((a, b) => {
            // Prefer entries that appear in TFM_PREFERENCE (lower index = more preferred)
            if (a.preferenceIndex >= 0 && b.preferenceIndex >= 0) {
                return a.preferenceIndex - b.preferenceIndex;
            }
            if (a.preferenceIndex >= 0) return -1;
            if (b.preferenceIndex >= 0) return 1;
            return 0;
        });

    return ranked.length > 0 ? ranked[0].entry : dllEntries[0];
}

/**
 * Detect TFM from a NuGet DevTools package.
 * Extracts the CodeAnalysis DLL via HTTP Range requests and reads TFM from the binary.
 */
export async function detectFromNuGetDevTools(version: string, logger: Logger = nullLogger): Promise<TfmDetectionResult> {
    const resolved = await resolveDevToolsVersion(version, logger);

    const nupkgUrl = `${NUGET_FLAT_CONTAINER}/${DEVTOOLS_PACKAGE}/${resolved}/${DEVTOOLS_PACKAGE}.${resolved}.nupkg`;
    logger.info(`Reading NuGet package: ${nupkgUrl}`);

    // Read central directory via HTTP Range requests
    const eocd = await readZipEOCD(nupkgUrl, logger);
    const cdBytes = await fetchRange(
        nupkgUrl,
        eocd.centralDirectoryOffset,
        eocd.centralDirectoryOffset + eocd.centralDirectorySize - 1,
        logger,
    );
    const entries = parseZipCentralDirectory(cdBytes);
    logger.debug(`Package contains ${entries.length} entries`);

    // Find the best CodeAnalysis DLL entry
    const bestEntry = selectBestDllEntry(entries);
    if (!bestEntry) {
        throw new Error(`${CODE_ANALYSIS_DLL} not found in NuGet package`);
    }
    logger.info(`Selected DLL entry: ${bestEntry.fileName}`);

    // Extract and binary search for TFM
    const dllBuffer = await extractRemoteZipCentralEntry(nupkgUrl, bestEntry, logger);
    const tfm = detectTfmFromBuffer(dllBuffer);
    if (!tfm) {
        throw new Error(`Could not detect TFM from ${bestEntry.fileName}`);
    }

    logger.info(`Detected TFM: ${tfm} (from DevTools ${resolved})`);
    return {
        tfm,
        source: 'nuget-devtools',
        details: `DevTools ${resolved} → ${bestEntry.fileName}`,
    };
}
