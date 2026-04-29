import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { detectFromCompilerPath, findDllFiles } from '../../src/detectors/compiler-path';
import { AL_COMPILER_DLL } from '../../src/types';

const fixturesDir = path.resolve(__dirname, '..', 'fixtures');
const net80Dll = path.join(fixturesDir, 'compiler-net80', AL_COMPILER_DLL);
const netstandard21Dll = path.join(fixturesDir, 'compiler-netstandard21', AL_COMPILER_DLL);

function createTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'compiler-path-test-'));
}

function cleanupDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

// ────────────────────────────────────────────────────────────────
// findDllFiles
// ────────────────────────────────────────────────────────────────
describe('findDllFiles', () => {
    it('finds DLL in root directory (fast path)', () => {
        const result = findDllFiles(path.join(fixturesDir, 'compiler-net80'));
        expect(result).toHaveLength(1);
        expect(result[0]).toContain(AL_COMPILER_DLL);
    });

    it('finds DLL in subdirectory', () => {
        const tmpDir = createTmpDir();
        try {
            const subDir = path.join(tmpDir, 'sub', 'deep');
            fs.mkdirSync(subDir, { recursive: true });
            fs.copyFileSync(net80Dll, path.join(subDir, AL_COMPILER_DLL));

            const result = findDllFiles(tmpDir);
            expect(result).toHaveLength(1);
            expect(result[0]).toContain('sub');
        } finally {
            cleanupDir(tmpDir);
        }
    });

    it('finds multiple DLLs in different subdirectories', () => {
        const tmpDir = createTmpDir();
        try {
            const subA = path.join(tmpDir, 'a');
            const subB = path.join(tmpDir, 'b');
            fs.mkdirSync(subA);
            fs.mkdirSync(subB);
            fs.copyFileSync(net80Dll, path.join(subA, AL_COMPILER_DLL));
            fs.copyFileSync(net80Dll, path.join(subB, AL_COMPILER_DLL));

            const result = findDllFiles(tmpDir);
            expect(result).toHaveLength(2);
        } finally {
            cleanupDir(tmpDir);
        }
    });

    it('returns only root DLL when it exists (skips recursive)', () => {
        const tmpDir = createTmpDir();
        try {
            fs.copyFileSync(net80Dll, path.join(tmpDir, AL_COMPILER_DLL));
            const subDir = path.join(tmpDir, 'sub');
            fs.mkdirSync(subDir);
            fs.copyFileSync(netstandard21Dll, path.join(subDir, AL_COMPILER_DLL));

            const result = findDllFiles(tmpDir);
            expect(result).toHaveLength(1);
            expect(result[0]).toBe(path.join(tmpDir, AL_COMPILER_DLL));
        } finally {
            cleanupDir(tmpDir);
        }
    });

    it('throws for nonexistent directory', () => {
        expect(() => findDllFiles('/nonexistent/path')).toThrow(
            'Compiler path directory does not exist',
        );
    });

    it('throws for path that is a file, not a directory', () => {
        expect(() => findDllFiles(net80Dll)).toThrow(
            'Compiler path is not a directory',
        );
    });

    it('returns empty array for directory with no DLLs', () => {
        const tmpDir = createTmpDir();
        try {
            const result = findDllFiles(tmpDir);
            expect(result).toHaveLength(0);
        } finally {
            cleanupDir(tmpDir);
        }
    });
});

// ────────────────────────────────────────────────────────────────
// detectFromCompilerPath
// ────────────────────────────────────────────────────────────────
describe('detectFromCompilerPath', () => {
    it('detects net8.0 from fixture DLL', async () => {
        const result = await detectFromCompilerPath(
            path.join(fixturesDir, 'compiler-net80'),
        );

        expect(result.tfm).toBe('net8.0');
        expect(result.source).toBe('compiler-path');
        expect(result.details).toContain(AL_COMPILER_DLL);
    });

    it('detects netstandard2.1 from fixture DLL', async () => {
        const result = await detectFromCompilerPath(
            path.join(fixturesDir, 'compiler-netstandard21'),
        );

        expect(result.tfm).toBe('netstandard2.1');
        expect(result.source).toBe('compiler-path');
        expect(result.details).toContain(AL_COMPILER_DLL);
    });

    it('detects TFM from DLL in subdirectory', async () => {
        const tmpDir = createTmpDir();
        try {
            const subDir = path.join(tmpDir, 'compiler', 'bin');
            fs.mkdirSync(subDir, { recursive: true });
            fs.copyFileSync(net80Dll, path.join(subDir, AL_COMPILER_DLL));

            const result = await detectFromCompilerPath(tmpDir);
            expect(result.tfm).toBe('net8.0');
            expect(result.source).toBe('compiler-path');
        } finally {
            cleanupDir(tmpDir);
        }
    });

    it('succeeds with multiple DLLs of the same TFM', async () => {
        const tmpDir = createTmpDir();
        try {
            const subA = path.join(tmpDir, 'v1');
            const subB = path.join(tmpDir, 'v2');
            fs.mkdirSync(subA);
            fs.mkdirSync(subB);
            fs.copyFileSync(net80Dll, path.join(subA, AL_COMPILER_DLL));
            fs.copyFileSync(net80Dll, path.join(subB, AL_COMPILER_DLL));

            const result = await detectFromCompilerPath(tmpDir);
            expect(result.tfm).toBe('net8.0');
            expect(result.details).toContain('2 DLLs found');
        } finally {
            cleanupDir(tmpDir);
        }
    });

    it('throws for multiple DLLs with conflicting TFMs', async () => {
        const tmpDir = createTmpDir();
        try {
            const subA = path.join(tmpDir, 'new');
            const subB = path.join(tmpDir, 'old');
            fs.mkdirSync(subA);
            fs.mkdirSync(subB);
            fs.copyFileSync(net80Dll, path.join(subA, AL_COMPILER_DLL));
            fs.copyFileSync(netstandard21Dll, path.join(subB, AL_COMPILER_DLL));

            await expect(detectFromCompilerPath(tmpDir)).rejects.toThrow(
                'Conflicting TFMs detected',
            );
        } finally {
            cleanupDir(tmpDir);
        }
    });

    it('throws for nonexistent directory', async () => {
        await expect(
            detectFromCompilerPath('/nonexistent/path'),
        ).rejects.toThrow('Compiler path directory does not exist');
    });

    it('throws for empty directory (no DLL found)', async () => {
        const tmpDir = createTmpDir();
        try {
            await expect(
                detectFromCompilerPath(tmpDir),
            ).rejects.toThrow('or any subdirectory');
        } finally {
            cleanupDir(tmpDir);
        }
    });

    it('throws for invalid DLL (no TFM detected)', async () => {
        const tmpDir = createTmpDir();
        const fakeDllPath = path.join(tmpDir, AL_COMPILER_DLL);
        fs.writeFileSync(fakeDllPath, Buffer.from('not a valid PE file'));

        try {
            await expect(
                detectFromCompilerPath(tmpDir),
            ).rejects.toThrow();
        } finally {
            cleanupDir(tmpDir);
        }
    });
});
