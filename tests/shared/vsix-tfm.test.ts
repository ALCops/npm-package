import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/binary-tfm', () => ({
    detectTfmFromBuffer: vi.fn(),
    detectAssemblyVersionFromBuffer: vi.fn(),
}));
vi.mock('../../src/zip-local', () => ({
    extractZipEntryFromBuffer: vi.fn(),
}));

import { detectTfmFromBuffer, detectAssemblyVersionFromBuffer } from '../../src/binary-tfm';
import { extractZipEntryFromBuffer } from '../../src/zip-local';
import { detectTfmFromVsixBuffer, detectTfmFromDllBuffer } from '../../src/vsix-tfm';

const mockDetectTfm = vi.mocked(detectTfmFromBuffer);
const mockDetectVersion = vi.mocked(detectAssemblyVersionFromBuffer);
const mockExtractEntry = vi.mocked(extractZipEntryFromBuffer);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('detectTfmFromDllBuffer', () => {
    it('detects net8.0 with assembly version', () => {
        mockDetectTfm.mockReturnValue('net8.0');
        mockDetectVersion.mockReturnValue('17.0.0.0');

        const result = detectTfmFromDllBuffer(Buffer.from('fake-dll'));

        expect(result.tfm).toBe('net8.0');
        expect(result.assemblyVersion).toBe('17.0.0.0');
    });

    it('detects netstandard2.1 with assembly version', () => {
        mockDetectTfm.mockReturnValue('netstandard2.1');
        mockDetectVersion.mockReturnValue('14.0.0.0');

        const result = detectTfmFromDllBuffer(Buffer.from('fake-dll'));

        expect(result.tfm).toBe('netstandard2.1');
        expect(result.assemblyVersion).toBe('14.0.0.0');
    });

    it('returns null assemblyVersion when not found', () => {
        mockDetectTfm.mockReturnValue('net8.0');
        mockDetectVersion.mockReturnValue(null);

        const result = detectTfmFromDllBuffer(Buffer.from('fake-dll'));

        expect(result.tfm).toBe('net8.0');
        expect(result.assemblyVersion).toBeNull();
    });

    it('throws when TFM not detected', () => {
        mockDetectTfm.mockReturnValue(null);
        mockDetectVersion.mockReturnValue('17.0.0.0');

        expect(() => detectTfmFromDllBuffer(Buffer.from('fake-dll'))).toThrow(
            'Could not detect target framework from CodeAnalysis DLL',
        );
    });
});

describe('detectTfmFromVsixBuffer', () => {
    it('extracts DLL from VSIX and detects TFM', () => {
        mockExtractEntry.mockReturnValue(Buffer.from('fake-dll'));
        mockDetectTfm.mockReturnValue('net8.0');
        mockDetectVersion.mockReturnValue('17.0.0.0');

        const result = detectTfmFromVsixBuffer(Buffer.from('fake-vsix'));

        expect(result.tfm).toBe('net8.0');
        expect(result.assemblyVersion).toBe('17.0.0.0');
        expect(mockExtractEntry).toHaveBeenCalledWith(
            expect.any(Buffer),
            'extension/bin/Analyzers/Microsoft.Dynamics.Nav.CodeAnalysis.dll',
            expect.any(Object),
        );
    });
});
