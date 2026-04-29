import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NUGET_FLAT_CONTAINER, RegistrationVersion } from '../../src/types';

// ── Mock https module (for downloadPackage binary fetches) ──
vi.mock('https', () => ({
    request: vi.fn(),
}));

// ── Mock nuget-registration module ──
vi.mock('../../src/nuget-registration', () => ({
    queryNuGetRegistration: vi.fn(),
}));

const mockRequest = https.request as unknown as ReturnType<typeof vi.fn>;

import { queryNuGetRegistration } from '../../src/nuget-registration';
import {
    resolveVersion,
    getDownloadUrl,
    downloadPackage,
} from '../../src/download/nuget-api';

const mockQueryRegistration = queryNuGetRegistration as ReturnType<typeof vi.fn>;

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

function makeVersion(version: string, listed = true): RegistrationVersion {
    return {
        version,
        listed,
        packageContent: `https://api.nuget.org/v3-flatcontainer/alcops.analyzers/${version.toLowerCase()}/alcops.analyzers.${version.toLowerCase()}.nupkg`,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────
// resolveVersion
// ────────────────────────────────────────────────────────────────
describe('resolveVersion', () => {
    it('returns the last listed stable version for "latest"', async () => {
        mockQueryRegistration.mockResolvedValue([
            makeVersion('0.1.0-beta.1'),
            makeVersion('0.1.0'),
            makeVersion('0.2.0'),
            makeVersion('0.3.0-rc.1'),
        ]);

        const result = await resolveVersion('latest');
        expect(result.version).toBe('0.2.0');
        expect(result.packageContentUrl).toBeDefined();
    });

    it('returns the last listed version (including pre-release) for "prerelease"', async () => {
        mockQueryRegistration.mockResolvedValue([
            makeVersion('0.1.0'),
            makeVersion('0.2.0'),
            makeVersion('0.3.0-rc.1'),
        ]);

        const result = await resolveVersion('prerelease');
        expect(result.version).toBe('0.3.0-rc.1');
    });

    it('returns specific version as-is without querying NuGet', async () => {
        const result = await resolveVersion('1.2.3');
        expect(result.version).toBe('1.2.3');
        expect(result.packageContentUrl).toBeUndefined();
        expect(mockQueryRegistration).not.toHaveBeenCalled();
    });

    it('filters out unlisted versions', async () => {
        mockQueryRegistration.mockResolvedValue([
            makeVersion('0.1.0', true),
            makeVersion('0.2.0', false),  // unlisted
            makeVersion('0.3.0', true),
        ]);

        const result = await resolveVersion('latest');
        expect(result.version).toBe('0.3.0');
    });

    it('throws when no listed versions exist', async () => {
        mockQueryRegistration.mockResolvedValue([
            makeVersion('1.0.0', false),
        ]);

        await expect(resolveVersion('latest')).rejects.toThrow('No listed versions');
    });

    it('throws when no stable versions exist for "latest"', async () => {
        mockQueryRegistration.mockResolvedValue([
            makeVersion('1.0.0-beta.1', true),
        ]);

        await expect(resolveVersion('latest')).rejects.toThrow('No stable versions');
    });

    it('sorts by semver, not lexicographically', async () => {
        mockQueryRegistration.mockResolvedValue([
            makeVersion('0.10.0'),
            makeVersion('0.2.0'),
            makeVersion('0.9.0'),
        ]);

        const result = await resolveVersion('latest');
        expect(result.version).toBe('0.10.0');
    });
});

// ────────────────────────────────────────────────────────────────
// getDownloadUrl
// ────────────────────────────────────────────────────────────────
describe('getDownloadUrl', () => {
    it('formats the V3 Flat Container URL correctly', () => {
        const url = getDownloadUrl('1.2.3');
        expect(url).toBe(
            `${NUGET_FLAT_CONTAINER}/alcops.analyzers/1.2.3/alcops.analyzers.1.2.3.nupkg`,
        );
    });

    it('lowercases the version in the URL', () => {
        const url = getDownloadUrl('1.0.0-Beta.1');
        expect(url).toContain('/1.0.0-beta.1/');
        expect(url).toContain('alcops.analyzers.1.0.0-beta.1.nupkg');
    });
});

// ────────────────────────────────────────────────────────────────
// downloadPackage
// ────────────────────────────────────────────────────────────────
describe('downloadPackage', () => {
    it('downloads and writes the .nupkg to disk', async () => {
        const fakeContent = Buffer.from('PK-fake-nupkg-content');
        enqueueResponse({ statusCode: 200, body: fakeContent });

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuget-api-test-'));
        try {
            const result = await downloadPackage('1.0.0', tmpDir);
            expect(result).toBe(path.join(tmpDir, 'package.nupkg'));
            expect(fs.existsSync(result)).toBe(true);
            expect(fs.readFileSync(result)).toEqual(fakeContent);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('creates the destination directory if it does not exist', async () => {
        const fakeContent = Buffer.from('PK-data');
        enqueueResponse({ statusCode: 200, body: fakeContent });

        const tmpDir = path.join(os.tmpdir(), `nuget-api-test-nested-${Date.now()}`);
        const nestedDir = path.join(tmpDir, 'sub', 'dir');
        try {
            const result = await downloadPackage('2.0.0', nestedDir);
            expect(fs.existsSync(result)).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('uses packageContentUrl when provided', async () => {
        const fakeContent = Buffer.from('PK-content');
        enqueueResponse({ statusCode: 200, body: fakeContent });

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuget-api-test-'));
        const customUrl = 'https://api.nuget.org/v3-flatcontainer/alcops.analyzers/1.0.0/alcops.analyzers.1.0.0.nupkg';
        try {
            await downloadPackage('1.0.0', tmpDir, undefined, customUrl);
            const calledUrl = mockRequest.mock.calls[0][0];
            expect(calledUrl).toBe(customUrl);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('sets User-Agent header', async () => {
        const fakeContent = Buffer.from('PK-content');
        enqueueResponse({ statusCode: 200, body: fakeContent });

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuget-api-test-'));
        try {
            await downloadPackage('1.0.0', tmpDir);
            const calledOpts = mockRequest.mock.calls[0][1] as { headers?: Record<string, string> };
            expect(calledOpts.headers?.['User-Agent']).toMatch(/^ALCops\/\d+\.\d+\.\d+ \(Node\.js v/);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});