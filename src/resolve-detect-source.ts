import { Logger, nullLogger } from './logger';
import { queryNuGetRegistration } from './nuget-registration';
import { queryMarketplace } from './detectors/marketplace';
import { getUserAgent } from './user-agent';
import packageJson from '../package.json';

const DEFAULT_USER_AGENT = getUserAgent('ALCops', packageJson.version);

export type DetectSource = 'bc-artifact' | 'compiler-path' | 'nuget-devtools' | 'marketplace';

export interface ResolvedDetectSource {
    source: DetectSource;
    input: string;
}

/**
 * Classify a raw CLI input string into a detection source using heuristics.
 *
 * - Starts with http:// or https:// → bc-artifact
 * - Exists as a local filesystem path → compiler-path
 * - Channel keyword (latest, prerelease, current) → nuget-devtools (default)
 * - Specific version string → resolved via API (NuGet first, marketplace fallback)
 */
export async function resolveDetectSource(
    input: string,
    logger: Logger = nullLogger,
    userAgent?: string,
): Promise<ResolvedDetectSource> {
    const ua = userAgent ?? DEFAULT_USER_AGENT;

    if (isUrl(input)) {
        logger.debug(`Input classified as URL → bc-artifact`);
        return { source: 'bc-artifact', input };
    }

    if (isChannelKeyword(input)) {
        logger.debug(`Input classified as channel keyword → nuget-devtools`);
        return { source: 'nuget-devtools', input };
    }

    // For version strings, resolve via API calls
    return resolveVersionSource(input, logger, ua);
}

/**
 * Determine whether a version string belongs to NuGet DevTools or VS Marketplace.
 * Queries NuGet registry first (faster), then marketplace as fallback.
 */
export async function resolveVersionSource(
    version: string,
    logger: Logger = nullLogger,
    userAgent?: string,
): Promise<ResolvedDetectSource> {
    const ua = userAgent ?? DEFAULT_USER_AGENT;

    logger.info(`Resolving detection source for version: ${version}`);

    // Try NuGet DevTools first (faster API)
    logger.debug('Checking NuGet DevTools registry...');
    try {
        const devToolsPackage = 'microsoft.dynamics.businesscentral.development.tools';
        const nugetVersions = await queryNuGetRegistration(devToolsPackage, ua, logger);
        const found = nugetVersions.some(
            (v) => v.version.toLowerCase() === version.toLowerCase(),
        );
        if (found) {
            logger.info(`Version '${version}' found in NuGet DevTools`);
            return { source: 'nuget-devtools', input: version };
        }
        logger.debug(`Version '${version}' not found in NuGet DevTools`);
    } catch (err) {
        logger.warn(`NuGet DevTools lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Fallback to VS Marketplace
    logger.debug('Checking VS Marketplace...');
    try {
        const marketplaceVersions = await queryMarketplace(logger);
        const found = marketplaceVersions.some(
            (v) => v.version === version,
        );
        if (found) {
            logger.info(`Version '${version}' found in VS Marketplace`);
            return { source: 'marketplace', input: version };
        }
        logger.debug(`Version '${version}' not found in VS Marketplace`);
    } catch (err) {
        logger.warn(`VS Marketplace lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    throw new Error(
        `Version '${version}' not found in NuGet DevTools or VS Marketplace. ` +
        `Use --detect-from to specify the source explicitly, or use --tfm to skip detection.`,
    );
}

function isUrl(input: string): boolean {
    return input.startsWith('http://') || input.startsWith('https://');
}

const CHANNEL_KEYWORDS = new Set(['latest', 'prerelease', 'current']);

function isChannelKeyword(input: string): boolean {
    return CHANNEL_KEYWORDS.has(input.toLowerCase());
}
