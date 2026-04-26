import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { detectTfmFromBuffer, detectAssemblyVersionFromBuffer, toShortTfm } from '../../src/binary-tfm';

const fixturesDir = path.resolve(__dirname, '..', 'fixtures');
const net80Dll = path.join(fixturesDir, 'compiler-net80', 'Microsoft.Dynamics.Nav.CodeAnalysis.dll');
const netstandard21Dll = path.join(fixturesDir, 'compiler-netstandard21', 'Microsoft.Dynamics.Nav.CodeAnalysis.dll');

describe('detectTfmFromBuffer', () => {
    it('detects net8.0 from fixture DLL', () => {
        const buffer = fs.readFileSync(net80Dll);
        expect(detectTfmFromBuffer(buffer)).toBe('net8.0');
    });

    it('detects netstandard2.1 from fixture DLL', () => {
        const buffer = fs.readFileSync(netstandard21Dll);
        expect(detectTfmFromBuffer(buffer)).toBe('netstandard2.1');
    });

    it('returns null for empty buffer', () => {
        expect(detectTfmFromBuffer(Buffer.alloc(0))).toBeNull();
    });

    it('returns null for buffer without TargetFrameworkAttribute', () => {
        const buffer = Buffer.from('some random binary data without the attribute');
        expect(detectTfmFromBuffer(buffer)).toBeNull();
    });

    it('returns null when attribute name exists but no TFM prefix found', () => {
        const buffer = Buffer.from('TargetFrameworkAttribute but no TFM prefix');
        expect(detectTfmFromBuffer(buffer)).toBeNull();
    });

    it('handles .NETFramework prefix', () => {
        const content = 'TargetFrameworkAttribute\0.NETFramework,Version=v4.8\x01';
        const buffer = Buffer.from(content, 'utf8');
        expect(detectTfmFromBuffer(buffer)).toBe('net4.8');
    });
});

describe('detectAssemblyVersionFromBuffer', () => {
    it('extracts assembly version from net8.0 fixture DLL', () => {
        const buffer = fs.readFileSync(net80Dll);
        expect(detectAssemblyVersionFromBuffer(buffer)).toBe('17.0.0.0');
    });

    it('extracts assembly version from netstandard2.1 fixture DLL', () => {
        const buffer = fs.readFileSync(netstandard21Dll);
        expect(detectAssemblyVersionFromBuffer(buffer)).toBe('15.0.0.0');
    });

    it('returns null for empty buffer', () => {
        expect(detectAssemblyVersionFromBuffer(Buffer.alloc(0))).toBeNull();
    });

    it('returns null for buffer without AssemblyFileVersionAttribute', () => {
        const buffer = Buffer.from('some random binary data');
        expect(detectAssemblyVersionFromBuffer(buffer)).toBeNull();
    });

    it('returns null when attribute exists but no valid blob found', () => {
        const buffer = Buffer.from('AssemblyFileVersionAttribute with no blob prolog');
        expect(detectAssemblyVersionFromBuffer(buffer)).toBeNull();
    });
});

describe('toShortTfm', () => {
    it('converts .NETCoreApp to net', () => {
        expect(toShortTfm('.NETCoreApp,Version=v8.0')).toBe('net8.0');
    });

    it('converts .NETStandard to netstandard', () => {
        expect(toShortTfm('.NETStandard,Version=v2.1')).toBe('netstandard2.1');
    });

    it('converts .NETFramework to net', () => {
        expect(toShortTfm('.NETFramework,Version=v4.8')).toBe('net4.8');
    });

    it('returns null for null input', () => {
        expect(toShortTfm(null)).toBeNull();
    });

    it('returns input unchanged if no prefix matches', () => {
        expect(toShortTfm('SomeOtherFramework')).toBe('SomeOtherFramework');
    });

    it('handles multi-digit versions', () => {
        expect(toShortTfm('.NETCoreApp,Version=v10.0')).toBe('net10.0');
    });
});
