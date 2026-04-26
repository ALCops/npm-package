import * as https from 'https';
import { Logger, nullLogger } from './logger';

export interface ParsedArtifactUrl {
    /** Full original URL (without query string) */
    baseUrl: string;
    /** e.g. "sandbox" or "onprem" */
    type: string;
    /** e.g. "20.0.37253.50766" */
    version: string;
    /** e.g. "w1", "be", "us" */
    country: string;
    /** Query string portion, if any (including leading '?') */
    query: string;
}

/**
 * Parse a BC artifact URL into its components.
 * URL format: https://<host>/<type>/<version>/<country>[?query]
 *
 * The split pattern matches navcontainerhelper's convention:
 *   parts[3] = type, parts[4] = version, parts[5] = country
 */
export function parseArtifactUrl(artifactUrl: string): ParsedArtifactUrl {
    const [urlWithoutQuery, ...queryParts] = artifactUrl.split('?');
    const query = queryParts.length > 0 ? `?${queryParts.join('?')}` : '';
    const parts = urlWithoutQuery.split('/');

    if (parts.length < 6) {
        throw new Error(
            `Invalid BC artifact URL format: expected at least 6 segments, got ${parts.length}. URL: ${artifactUrl}`,
        );
    }

    return {
        baseUrl: urlWithoutQuery,
        type: parts[3],
        version: parts[4],
        country: parts[5],
        query,
    };
}

/**
 * Build a variant artifact URL by replacing the country segment.
 * e.g. buildArtifactVariantUrl("https://host/sandbox/20.0.0.0/w1", "core")
 *   → "https://host/sandbox/20.0.0.0/core"
 */
export function buildArtifactVariantUrl(
    artifactUrl: string,
    variant: string,
): string {
    const parsed = parseArtifactUrl(artifactUrl);
    const parts = parsed.baseUrl.split('/');
    parts[5] = variant;
    return parts.join('/') + parsed.query;
}

/**
 * Download a full ZIP file from a URL into a Buffer.
 * Used for "core" artifacts which are small enough for a full download.
 * Follows redirects (up to 5 hops).
 */
export async function downloadFullZip(url: string, logger: Logger = nullLogger): Promise<Buffer> {
    logger.info(`Downloading ZIP`);
    logger.debug(`URL: ${url}`);
    const buf = await doGet(url, 0, logger);
    logger.debug(`Downloaded ${buf.length} bytes`);
    return buf;
}

// ── Internal helpers ──

function doGet(url: string, redirectCount = 0, logger: Logger = nullLogger): Promise<Buffer> {
    if (redirectCount > 5) {
        return Promise.reject(new Error('Too many redirects'));
    }

    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'GET' }, (res) => {
            if (
                res.statusCode &&
                res.statusCode >= 300 &&
                res.statusCode < 400 &&
                res.headers.location
            ) {
                logger.debug(`Redirect ${res.statusCode} → ${res.headers.location}`);
                resolve(doGet(res.headers.location, redirectCount + 1, logger));
                return;
            }

            if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                res.resume();
                reject(
                    new Error(`HTTP ${res.statusCode} for ${url}`),
                );
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
