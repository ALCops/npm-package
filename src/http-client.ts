import * as https from 'https';
import * as zlib from 'zlib';

/**
 * Fetch a URL over HTTPS and return the response body as a Buffer.
 * Handles gzip Content-Encoding transparently.
 * Follows redirects (up to 5 hops).
 */
export function httpsGetBuffer(url: string, userAgent?: string, redirectCount = 0): Promise<Buffer> {
    if (redirectCount > 5) {
        return Promise.reject(new Error('Too many redirects'));
    }

    return new Promise((resolve, reject) => {
        const headers: Record<string, string> = {};
        if (userAgent) {
            headers['User-Agent'] = userAgent;
        }

        const req = https.request(url, { method: 'GET', headers }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                resolve(httpsGetBuffer(res.headers.location, userAgent, redirectCount + 1));
                return;
            }

            if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                return;
            }

            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks);
                const isGzip = res.headers['content-encoding'] === 'gzip';
                resolve(isGzip ? zlib.gunzipSync(raw) : raw);
            });
            res.on('error', reject);
        });

        req.on('error', reject);
        req.end();
    });
}

/**
 * Fetch a URL and parse the response as JSON.
 * Handles gzip Content-Encoding transparently.
 */
export async function httpsGetJson<T>(url: string, userAgent?: string): Promise<T> {
    const buffer = await httpsGetBuffer(url, userAgent);
    return JSON.parse(buffer.toString('utf-8')) as T;
}
