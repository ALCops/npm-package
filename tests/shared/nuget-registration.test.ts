import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as https from 'https';
import * as zlib from 'zlib';

// ── Mock https module ──
vi.mock('https', () => ({
    request: vi.fn(),
}));

const mockRequest = https.request as unknown as ReturnType<typeof vi.fn>;

import { parseRegistrationIndex, queryNuGetRegistration } from '../../src/nuget-registration';
import { RegistrationIndex, NUGET_REGISTRATION_BASE } from '../../src/types';

// ── Helpers ──

interface MockResponseOptions {
    statusCode?: number;
    headers?: Record<string, string>;
    body?: Buffer;
}

function enqueueResponse(opts: MockResponseOptions) {
    mockRequest.mockImplementationOnce(
        (_url: string, _reqOpts: unknown, cb: (res: EventEmitter & { statusCode?: number; headers: Record<string, string> }) => void) => {
            const res = new EventEmitter() as EventEmitter & {
                statusCode?: number;
                headers: Record<string, string>;
                resume: () => void;
            };
            res.statusCode = opts.statusCode ?? 200;
            res.headers = opts.headers ?? {};
            res.resume = () => {};

            process.nextTick(() => {
                cb(res);
                if (opts.body) {
                    res.emit('data', opts.body);
                }
                res.emit('end');
            });

            const req = new EventEmitter();
            (req as EventEmitter & { end: () => void }).end = () => {};
            return req;
        },
    );
}

function gzipBuffer(data: object): Buffer {
    return zlib.gzipSync(Buffer.from(JSON.stringify(data), 'utf-8'));
}

function enqueueGzipResponse(data: object) {
    enqueueResponse({
        statusCode: 200,
        headers: { 'content-encoding': 'gzip' },
        body: gzipBuffer(data),
    });
}

