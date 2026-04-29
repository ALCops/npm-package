import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage } from 'http';
import { Readable } from 'stream';

// Mock https for resolveDevToolsVersion (fetchJson)
vi.mock('https', () => ({
    get: vi.fn(),
}));

// Mock http-range for central directory parsing
vi.mock('../../src/http-range', () => ({
    readZipEOCD: vi.fn(),
    fetchRange: vi.fn(),
    parseZipCentralDirectory: vi.fn(),
    extractRemoteZipCentralEntry: vi.fn(),
}));

// Mock binary-tfm for TFM detection
vi.mock('../../src/binary-tfm', () => ({
    detectTfmFromBuffer: vi.fn(),
}));

import * as https from 'https';
import { readZipEOCD, fetchRange, parseZipCentralDirectory, extractRemoteZipCentralEntry } from '../../src/http-range';
import { detectTfmFromBuffer } from '../../src/binary-tfm';
import { resolveDevToolsVersion, detectFromNuGetDevTools, selectBestDllEntry } from '../../src/detectors/nuget-devtools';
import type { ZipCentralEntry } from '../../src/http-range';

const mockReadEOCD = vi.mocked(readZipEOCD);
const mockFetchRange = vi.mocked(fetchRange);
const mockParseCentralDir = vi.mocked(parseZipCentralDirectory);
const mockExtractEntry = vi.mocked(extractRemoteZipCentralEntry);
const mockDetectTfm = vi.mocked(detectTfmFromBuffer);

function createMockResponse(body: object, statusCode = 200): IncomingMessage {
    const readable = new Readable({
        read() {
            this.push(JSON.stringify(body));
            this.push(null);
        },
    });
    (readable as IncomingMessage).statusCode = statusCode;
    (readable as IncomingMessage).headers = {};
    return readable as IncomingMessage;
}

function mockHttpsGet(response: IncomingMessage) {
    (https.get as ReturnType<typeof vi.fn>).mockImplementation((_url: string, callback: (res: IncomingMessage) => void) => {
        callback(response);
        return { on: vi.fn() };
    });
}

const sampleVersions = {
    versions: [
        '14.0.11111.0',
        '15.0.22222.0',
        '16.0.33333.0',
        '25.0.12345.0',
        '26.0.54321.0',
        '26.1.0.0-preview1',
    ],
};

describe('resolveDevToolsVersion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns a specific version as-is without calling NuGet', async () => {
        const result = await resolveDevToolsVersion('26.0.12345.0');
        expect(result).toBe('26.0.12345.0');
        expect(https.get).not.toHaveBeenCalled();
    });

    it('resolves "latest" to the last stable (non-prerelease) version', async () => {
        mockHttpsGet(createMockResponse(sampleVersions));
        const result = await resolveDevToolsVersion('latest');
        expect(result).toBe('26.0.54321.0');
    });

    it('resolves "preview" to the very last version including pre-release', async () => {
        mockHttpsGet(createMockResponse(sampleVersions));
        const result = await resolveDevToolsVersion('preview');
        expect(result).toBe('26.1.0.0-preview1');
    });
});

describe('selectBestDllEntry', () => {
    it('selects entry with highest preference TFM', () => {
        const entries: ZipCentralEntry[] = [
            { fileName: 'lib/netstandard2.1/Microsoft.Dynamics.Nav.CodeAnalysis.dll', compressedSize: 100, uncompressedSize: 200, localHeaderOffset: 0, compressionMethod: 8 },
            { fileName: 'lib/net8.0/Microsoft.Dynamics.Nav.CodeAnalysis.dll', compressedSize: 100, uncompressedSize: 200, localHeaderOffset: 300, compressionMethod: 8 },
        ];
        const result = selectBestDllEntry(entries);
        expect(result?.fileName).toContain('net8.0');
    });

    it('returns undefined when no DLL entries match', () => {
        const entries: ZipCentralEntry[] = [
            { fileName: 'lib/net8.0/SomeOther.dll', compressedSize: 100, uncompressedSize: 200, localHeaderOffset: 0, compressionMethod: 8 },
        ];
        expect(selectBestDllEntry(entries)).toBeUndefined();
    });

    it('handles entries with unknown TFM', () => {
        const entries: ZipCentralEntry[] = [
            { fileName: 'lib/unknownTfm/Microsoft.Dynamics.Nav.CodeAnalysis.dll', compressedSize: 100, uncompressedSize: 200, localHeaderOffset: 0, compressionMethod: 8 },
        ];
        const result = selectBestDllEntry(entries);
        expect(result?.fileName).toContain('unknownTfm');
    });
});

