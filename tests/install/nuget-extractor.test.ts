import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { zipSync } from 'fflate';

import { extractAnalyzers, findMatchingTfmFolder } from '../../src/install/nuget-extractor';

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extractor-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Create a .nupkg (ZIP) with given DLL entries and write to tmpDir. */
function createNupkg(entries: Record<string, Uint8Array>): string {
    const zipped = zipSync(entries);
    const nupkgPath = path.join(tmpDir, 'test.nupkg');
    fs.writeFileSync(nupkgPath, Buffer.from(zipped));
    return nupkgPath;
}

const fakeDll = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // MZ header stub

// ────────────────────────────────────────────────────────────────
// findMatchingTfmFolder
// ────────────────────────────────────────────────────────────────
describe('findMatchingTfmFolder', () => {
    it('returns direct match when available', () => {
        expect(findMatchingTfmFolder(['net8.0', 'netstandard2.1'], 'net8.0')).toBe('net8.0');
    });

    it('returns netstandard2.1 fallback for net* target', () => {
        expect(findMatchingTfmFolder(['netstandard2.1'], 'net8.0')).toBe('netstandard2.1');
    });

    it('falls back to lower net version for net* target', () => {
        expect(findMatchingTfmFolder(['net8.0', 'netstandard2.1'], 'net9.0')).toBe('net8.0');
    });

    it('tries descending net versions before netstandard fallback', () => {
        expect(findMatchingTfmFolder(['net6.0', 'netstandard2.1'], 'net10.0')).toBe('net6.0');
    });

    it('returns netstandard upward compat (2.0 → 2.1)', () => {
        expect(findMatchingTfmFolder(['netstandard2.1'], 'netstandard2.0')).toBe('netstandard2.1');
    });

    it('prefers lowest matching netstandard version', () => {
        expect(findMatchingTfmFolder(['netstandard2.1', 'netstandard2.2'], 'netstandard2.0')).toBe('netstandard2.1');
    });

    it('returns null when no compatible folder exists', () => {
        expect(findMatchingTfmFolder(['net5.0'], 'net8.0')).toBeNull();
    });

    it('returns null for empty available folders', () => {
        expect(findMatchingTfmFolder([], 'net8.0')).toBeNull();
    });

    it('returns null when netstandard target has no compatible folder', () => {
        expect(findMatchingTfmFolder(['net8.0'], 'netstandard2.0')).toBeNull();
    });

    it('does not match lower netstandard version', () => {
        expect(findMatchingTfmFolder(['netstandard1.0'], 'netstandard2.0')).toBeNull();
    });
});

// ────────────────────────────────────────────────────────────────
// extractAnalyzers
// ────────────────────────────────────────────────────────────────
describe('extractAnalyzers', () => {
    it('extracts DLLs from the correct TFM folder', async () => {
        const nupkg = createNupkg({
            'lib/net8.0/Analyzer1.dll': fakeDll,
            'lib/net8.0/Analyzer2.dll': fakeDll,
            'lib/netstandard2.1/Analyzer1.dll': fakeDll,
        });

        const outputDir = path.join(tmpDir, 'output');
        const result = await extractAnalyzers(nupkg, 'net8.0', outputDir);

        expect(result.actualTfm).toBe('net8.0');
        expect(result.files).toHaveLength(2);
        expect(result.files.every((f) => f.endsWith('.dll'))).toBe(true);
        expect(fs.existsSync(result.extractedPath)).toBe(true);

        // Verify actual files on disk
        for (const file of result.files) {
            expect(fs.existsSync(file)).toBe(true);
        }
    });

    it('falls back to next TFM when exact match is missing', async () => {
        const nupkg = createNupkg({
            'lib/netstandard2.1/Fallback.dll': fakeDll,
        });

        const outputDir = path.join(tmpDir, 'output');
        const result = await extractAnalyzers(nupkg, 'net8.0', outputDir);

        expect(result.actualTfm).toBe('netstandard2.1');
        expect(result.files).toHaveLength(1);
        expect(path.basename(result.files[0])).toBe('Fallback.dll');
    });

    it('falls back through preference order (net9.0 → net8.0)', async () => {
        const nupkg = createNupkg({
            'lib/net8.0/Found.dll': fakeDll,
        });

        const outputDir = path.join(tmpDir, 'output');
        const result = await extractAnalyzers(nupkg, 'net9.0', outputDir);

        expect(result.actualTfm).toBe('net8.0');
        expect(result.files).toHaveLength(1);
    });

    it('falls back via netstandard upward compat (netstandard2.0 → netstandard2.1)', async () => {
        const nupkg = createNupkg({
            'lib/netstandard2.1/Analyzer.dll': fakeDll,
        });

        const outputDir = path.join(tmpDir, 'output');
        const result = await extractAnalyzers(nupkg, 'netstandard2.0', outputDir);

        expect(result.actualTfm).toBe('netstandard2.1');
        expect(result.files).toHaveLength(1);
    });

    it('throws when no compatible TFM folder is found', async () => {
        const nupkg = createNupkg({
            'lib/net5.0/SomeAnalyzer.dll': fakeDll,
        });

        const outputDir = path.join(tmpDir, 'output');
        await expect(
            extractAnalyzers(nupkg, 'net8.0', outputDir),
        ).rejects.toThrow('No compatible TFM folder found');
    });

    it('returns correct file list with full paths', async () => {
        const nupkg = createNupkg({
            'lib/netstandard2.1/A.dll': fakeDll,
            'lib/netstandard2.1/B.dll': fakeDll,
            'lib/netstandard2.1/C.dll': fakeDll,
        });

        const outputDir = path.join(tmpDir, 'output');
        const result = await extractAnalyzers(nupkg, 'netstandard2.1', outputDir);

        expect(result.files).toHaveLength(3);
        const basenames = result.files.map((f) => path.basename(f)).sort();
        expect(basenames).toEqual(['A.dll', 'B.dll', 'C.dll']);
        expect(result.extractedPath).toBe(outputDir);
    });

    it('ignores non-DLL files in lib folder', async () => {
        const nupkg = createNupkg({
            'lib/net8.0/Analyzer.dll': fakeDll,
            'lib/net8.0/readme.txt': new Uint8Array([0x48, 0x69]),
        });

        const outputDir = path.join(tmpDir, 'output');
        const result = await extractAnalyzers(nupkg, 'net8.0', outputDir);

        // Only .dll files are extracted
        expect(result.files).toHaveLength(1);
        expect(path.basename(result.files[0])).toBe('Analyzer.dll');
    });
});