beforeEach(() => {
    vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────
// parseRegistrationIndex (pure function, no HTTP)
// ────────────────────────────────────────────────────────────────
describe('parseRegistrationIndex', () => {
    it('extracts versions from inlined page items', () => {
        const index: RegistrationIndex = {
            items: [{
                '@id': 'https://example.com/page',
                items: [
                    {
                        catalogEntry: { version: '1.0.0', listed: true },
                        packageContent: 'https://cdn.example.com/pkg/1.0.0.nupkg',
                    },
                    {
                        catalogEntry: { version: '2.0.0', listed: false },
                        packageContent: 'https://cdn.example.com/pkg/2.0.0.nupkg',
                    },
                ],
            }],
        };

        const result = parseRegistrationIndex(index);
        expect(result).toEqual([
            { version: '1.0.0', listed: true, packageContent: 'https://cdn.example.com/pkg/1.0.0.nupkg' },
            { version: '2.0.0', listed: false, packageContent: 'https://cdn.example.com/pkg/2.0.0.nupkg' },
        ]);
    });

    it('defaults listed to true when field is absent', () => {
        const index: RegistrationIndex = {
            items: [{
                '@id': 'https://example.com/page',
                items: [{
                    catalogEntry: { version: '1.0.0' },
                    packageContent: 'https://cdn.example.com/pkg/1.0.0.nupkg',
                }],
            }],
        };

        const result = parseRegistrationIndex(index);
        expect(result[0].listed).toBe(true);
    });

    it('handles multiple pages', () => {
        const index: RegistrationIndex = {
            items: [
                {
                    '@id': 'https://example.com/page/0',
                    items: [{
                        catalogEntry: { version: '1.0.0', listed: true },
                        packageContent: 'https://cdn.example.com/pkg/1.0.0.nupkg',
                    }],
                },
                {
                    '@id': 'https://example.com/page/1',
                    items: [{
                        catalogEntry: { version: '2.0.0', listed: true },
                        packageContent: 'https://cdn.example.com/pkg/2.0.0.nupkg',
                    }],
                },
            ],
        };

        const result = parseRegistrationIndex(index);
        expect(result).toHaveLength(2);
        expect(result[0].version).toBe('1.0.0');
        expect(result[1].version).toBe('2.0.0');
    });

    it('skips pages without inlined items', () => {
        const index: RegistrationIndex = {
            items: [
                {
                    '@id': 'https://example.com/page/0',
                    items: [{
                        catalogEntry: { version: '1.0.0', listed: true },
                        packageContent: 'https://cdn.example.com/pkg/1.0.0.nupkg',
                    }],
                },
                {
                    '@id': 'https://example.com/page/1',
                    // no items (external page, not yet resolved)
                },
            ],
        };

        const result = parseRegistrationIndex(index);
        expect(result).toHaveLength(1);
        expect(result[0].version).toBe('1.0.0');
    });

    it('returns empty array for empty index', () => {
        const index: RegistrationIndex = { items: [] };
        expect(parseRegistrationIndex(index)).toEqual([]);
    });

    it('returns empty array when all pages lack items', () => {
        const index: RegistrationIndex = {
            items: [{ '@id': 'https://example.com/page/0' }],
        };
        expect(parseRegistrationIndex(index)).toEqual([]);
    });
});

// ────────────────────────────────────────────────────────────────
// queryNuGetRegistration (HTTP integration with mocked https)
// ────────────────────────────────────────────────────────────────
describe('queryNuGetRegistration', () => {
    it('returns versions from a fully-inlined index', async () => {
        const indexData: RegistrationIndex = {
            items: [{
                '@id': 'https://example.com/page',
                items: [
                    {
                        catalogEntry: { version: '1.0.0', listed: true },
                        packageContent: 'https://cdn.example.com/pkg/1.0.0.nupkg',
                    },
                ],
            }],
        };

        enqueueGzipResponse(indexData);

        const result = await queryNuGetRegistration('TestPackage', 'TestAgent/1.0');
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            version: '1.0.0',
            listed: true,
            packageContent: 'https://cdn.example.com/pkg/1.0.0.nupkg',
        });
    });

    it('lowercases the package ID in the registration URL', async () => {
        const indexData: RegistrationIndex = { items: [{ '@id': 'https://example.com/page', items: [] }] };
        enqueueGzipResponse(indexData);

        await queryNuGetRegistration('MyPackage.Name', 'TestAgent/1.0');

        const calledUrl = mockRequest.mock.calls[0][0];
        expect(calledUrl).toBe(`${NUGET_REGISTRATION_BASE}/mypackage.name/index.json`);
    });

    it('passes User-Agent header', async () => {
        const indexData: RegistrationIndex = { items: [{ '@id': 'https://example.com/page', items: [] }] };
        enqueueGzipResponse(indexData);

        await queryNuGetRegistration('Pkg', 'MyClient/2.0');

        const calledOpts = mockRequest.mock.calls[0][1] as { headers?: Record<string, string> };
        expect(calledOpts.headers?.['User-Agent']).toBe('MyClient/2.0');
    });

    it('fetches external pages and merges results', async () => {
        const indexData = {
            items: [{
                '@id': 'https://api.nuget.org/v3/registration5-gz-semver2/pkg/page/1.0.0/2.0.0.json',
                // no items = external page
            }],
        };

        const pageData = {
            '@id': 'https://api.nuget.org/v3/registration5-gz-semver2/pkg/page/1.0.0/2.0.0.json',
            items: [
                {
                    catalogEntry: { version: '1.0.0', listed: true },
                    packageContent: 'https://cdn.example.com/pkg/1.0.0.nupkg',
                },
                {
                    catalogEntry: { version: '2.0.0', listed: false },
                    packageContent: 'https://cdn.example.com/pkg/2.0.0.nupkg',
                },
            ],
        };

        // First call: index
        enqueueGzipResponse(indexData);
        // Second call: external page
        enqueueGzipResponse(pageData);

        const result = await queryNuGetRegistration('Pkg');
        expect(result).toHaveLength(2);
        expect(result[0].version).toBe('1.0.0');
        expect(result[1].version).toBe('2.0.0');
        expect(result[1].listed).toBe(false);
    });

    it('handles mix of inlined and external pages', async () => {
        const indexData = {
            items: [
                {
                    '@id': 'https://example.com/page/0',
                    items: [{
                        catalogEntry: { version: '1.0.0', listed: true },
                        packageContent: 'https://cdn.example.com/1.0.0.nupkg',
                    }],
                },
                {
                    '@id': 'https://example.com/page/1',
                    // external
                },
            ],
        };

        const externalPage = {
            '@id': 'https://example.com/page/1',
            items: [{
                catalogEntry: { version: '2.0.0', listed: true },
                packageContent: 'https://cdn.example.com/2.0.0.nupkg',
            }],
        };

        enqueueGzipResponse(indexData);
        enqueueGzipResponse(externalPage);

        const result = await queryNuGetRegistration('Pkg');
        expect(result).toHaveLength(2);
        expect(result.map((v) => v.version)).toEqual(['1.0.0', '2.0.0']);
    });

    it('handles non-gzip responses', async () => {
        const indexData: RegistrationIndex = {
            items: [{
                '@id': 'https://example.com/page',
                items: [{
                    catalogEntry: { version: '1.0.0', listed: true },
                    packageContent: 'https://cdn.example.com/1.0.0.nupkg',
                }],
            }],
        };

        // No gzip
        enqueueResponse({
            statusCode: 200,
            body: Buffer.from(JSON.stringify(indexData)),
        });

        const result = await queryNuGetRegistration('Pkg');
        expect(result).toHaveLength(1);
    });

    it('rejects on non-200 status code', async () => {
        enqueueResponse({ statusCode: 404 });

        await expect(queryNuGetRegistration('NonExistent')).rejects.toThrow('HTTP 404');
    });
});