describe('detectFromNuGetDevTools', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('detects TFM via HTTP Range + binary search pipeline', async () => {
        // Mock EOCD + central directory
        mockReadEOCD.mockResolvedValue({ centralDirectoryOffset: 1000, centralDirectorySize: 500, entryCount: 2 });
        mockFetchRange.mockResolvedValue(Buffer.from('fake-cd-data'));
        mockParseCentralDir.mockReturnValue([
            { fileName: 'lib/net8.0/Microsoft.Dynamics.Nav.CodeAnalysis.dll', compressedSize: 100, uncompressedSize: 200, localHeaderOffset: 0, compressionMethod: 8 },
            { fileName: 'lib/netstandard2.1/Microsoft.Dynamics.Nav.CodeAnalysis.dll', compressedSize: 100, uncompressedSize: 200, localHeaderOffset: 300, compressionMethod: 8 },
        ]);
        mockExtractEntry.mockResolvedValue(Buffer.from('fake-dll'));
        mockDetectTfm.mockReturnValue('net8.0');

        const result = await detectFromNuGetDevTools('26.0.12345.0');

        expect(result.tfm).toBe('net8.0');
        expect(result.source).toBe('nuget-devtools');
        expect(result.details).toContain('26.0.12345.0');
        expect(mockReadEOCD).toHaveBeenCalled();
        expect(mockExtractEntry).toHaveBeenCalled();
        expect(mockDetectTfm).toHaveBeenCalled();
    });

    it('resolves "latest" and detects TFM correctly', async () => {
        // First: resolve version
        mockHttpsGet(createMockResponse(sampleVersions));

        // Then: HTTP Range pipeline
        mockReadEOCD.mockResolvedValue({ centralDirectoryOffset: 1000, centralDirectorySize: 500, entryCount: 1 });
        mockFetchRange.mockResolvedValue(Buffer.from('fake-cd-data'));
        mockParseCentralDir.mockReturnValue([
            { fileName: 'lib/net8.0/Microsoft.Dynamics.Nav.CodeAnalysis.dll', compressedSize: 100, uncompressedSize: 200, localHeaderOffset: 0, compressionMethod: 8 },
        ]);
        mockExtractEntry.mockResolvedValue(Buffer.from('fake-dll'));
        mockDetectTfm.mockReturnValue('net8.0');

        const result = await detectFromNuGetDevTools('latest');
        expect(result.tfm).toBe('net8.0');
        expect(result.source).toBe('nuget-devtools');
        expect(result.details).toContain('26.0.54321.0');
    });

    it('throws when CodeAnalysis DLL is not in package', async () => {
        mockReadEOCD.mockResolvedValue({ centralDirectoryOffset: 1000, centralDirectorySize: 500, entryCount: 1 });
        mockFetchRange.mockResolvedValue(Buffer.from('fake-cd-data'));
        mockParseCentralDir.mockReturnValue([
            { fileName: 'lib/net8.0/SomeOther.dll', compressedSize: 100, uncompressedSize: 200, localHeaderOffset: 0, compressionMethod: 8 },
        ]);

        await expect(detectFromNuGetDevTools('26.0.12345.0')).rejects.toThrow(
            'not found in NuGet package',
        );
    });

    it('throws when TFM cannot be detected from DLL', async () => {
        mockReadEOCD.mockResolvedValue({ centralDirectoryOffset: 1000, centralDirectorySize: 500, entryCount: 1 });
        mockFetchRange.mockResolvedValue(Buffer.from('fake-cd-data'));
        mockParseCentralDir.mockReturnValue([
            { fileName: 'lib/net8.0/Microsoft.Dynamics.Nav.CodeAnalysis.dll', compressedSize: 100, uncompressedSize: 200, localHeaderOffset: 0, compressionMethod: 8 },
        ]);
        mockExtractEntry.mockResolvedValue(Buffer.from('fake-dll'));
        mockDetectTfm.mockReturnValue(null);

        await expect(detectFromNuGetDevTools('26.0.12345.0')).rejects.toThrow(
            'Could not detect TFM',
        );
    });

    it('always sets source to "nuget-devtools"', async () => {
        mockReadEOCD.mockResolvedValue({ centralDirectoryOffset: 1000, centralDirectorySize: 500, entryCount: 1 });
        mockFetchRange.mockResolvedValue(Buffer.from('fake-cd-data'));
        mockParseCentralDir.mockReturnValue([
            { fileName: 'lib/netstandard2.1/Microsoft.Dynamics.Nav.CodeAnalysis.dll', compressedSize: 100, uncompressedSize: 200, localHeaderOffset: 0, compressionMethod: 8 },
        ]);
        mockExtractEntry.mockResolvedValue(Buffer.from('fake-dll'));
        mockDetectTfm.mockReturnValue('netstandard2.0');

        const result = await detectFromNuGetDevTools('15.0.12345.0');
        expect(result.source).toBe('nuget-devtools');
    });
});
