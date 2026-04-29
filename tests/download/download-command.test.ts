import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { zipSync } from 'fflate';

// Mock all external network dependencies
vi.mock('../../src/nuget-registration', () => ({
    queryNuGetRegistration: vi.fn(),
}));

vi.mock('../../src/detectors/marketplace', () => ({
    queryMarketplace: vi.fn(),
    detectFromMarketplace: vi.fn(),
    resolveExtensionVersion: vi.fn(),
}));

vi.mock('../../src/detectors/bc-artifact', () => ({
    detectFromBCArtifact: vi.fn(),
}));

vi.mock('../../src/detectors/nuget-devtools', () => ({
    detectFromNuGetDevTools: vi.fn(),
}));

vi.mock('../../src/detectors/compiler-path', () => ({
    detectFromCompilerPath: vi.fn(),
}));

vi.mock('../../src/http-client', () => ({
    httpsGetBuffer: vi.fn(),
    httpsGetJson: vi.fn(),
}));

import { queryNuGetRegistration } from '../../src/nuget-registration';
import { detectFromBCArtifact } from '../../src/detectors/bc-artifact';
import { detectFromMarketplace } from '../../src/detectors/marketplace';
import { detectFromNuGetDevTools } from '../../src/detectors/nuget-devtools';
import { detectFromCompilerPath } from '../../src/detectors/compiler-path';
import { httpsGetBuffer } from '../../src/http-client';
import { executeDownload } from '../../src/download/download-command';
import type { RegistrationVersion } from '../../src/types';

const mockDetectBCArtifact = detectFromBCArtifact as ReturnType<typeof vi.fn>;
const mockDetectMarketplace = detectFromMarketplace as ReturnType<typeof vi.fn>;
const mockDetectNuGetDevTools = detectFromNuGetDevTools as ReturnType<typeof vi.fn>;
const mockDetectCompilerPath = detectFromCompilerPath as ReturnType<typeof vi.fn>;
const mockQueryRegistration = queryNuGetRegistration as ReturnType<typeof vi.fn>;
const mockHttpsGetBuffer = httpsGetBuffer as ReturnType<typeof vi.fn>;

let tmpDir: string;

beforeEach(() => {
    vi.resetAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-cmd-test-'));

    // Default: resolve ALCops version as 'latest' with a single stable version
    mockQueryRegistration.mockResolvedValue([
        { version: '1.0.0', listed: true, packageContent: 'https://example.com/pkg.nupkg' },
    ] satisfies RegistrationVersion[]);
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createFakeNupkgBuffer(tfm: string): Buffer {
    const fakeDll = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
    const entries: Record<string, Uint8Array> = {
        [`lib/${tfm}/TestAnalyzer.dll`]: fakeDll,
    };
    const zipped = zipSync(entries);
    return Buffer.from(zipped);
}

describe('executeDownload', () => {
    it('downloads and extracts with explicit --tfm', async () => {
        const nupkgBuffer = createFakeNupkgBuffer('net8.0');
        mockHttpsGetBuffer.mockResolvedValue(nupkgBuffer);

        const outputDir = path.join(tmpDir, 'output');
        const result = await executeDownload({
            tfm: 'net8.0',
            outputDir,
        });

        expect(result.version).toBe('1.0.0');
        expect(result.tfm).toBe('net8.0');
        expect(result.files).toHaveLength(1);
        expect(result.files[0]).toContain('TestAnalyzer.dll');
        expect(fs.existsSync(result.files[0])).toBe(true);
    });

    it('auto-detects TFM from URL (bc-artifact)', async () => {
        mockDetectBCArtifact.mockResolvedValue({ tfm: 'net8.0', source: 'bc-artifact' });
        const nupkgBuffer = createFakeNupkgBuffer('net8.0');
        mockHttpsGetBuffer.mockResolvedValue(nupkgBuffer);

        const outputDir = path.join(tmpDir, 'output');
        const result = await executeDownload({
            source: 'https://bcartifacts/onprem/24.0/us',
            outputDir,
        });

        expect(mockDetectBCArtifact).toHaveBeenCalledWith(
            'https://bcartifacts/onprem/24.0/us',
            expect.anything(),
        );
        expect(result.tfm).toBe('net8.0');
    });

    it('auto-detects TFM from channel keyword (nuget-devtools)', async () => {
        mockDetectNuGetDevTools.mockResolvedValue({ tfm: 'net8.0', source: 'nuget-devtools' });
        const nupkgBuffer = createFakeNupkgBuffer('net8.0');
        mockHttpsGetBuffer.mockResolvedValue(nupkgBuffer);

        const outputDir = path.join(tmpDir, 'output');
        const result = await executeDownload({
            source: 'latest',
            outputDir,
        });

        expect(mockDetectNuGetDevTools).toHaveBeenCalledWith('latest', expect.anything());
        expect(result.tfm).toBe('net8.0');
    });

    it('respects --detect-from override', async () => {
        mockDetectMarketplace.mockResolvedValue({ tfm: 'net8.0', source: 'marketplace' });
        const nupkgBuffer = createFakeNupkgBuffer('net8.0');
        mockHttpsGetBuffer.mockResolvedValue(nupkgBuffer);

        const outputDir = path.join(tmpDir, 'output');
        const result = await executeDownload({
            source: 'https://bcartifacts/some-url',
            detectFrom: 'marketplace',
            outputDir,
        });

        // Should use marketplace despite URL input
        expect(mockDetectMarketplace).toHaveBeenCalled();
        expect(mockDetectBCArtifact).not.toHaveBeenCalled();
        expect(result.tfm).toBe('net8.0');
    });

    it('throws when neither --tfm nor source is provided', async () => {
        const outputDir = path.join(tmpDir, 'output');
        await expect(executeDownload({ outputDir })).rejects.toThrow(
            /Either --tfm or a detection source argument is required/,
        );
    });

    it('cleans up temp directory even on extraction error', async () => {
        const nupkgBuffer = createFakeNupkgBuffer('net6.0');
        mockHttpsGetBuffer.mockResolvedValue(nupkgBuffer);

        // Count alcops temp dirs before
        const before = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('alcops-')).length;

        const outputDir = path.join(tmpDir, 'output');
        await expect(
            executeDownload({ tfm: 'netstandard1.0', outputDir }),
        ).rejects.toThrow();

        // No new temp dirs should remain
        const after = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('alcops-')).length;
        expect(after).toBe(before);
    });
});
