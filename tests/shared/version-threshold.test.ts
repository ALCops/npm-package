import { describe, it, expect } from 'vitest';
import {
    getTargetFrameworkFromDotNetVersion,
} from '../../src/version-threshold';

describe('getTargetFrameworkFromDotNetVersion', () => {
    it('returns net8.0 for "8.0.24"', () => {
        expect(getTargetFrameworkFromDotNetVersion('8.0.24')).toBe('net8.0');
    });

    it('returns netstandard2.1 for "6.0.0"', () => {
        expect(getTargetFrameworkFromDotNetVersion('6.0.0')).toBe('netstandard2.1');
    });

    it('returns net9.0 for "9.0.0"', () => {
        expect(getTargetFrameworkFromDotNetVersion('9.0.0')).toBe('net9.0');
    });

    it('returns net10.0 for "10.0.0"', () => {
        expect(getTargetFrameworkFromDotNetVersion('10.0.0')).toBe('net10.0');
    });

    it('returns net8.0 for exact major version 8', () => {
        expect(getTargetFrameworkFromDotNetVersion('8.0.0')).toBe('net8.0');
    });

    it('returns netstandard2.1 for major version 7', () => {
        expect(getTargetFrameworkFromDotNetVersion('7.0.0')).toBe('netstandard2.1');
    });
});
