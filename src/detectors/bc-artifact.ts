import { TfmDetectionResult } from '../types';
import { getTargetFrameworkFromDotNetVersion } from '../version-threshold';
import { extractRemoteZipEntry } from '../http-range';
import { buildArtifactVariantUrl, downloadFullZip } from '../bc-artifact-url';
import { extractZipEntryFromBuffer } from '../zip-local';
import { detectTfmFromVsixBuffer } from '../vsix-tfm';
import { Logger, nullLogger } from '../logger';

const VSIX_FILENAME = 'ALLanguage.vsix';

interface BCArtifactManifest {
    dotNetVersion?: string;
    platformUrl?: string;
    version?: string;
    [key: string]: unknown;
}

/**
 * Decode a manifest buffer that may be UTF-16 LE (with BOM) or UTF-8.
 * Older BC artifacts (at least 16.0 and 20.0) encode manifest.json as UTF-16 LE.
 */
function decodeManifestBuffer(buffer: Buffer): string {
    // UTF-16 LE BOM: FF FE
    if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
        return buffer.toString('utf16le').replace(/^\uFEFF/, '');
    }
    // UTF-8 (with or without BOM)
    return buffer.toString('utf-8').replace(/^\uFEFF/, '');
}

/**
 * Detect TFM from a BC artifact URL using a fallback chain:
 *
 * - Read `dotNetVersion` from the artifact's manifest.json (fast path)
 * - If unavailable: download the "core" artifact and extract TFM from ALLanguage.vsix
 * - If unavailable: HTTP Range the "platform" artifact to extract TFM from ALLanguage.vsix
 */
export async function detectFromBCArtifact(artifactUrl: string, logger: Logger = nullLogger): Promise<TfmDetectionResult> {
    // Manifest detection (fast path)
    let manifest: BCArtifactManifest = {};
    try {
        logger.info('Reading manifest.json from artifact...');
        const manifestBuffer = await extractRemoteZipEntry(artifactUrl, 'manifest.json', logger);
        manifest = JSON.parse(decodeManifestBuffer(manifestBuffer));

        if (manifest.dotNetVersion) {
            const tfm = getTargetFrameworkFromDotNetVersion(manifest.dotNetVersion);
            logger.info(`Found dotNetVersion=${manifest.dotNetVersion} in manifest → TFM: ${tfm}`);
            return {
                tfm,
                source: 'bc-artifact',
                details: `dotNetVersion=${manifest.dotNetVersion} from ${artifactUrl}`,
            };
        }
        logger.warn('Manifest found but missing dotNetVersion, falling back');
    } catch (err) {
        logger.warn(`Manifest not available (${err instanceof Error ? err.message : err}), falling back`);
    }

    // Fallback: core artifact
    const coreResult = await detectFromCoreArtifact(artifactUrl, logger);
    if (coreResult) {
        return coreResult;
    }

    // Fallback: platform artifact via HTTP Range
    return detectFromPlatformArtifact(artifactUrl, manifest, logger);
}

/**
 * Detect TFM from the "core" artifact variant.
 * Returns null if the core artifact doesn't exist (HTTP error).
 */
async function detectFromCoreArtifact(
    artifactUrl: string,
    logger: Logger = nullLogger,
): Promise<TfmDetectionResult | null> {
    logger.info('Downloading core artifact to extract ALLanguage.vsix...');
    const coreUrl = buildArtifactVariantUrl(artifactUrl, 'core');
    logger.debug(`Core artifact URL: ${coreUrl}`);

    let coreZipBuffer: Buffer;
    try {
        coreZipBuffer = await downloadFullZip(coreUrl, logger);
    } catch {
        logger.warn('Core artifact not available, falling back');
        return null;
    }

    const vsixBuffer = extractZipEntryFromBuffer(coreZipBuffer, VSIX_FILENAME, logger);
    const { tfm, assemblyVersion } = detectTfmFromVsixBuffer(vsixBuffer, logger);

    logger.info(`Detected TFM from core artifact: ${tfm}`);
    return {
        tfm,
        source: 'bc-artifact',
        details: `${assemblyVersion ? `assemblyVersion=${assemblyVersion} from ` : ''}core artifact ${coreUrl}`,
    };
}

/**
 * Detect TFM from the "platform" artifact using HTTP Range requests.
 * Uses `platformUrl` from manifest.json if available, otherwise
 * constructs the URL by replacing the country segment with "platform".
 */
async function detectFromPlatformArtifact(
    artifactUrl: string,
    manifest: BCArtifactManifest,
    logger: Logger = nullLogger,
): Promise<TfmDetectionResult> {
    logger.info('Extracting ALLanguage.vsix from platform artifact via HTTP Range...');
    let platformUrl: string;
    if (manifest.platformUrl) {
        platformUrl = resolvePlatformUrl(artifactUrl, manifest.platformUrl);
    } else {
        platformUrl = buildArtifactVariantUrl(artifactUrl, 'platform');
    }
    logger.debug(`Platform artifact URL: ${platformUrl}`);

    const vsixBuffer = await extractRemoteZipEntry(platformUrl, VSIX_FILENAME, logger);
    const { tfm, assemblyVersion } = detectTfmFromVsixBuffer(vsixBuffer, logger);

    logger.info(`Detected TFM from platform artifact: ${tfm}`);
    return {
        tfm,
        source: 'bc-artifact',
        details: `${assemblyVersion ? `assemblyVersion=${assemblyVersion} from ` : ''}platform artifact ${platformUrl}`,
    };
}

/**
 * Resolve a platformUrl value from manifest.json.
 * If it's already a full URL, use it as-is.
 * If it's a relative path, prepend the host from the artifact URL.
 */
function resolvePlatformUrl(artifactUrl: string, platformUrl: string): string {
    if (platformUrl.startsWith('https://')) {
        return platformUrl;
    }
    const url = new URL(artifactUrl.split('?')[0]);
    return `https://${url.host}/${platformUrl.replace(/^\//, '')}`;
}
