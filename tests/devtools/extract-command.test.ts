import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies to avoid network calls
vi.mock('../../src/detectors/nuget-devtools', () => ({
    resolveDevToolsVersion: vi.fn(),
}));

vi.mock('../../src/detectors/marketplace', () => ({
    resolveExtensionVersion: vi.fn(),
}));

vi.mock('../../src/http-client', () => ({
    httpsGetBuffer: vi.fn(),
}));

vi.mock('../../src/devtools/package-extractor', () => ({
    extractFromBuffer: vi.fn(),
}));

import { resolveDevToolsVersion } from '../../src/detectors/nuget-devtools';
import { resolveExtensionVersion } from '../../src/detectors/marketplace';
import { httpsGetBuffer } from '../../src/http-client';
import { extractFromBuffer } from '../../src/devtools/package-extractor';
import { executeDevToolsExtract } from '../../src/devtools/extract-command';

const mockResolveDevTools = resolveDevToolsVersion as ReturnType<typeof vi.fn>;
const mockResolveExtension = resolveExtensionVersion as ReturnType<typeof vi.fn>;
const mockHttpsGet = httpsGetBuffer as ReturnType<typeof vi.fn>;
const mockExtract = extractFromBuffer as ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.resetAllMocks();
});

describe('executeDevToolsExtract', () => {
    describe('nuget source', () => {
        it('throws when tfm is not provided', async () => {
            await expect(
                executeDevToolsExtract({
                    source: 'nuget',
                    version: 'latest',
                    outputDir: '/tmp/out',
                }),
            ).rejects.toThrow('--tfm is required');
        });

        it('downloads and extracts NuGet package with correct prefix', async () => {
            mockResolveDevTools.mockResolvedValue('26.1.30873');
            mockHttpsGet.mockResolvedValue(Buffer.from('fake-zip'));
            mockExtract.mockReturnValue({
                outputDir: '/tmp/out',
                files: ['/tmp/out/foo.dll'],
                fileCount: 1,
            });

            const result = await executeDevToolsExtract({
                source: 'nuget',
                version: 'latest',
                tfm: 'net8.0',
                outputDir: '/tmp/out',
            });

            expect(mockResolveDevTools).toHaveBeenCalledWith('latest', expect.anything());
            expect(mockHttpsGet).toHaveBeenCalledWith(
                expect.stringContaining('microsoft.dynamics.businesscentral.development.tools'),
                expect.any(String),
            );
            expect(mockExtract).toHaveBeenCalledWith(
                expect.objectContaining({
                    pathPrefix: 'tools/net8.0/any',
                    outputDir: '/tmp/out',
                }),
            );
            expect(result.source).toBe('nuget');
            expect(result.version).toBe('26.1.30873');
            expect(result.tfm).toBe('net8.0');
        });

        it('passes include pattern through to extractor', async () => {
            mockResolveDevTools.mockResolvedValue('26.1.30873');
            mockHttpsGet.mockResolvedValue(Buffer.from('fake-zip'));
            mockExtract.mockReturnValue({
                outputDir: '/tmp/out',
                files: [],
                fileCount: 0,
            });

            await executeDevToolsExtract({
                source: 'nuget',
                version: 'latest',
                tfm: 'net8.0',
                outputDir: '/tmp/out',
                includePattern: '*.dll',
            });

            expect(mockExtract).toHaveBeenCalledWith(
                expect.objectContaining({
                    includePattern: '*.dll',
                }),
            );
        });
    });

    describe('vsix source', () => {
        it('downloads and extracts VSIX with correct prefix', async () => {
            mockResolveExtension.mockResolvedValue({
                version: '14.0.1234',
                vsixUrl: 'https://marketplace.example.com/vsix',
                isPreRelease: true,
            });
            mockHttpsGet.mockResolvedValue(Buffer.from('fake-vsix'));
            mockExtract.mockReturnValue({
                outputDir: '/tmp/out',
                files: ['/tmp/out/analyzer.dll'],
                fileCount: 1,
            });

            const result = await executeDevToolsExtract({
                source: 'vsix',
                version: 'prerelease',
                outputDir: '/tmp/out',
            });

            expect(mockResolveExtension).toHaveBeenCalledWith('prerelease', expect.anything());
            expect(mockExtract).toHaveBeenCalledWith(
                expect.objectContaining({
                    pathPrefix: 'extension/bin/Analyzers',
                }),
            );
            expect(result.source).toBe('vsix');
            expect(result.version).toBe('14.0.1234');
        });

        it('defaults to prerelease channel when no version specified', async () => {
            mockResolveExtension.mockResolvedValue({
                version: '14.0.1234',
                vsixUrl: 'https://example.com/vsix',
                isPreRelease: true,
            });
            mockHttpsGet.mockResolvedValue(Buffer.from('fake'));
            mockExtract.mockReturnValue({ outputDir: '/tmp/out', files: [], fileCount: 0 });

            await executeDevToolsExtract({
                source: 'vsix',
                version: '',
                outputDir: '/tmp/out',
            });

            expect(mockResolveExtension).toHaveBeenCalledWith('prerelease', expect.anything());
        });
    });
});
