import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as https from 'https';

vi.mock('https');
vi.mock('../../src/http-range', () => ({
    extractRemoteZipEntry: vi.fn(),
}));
vi.mock('../../src/vsix-tfm', () => ({
    detectTfmFromDllBuffer: vi.fn(),
}));

import { extractRemoteZipEntry } from '../../src/http-range';
import { detectTfmFromDllBuffer } from '../../src/vsix-tfm';

const mockRequest = https.request as unknown as ReturnType<typeof vi.fn>;
const mockExtract = vi.mocked(extractRemoteZipEntry);
const mockDetectDll = vi.mocked(detectTfmFromDllBuffer);

// ── Helpers ──

function buildMarketplaceResponse(versions: {
    version: string;
    vsixUrl: string;
    isPreRelease?: boolean;
}[]) {
    return {
        results: [{
            extensions: [{
                versions: versions.map(v => ({
                    version: v.version,
                    files: [
                        { assetType: 'Microsoft.VisualStudio.Services.VSIXPackage', source: v.vsixUrl },
                    ],
                    properties: v.isPreRelease
                        ? [{ key: 'Microsoft.VisualStudio.Code.PreRelease', value: 'true' }]
                        : [],
                })),
            }],
        }],
    };
}

function enqueueMarketplaceResponse(body: object, statusCode = 200) {
    mockRequest.mockImplementationOnce((_url: string, _opts: object, cb: (res: EventEmitter) => void) => {
        const res = new EventEmitter() as EventEmitter & {
            statusCode?: number;
            headers: Record<string, string>;
            resume: () => void;
        };
        res.statusCode = statusCode;
        res.headers = {};
        res.resume = () => {};
        process.nextTick(() => {
            cb(res);
            res.emit('data', Buffer.from(JSON.stringify(body)));
            res.emit('end');
        });
        return { on: vi.fn(), end: vi.fn(), write: vi.fn() };
    });
}

function enqueueErrorResponse(statusCode: number) {
    mockRequest.mockImplementationOnce((_url: string, _opts: object, cb: (res: EventEmitter) => void) => {
        const res = new EventEmitter() as EventEmitter & {
            statusCode?: number;
            headers: Record<string, string>;
            resume: () => void;
        };
        res.statusCode = statusCode;
        res.headers = {};
        res.resume = () => {};
        process.nextTick(() => {
            cb(res);
            res.emit('end');
        });
        return { on: vi.fn(), end: vi.fn(), write: vi.fn() };
    });
}

beforeEach(() => {
    vi.clearAllMocks();
});

// Lazy import so mocks are set up first
async function importModule() {
    // Reset module cache to pick up fresh mocks
    const mod = await import('../../src/detectors/marketplace');
    return mod;
}

describe('queryMarketplace', () => {
    it('returns parsed versions with VSIX URLs and pre-release flags', async () => {
        const response = buildMarketplaceResponse([
            { version: '15.0.100.0', vsixUrl: 'https://example.com/stable.vsix' },
            { version: '16.0.200.0', vsixUrl: 'https://example.com/prerelease.vsix', isPreRelease: true },
        ]);
        enqueueMarketplaceResponse(response);

        const { queryMarketplace } = await importModule();
        const versions = await queryMarketplace();

        expect(versions).toHaveLength(2);
        expect(versions[0]).toEqual({
            version: '15.0.100.0',
            vsixUrl: 'https://example.com/stable.vsix',
            isPreRelease: false,
        });
        expect(versions[1]).toEqual({
            version: '16.0.200.0',
            vsixUrl: 'https://example.com/prerelease.vsix',
            isPreRelease: true,
        });
    });

    it('throws when API returns non-200 status', async () => {
        enqueueErrorResponse(500);

        const { queryMarketplace } = await importModule();
        await expect(queryMarketplace()).rejects.toThrow();
    });

    it('throws when no extensions found in response', async () => {
        enqueueMarketplaceResponse({ results: [{ extensions: [] }] });

        const { queryMarketplace } = await importModule();
        await expect(queryMarketplace()).rejects.toThrow('AL Language extension not found');
    });
});

