import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { zipSync } from 'fflate';
import { extractFromBuffer, matchesGlob } from '../../src/devtools/package-extractor';

function createTestZip(entries: Record<string, string | Uint8Array>): Buffer {
    const files: Record<string, Uint8Array> = {};
    for (const [name, content] of Object.entries(entries)) {
        files[name] = typeof content === 'string'
            ? new TextEncoder().encode(content)
            : content;
    }
    return Buffer.from(zipSync(files));
}

describe('extractFromBuffer', () => {
    let tmpDir: string;

    function makeTmpDir(): string {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alcops-test-'));
        return tmpDir;
    }

    afterEach(() => {
        if (tmpDir && fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('extracts files matching a path prefix', () => {
        const zip = createTestZip({
            'tools/net8.0/any/foo.dll': 'foo-content',
            'tools/net8.0/any/bar.dll': 'bar-content',
            'tools/net10.0/any/foo.dll': 'foo-net10',
            'other/file.txt': 'unrelated',
        });
        const outDir = makeTmpDir();

        const result = extractFromBuffer({
            zipBuffer: zip,
            pathPrefix: 'tools/net8.0/any',
            outputDir: outDir,
        });

        expect(result.fileCount).toBe(2);
        expect(fs.readFileSync(path.join(outDir, 'foo.dll'), 'utf-8')).toBe('foo-content');
        expect(fs.readFileSync(path.join(outDir, 'bar.dll'), 'utf-8')).toBe('bar-content');
    });

    it('preserves subdirectory structure relative to prefix', () => {
        const zip = createTestZip({
            'extension/bin/Analyzers/main.dll': 'main',
            'extension/bin/Analyzers/sub/nested.dll': 'nested',
        });
        const outDir = makeTmpDir();

        const result = extractFromBuffer({
            zipBuffer: zip,
            pathPrefix: 'extension/bin/Analyzers',
            outputDir: outDir,
        });

        expect(result.fileCount).toBe(2);
        expect(fs.existsSync(path.join(outDir, 'sub', 'nested.dll'))).toBe(true);
    });

    it('applies include glob filter', () => {
        const zip = createTestZip({
            'tools/net8.0/any/foo.dll': 'dll',
            'tools/net8.0/any/foo.pdb': 'pdb',
            'tools/net8.0/any/foo.json': 'json',
        });
        const outDir = makeTmpDir();

        const result = extractFromBuffer({
            zipBuffer: zip,
            pathPrefix: 'tools/net8.0/any',
            outputDir: outDir,
            includePattern: '*.dll',
        });

        expect(result.fileCount).toBe(1);
        expect(fs.existsSync(path.join(outDir, 'foo.dll'))).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'foo.pdb'))).toBe(false);
    });

    it('throws when no files match the prefix', () => {
        const zip = createTestZip({
            'other/file.txt': 'content',
        });
        const outDir = makeTmpDir();

        expect(() =>
            extractFromBuffer({
                zipBuffer: zip,
                pathPrefix: 'tools/net8.0/any',
                outputDir: outDir,
            }),
        ).toThrow(/No files found matching prefix/);
    });

    it('handles prefix with trailing slash', () => {
        const zip = createTestZip({
            'tools/net8.0/any/foo.dll': 'content',
        });
        const outDir = makeTmpDir();

        const result = extractFromBuffer({
            zipBuffer: zip,
            pathPrefix: 'tools/net8.0/any/',
            outputDir: outDir,
        });

        expect(result.fileCount).toBe(1);
    });

    it('creates output directory if it does not exist', () => {
        const zip = createTestZip({
            'prefix/file.txt': 'content',
        });
        const outDir = path.join(makeTmpDir(), 'nested', 'output');

        const result = extractFromBuffer({
            zipBuffer: zip,
            pathPrefix: 'prefix',
            outputDir: outDir,
        });

        expect(result.fileCount).toBe(1);
        expect(fs.existsSync(path.join(outDir, 'file.txt'))).toBe(true);
    });
});

describe('matchesGlob', () => {
    it('matches wildcard extension pattern', () => {
        expect(matchesGlob('foo.dll', '*.dll')).toBe(true);
        expect(matchesGlob('foo.pdb', '*.dll')).toBe(false);
    });

    it('matches star-only pattern', () => {
        expect(matchesGlob('anything', '*')).toBe(true);
    });

    it('matches prefix pattern', () => {
        expect(matchesGlob('Microsoft.Dynamics.Nav.dll', 'Microsoft.*')).toBe(true);
        expect(matchesGlob('Other.dll', 'Microsoft.*')).toBe(false);
    });

    it('is case-insensitive', () => {
        expect(matchesGlob('FOO.DLL', '*.dll')).toBe(true);
    });

    it('matches exact filename', () => {
        expect(matchesGlob('foo.dll', 'foo.dll')).toBe(true);
        expect(matchesGlob('bar.dll', 'foo.dll')).toBe(false);
    });

    it('supports question mark for single character', () => {
        expect(matchesGlob('foo.dll', 'fo?.dll')).toBe(true);
        expect(matchesGlob('fooo.dll', 'fo?.dll')).toBe(false);
    });
});
