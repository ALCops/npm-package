import * as https from 'https';
import { TfmDetectionResult, VS_MARKETPLACE_API, AL_EXTENSION_ID, VSIX_DLL_PATH } from '../types';
import { extractRemoteZipEntry } from '../http-range';
import { detectTfmFromDllBuffer } from '../vsix-tfm';
import { Logger, nullLogger } from '../logger';

interface MarketplaceVersion {
    version: string;
    vsixUrl: string;
    isPreRelease: boolean;
}

interface MarketplaceApiResponse {
    results: Array<{
        extensions: Array<{
            versions: Array<{
                version: string;
                files?: Array<{ assetType: string; source: string }>;
                properties?: Array<{ key: string; value: string }>;
            }>;
        }>;
    }>;
}

/**
 * Query VS Marketplace for AL Language extension versions.
 */
export async function queryMarketplace(logger: Logger = nullLogger): Promise<MarketplaceVersion[]> {
    logger.info('Querying VS Marketplace for AL Language extension...');
    const body = JSON.stringify({
        filters: [{
            criteria: [
                { filterType: 7, value: AL_EXTENSION_ID },
                { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
                { filterType: 12, value: '4096' },
            ],
        }],
        assetTypes: ['Microsoft.VisualStudio.Services.VSIXPackage'],
        flags: 147,
    });

    const responseData = await postJson(VS_MARKETPLACE_API, body);
    const extensions = responseData?.results?.[0]?.extensions;
    if (!extensions || extensions.length === 0) {
        throw new Error('AL Language extension not found on VS Marketplace');
    }

    const versions: MarketplaceVersion[] = [];
    for (const v of extensions[0].versions) {
        const vsixFile = v.files?.find(
            (f) => f.assetType === 'Microsoft.VisualStudio.Services.VSIXPackage',
        );
        if (!vsixFile) continue;

        const isPreRelease = v.properties?.some(
            (p) => p.key === 'Microsoft.VisualStudio.Code.PreRelease' && p.value === 'true',
        ) ?? false;

        versions.push({
            version: v.version,
            vsixUrl: vsixFile.source,
            isPreRelease,
        });
    }

    logger.debug(`Found ${versions.length} extension versions`);
    return versions;
}

/**
 * Resolve which version to use based on channel.
 * 'current' → latest stable
 * 'prerelease' → latest pre-release (or stable if no pre-release)
 * specific version string → that exact version
 */
export async function resolveExtensionVersion(channel: string, logger: Logger = nullLogger): Promise<MarketplaceVersion> {
    const versions = await queryMarketplace(logger);

    if (channel === 'current') {
        const stable = versions.find(v => !v.isPreRelease);
        if (!stable) throw new Error('No stable version found');
        logger.info(`Resolved extension version: ${stable.version}`);
        return stable;
    }

    if (channel === 'prerelease') {
        const preRelease = versions.find(v => v.isPreRelease);
        if (preRelease) {
            logger.info(`Resolved extension version: ${preRelease.version} (pre-release)`);
            return preRelease;
        }
        // Fall back to latest stable
        const stable = versions.find(v => !v.isPreRelease);
        if (!stable) throw new Error('No versions found');
        logger.warn('No pre-release version found, falling back to latest stable');
        logger.info(`Resolved extension version: ${stable.version}`);
        return stable;
    }

    // Specific version
    const exact = versions.find(v => v.version === channel);
    if (!exact) throw new Error(`Version ${channel} not found on VS Marketplace`);
    logger.info(`Resolved extension version: ${exact.version}`);
    return exact;
}

/**
 * Detect TFM from the VS Marketplace AL Language extension.
 */
export async function detectFromMarketplace(
    channel: string,
    logger: Logger = nullLogger,
): Promise<TfmDetectionResult & { extensionVersion: string; assemblyVersion: string | null }> {
    const resolved = await resolveExtensionVersion(channel, logger);
    logger.info('Extracting CodeAnalysis DLL from VSIX...');
    logger.debug(`VSIX URL: ${resolved.vsixUrl}`);
    const dllBuffer = await extractRemoteZipEntry(resolved.vsixUrl, VSIX_DLL_PATH, logger);
    const { tfm, assemblyVersion } = detectTfmFromDllBuffer(dllBuffer, logger);

    return {
        tfm,
        source: 'vs-marketplace',
        details: `extensionVersion=${resolved.version}${assemblyVersion ? `, assemblyVersion=${assemblyVersion}` : ''}`,
        extensionVersion: resolved.version,
        assemblyVersion,
    };
}

// ── Internal helpers ──

function postJson(url: string, body: string): Promise<MarketplaceApiResponse> {
    return new Promise((resolve, reject) => {
        const req = https.request(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json;api-version=3.0-preview.1',
                    'Content-Length': Buffer.byteLength(body).toString(),
                },
            },
            (res) => {
                if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                    res.resume();
                    reject(new Error(`HTTP ${res.statusCode} from VS Marketplace API`));
                    return;
                }

                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    try {
                        const text = Buffer.concat(chunks).toString('utf-8');
                        resolve(JSON.parse(text));
                    } catch {
                        reject(new Error('Failed to parse VS Marketplace API response'));
                    }
                });
                res.on('error', reject);
            },
        );

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