describe('resolveExtensionVersion', () => {
    it('"current" returns latest stable version', async () => {
        const response = buildMarketplaceResponse([
            { version: '15.0.100.0', vsixUrl: 'https://example.com/v15.vsix' },
            { version: '16.0.200.0', vsixUrl: 'https://example.com/v16pre.vsix', isPreRelease: true },
            { version: '14.0.50.0', vsixUrl: 'https://example.com/v14.vsix' },
        ]);
        enqueueMarketplaceResponse(response);

        const { resolveExtensionVersion } = await importModule();
        const result = await resolveExtensionVersion('current');

        expect(result.version).toBe('15.0.100.0');
        expect(result.isPreRelease).toBe(false);
    });

    it('"prerelease" returns latest pre-release version', async () => {
        const response = buildMarketplaceResponse([
            { version: '15.0.100.0', vsixUrl: 'https://example.com/v15.vsix' },
            { version: '16.0.200.0', vsixUrl: 'https://example.com/v16pre.vsix', isPreRelease: true },
        ]);
        enqueueMarketplaceResponse(response);

        const { resolveExtensionVersion } = await importModule();
        const result = await resolveExtensionVersion('prerelease');

        expect(result.version).toBe('16.0.200.0');
        expect(result.isPreRelease).toBe(true);
    });

    it('"prerelease" falls back to latest stable if no pre-release exists', async () => {
        const response = buildMarketplaceResponse([
            { version: '15.0.100.0', vsixUrl: 'https://example.com/v15.vsix' },
            { version: '14.0.50.0', vsixUrl: 'https://example.com/v14.vsix' },
        ]);
        enqueueMarketplaceResponse(response);

        const { resolveExtensionVersion } = await importModule();
        const result = await resolveExtensionVersion('prerelease');

        expect(result.version).toBe('15.0.100.0');
        expect(result.isPreRelease).toBe(false);
    });

    it('specific version string returns that exact version', async () => {
        const response = buildMarketplaceResponse([
            { version: '15.0.100.0', vsixUrl: 'https://example.com/v15.vsix' },
            { version: '14.0.50.0', vsixUrl: 'https://example.com/v14.vsix' },
        ]);
        enqueueMarketplaceResponse(response);

        const { resolveExtensionVersion } = await importModule();
        const result = await resolveExtensionVersion('14.0.50.0');

        expect(result.version).toBe('14.0.50.0');
        expect(result.vsixUrl).toBe('https://example.com/v14.vsix');
    });

    it('throws when specific version is not found', async () => {
        const response = buildMarketplaceResponse([
            { version: '15.0.100.0', vsixUrl: 'https://example.com/v15.vsix' },
        ]);
        enqueueMarketplaceResponse(response);

        const { resolveExtensionVersion } = await importModule();
        await expect(resolveExtensionVersion('99.0.0.0')).rejects.toThrow('Version 99.0.0.0 not found');
    });
});

describe('detectFromMarketplace', () => {
    it('detects TFM through full chain: marketplace → HTTP Range → DLL → TFM', async () => {
        const response = buildMarketplaceResponse([
            { version: '15.0.100.0', vsixUrl: 'https://example.com/al.vsix' },
        ]);
        enqueueMarketplaceResponse(response);
        mockExtract.mockResolvedValue(Buffer.from('fake-dll'));
        mockDetectDll.mockReturnValue({ tfm: 'net8.0', assemblyVersion: '17.0.0.0' });

        const { detectFromMarketplace } = await importModule();
        const result = await detectFromMarketplace('current');

        expect(result.tfm).toBe('net8.0');
        expect(result.extensionVersion).toBe('15.0.100.0');
        expect(result.assemblyVersion).toBe('17.0.0.0');
        expect(result.source).toBe('vs-marketplace');
        expect(mockExtract).toHaveBeenCalledWith(
            'https://example.com/al.vsix',
            'extension/bin/Analyzers/Microsoft.Dynamics.Nav.CodeAnalysis.dll',
            expect.any(Object),
        );
        expect(mockDetectDll).toHaveBeenCalledWith(Buffer.from('fake-dll'), expect.any(Object));
    });

    it('detects netstandard2.1 for older assembly versions', async () => {
        const response = buildMarketplaceResponse([
            { version: '14.0.50.0', vsixUrl: 'https://example.com/old.vsix' },
        ]);
        enqueueMarketplaceResponse(response);
        mockExtract.mockResolvedValue(Buffer.from('fake-dll'));
        mockDetectDll.mockReturnValue({ tfm: 'netstandard2.1', assemblyVersion: '14.0.0.0' });

        const { detectFromMarketplace } = await importModule();
        const result = await detectFromMarketplace('current');

        expect(result.tfm).toBe('netstandard2.1');
        expect(result.assemblyVersion).toBe('14.0.0.0');
    });

    it('throws when VSIX TFM detection fails', async () => {
        const response = buildMarketplaceResponse([
            { version: '15.0.100.0', vsixUrl: 'https://example.com/al.vsix' },
        ]);
        enqueueMarketplaceResponse(response);
        mockExtract.mockResolvedValue(Buffer.from('fake-dll'));
        mockDetectDll.mockImplementation(() => {
            throw new Error('Could not detect target framework from CodeAnalysis DLL');
        });

        const { detectFromMarketplace } = await importModule();
        await expect(detectFromMarketplace('current')).rejects.toThrow('Could not detect target framework');
    });

    it('handles null assemblyVersion', async () => {
        const response = buildMarketplaceResponse([
            { version: '15.0.100.0', vsixUrl: 'https://example.com/al.vsix' },
        ]);
        enqueueMarketplaceResponse(response);
        mockExtract.mockResolvedValue(Buffer.from('fake-dll'));
        mockDetectDll.mockReturnValue({ tfm: 'net8.0', assemblyVersion: null });

        const { detectFromMarketplace } = await importModule();
        const result = await detectFromMarketplace('current');

        expect(result.tfm).toBe('net8.0');
        expect(result.assemblyVersion).toBeNull();
        expect(result.details).not.toContain('assemblyVersion');
    });
});
