import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { zipSync } from 'fflate';

import { detectTfmFromVsixBuffer } from '../../src/vsix-tfm';

// No module mocks here: this exercises the real ZIP reader + binary parser
// against the checked-in AL 17 CodeAnalysis DLL packed into both VSIX layouts.

const FIXTURE_DLL = path.join(
    __dirname,
    '..',
    'fixtures',
    'compiler-net80',
    'Microsoft.Dynamics.Nav.CodeAnalysis.dll',
);

const dllBytes = new Uint8Array(fs.readFileSync(FIXTURE_DLL));

function buildVsix(entries: Record<string, Uint8Array>): Buffer {
    return Buffer.from(zipSync(entries));
}

describe('detectTfmFromVsixBuffer (real fixture DLL, real ZIP)', () => {
    it('detects the TFM from the AL 18+ flat extension/bin layout', () => {
        const vsix = buildVsix({
            'extension/package.json': new Uint8Array(Buffer.from('{}')),
            'extension/bin/Microsoft.Dynamics.Nav.CodeAnalysis.dll': dllBytes,
        });

        const result = detectTfmFromVsixBuffer(vsix);

        expect(result.tfm).toBe('net8.0');
        expect(result.assemblyVersion).toBe('17.0.0.0');
    });

    it('detects the TFM from the legacy extension/bin/Analyzers layout', () => {
        const vsix = buildVsix({
            'extension/package.json': new Uint8Array(Buffer.from('{}')),
            'extension/bin/Analyzers/Microsoft.Dynamics.Nav.CodeAnalysis.dll': dllBytes,
        });

        const result = detectTfmFromVsixBuffer(vsix);

        expect(result.tfm).toBe('net8.0');
        expect(result.assemblyVersion).toBe('17.0.0.0');
    });

    it('throws listing both probed paths when the DLL is missing', () => {
        const vsix = buildVsix({
            'extension/package.json': new Uint8Array(Buffer.from('{}')),
        });

        expect(() => detectTfmFromVsixBuffer(vsix)).toThrow(
            /Probed: extension\/bin\/Microsoft\.Dynamics\.Nav\.CodeAnalysis\.dll, extension\/bin\/Analyzers\/Microsoft\.Dynamics\.Nav\.CodeAnalysis\.dll/,
        );
    });
});
