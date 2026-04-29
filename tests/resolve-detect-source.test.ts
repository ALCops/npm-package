import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock nuget-registration module
vi.mock('../src/nuget-registration', () => ({
    queryNuGetRegistration: vi.fn(),
}));

// Mock marketplace module
vi.mock('../src/detectors/marketplace', () => ({
    queryMarketplace: vi.fn(),
}));

import { queryNuGetRegistration } from '../src/nuget-registration';
import { queryMarketplace } from '../src/detectors/marketplace';
import {
    resolveDetectSource,
    resolveVersionSource,
    CHANNEL_ALIASES,
} from '../src/resolve-detect-source';
import type { RegistrationVersion } from '../src/types';

const mockQueryRegistration = queryNuGetRegistration as ReturnType<typeof vi.fn>;
const mockQueryMarketplace = queryMarketplace as ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.resetAllMocks();
});

describe('resolveDetectSource', () => {
    it('classifies HTTP URLs as bc-artifact', async () => {
        const result = await resolveDetectSource('https://bcartifacts/onprem/24.0/us');
        expect(result).toEqual({
            source: 'bc-artifact',
            input: 'https://bcartifacts/onprem/24.0/us',
        });
    });

    it('classifies HTTPS URLs as bc-artifact', async () => {
        const result = await resolveDetectSource('http://example.com/artifact');
        expect(result).toEqual({
            source: 'bc-artifact',
            input: 'http://example.com/artifact',
        });
    });

    it('classifies "latest" as nuget-devtools channel', async () => {
        const result = await resolveDetectSource('latest');
        expect(result).toEqual({ source: 'nuget-devtools', input: 'latest' });
    });

    it('classifies "prerelease" as nuget-devtools channel normalized to "preview"', async () => {
        const result = await resolveDetectSource('prerelease');
        expect(result).toEqual({ source: 'nuget-devtools', input: 'preview' });
    });

    it('classifies "current" as nuget-devtools channel normalized to "latest"', async () => {
        const result = await resolveDetectSource('current');
        expect(result).toEqual({ source: 'nuget-devtools', input: 'latest' });
    });

    it.each([
        ['stable', 'latest'],
        ['next', 'preview'],
        ['preview', 'preview'],
        ['beta', 'preview'],
    ])('classifies "%s" as nuget-devtools channel normalized to "%s"', async (input, expected) => {
        const result = await resolveDetectSource(input);
        expect(result).toEqual({ source: 'nuget-devtools', input: expected });
    });

    it('normalizes channel keywords case-insensitively', async () => {
        const result = await resolveDetectSource('LATEST');
        expect(result).toEqual({ source: 'nuget-devtools', input: 'latest' });
    });

    it('exports CHANNEL_ALIASES with all expected keys', () => {
        expect(Object.keys(CHANNEL_ALIASES).sort()).toEqual(
            ['beta', 'current', 'latest', 'next', 'prerelease', 'preview', 'stable'].sort(),
        );
    });

    it('resolves a NuGet DevTools version via API', async () => {
        mockQueryRegistration.mockResolvedValue([
            { version: '18.0.35.14686', listed: true, packageContent: '' },
        ] satisfies RegistrationVersion[]);

        const result = await resolveDetectSource('18.0.35.14686');
        expect(result).toEqual({ source: 'nuget-devtools', input: '18.0.35.14686' });
        expect(mockQueryRegistration).toHaveBeenCalled();
        expect(mockQueryMarketplace).not.toHaveBeenCalled();
    });

    it('falls back to marketplace when version not in NuGet', async () => {
        mockQueryRegistration.mockResolvedValue([
            { version: '17.0.34.45391', listed: true, packageContent: '' },
        ] satisfies RegistrationVersion[]);

        mockQueryMarketplace.mockResolvedValue([
            { version: '18.0.2293710', vsixUrl: 'https://example.com', isPreRelease: false },
        ]);

        const result = await resolveDetectSource('18.0.2293710');
        expect(result).toEqual({ source: 'marketplace', input: '18.0.2293710' });
        expect(mockQueryRegistration).toHaveBeenCalled();
        expect(mockQueryMarketplace).toHaveBeenCalled();
    });

    it('throws when version not found in either source', async () => {
        mockQueryRegistration.mockResolvedValue([]);
        mockQueryMarketplace.mockResolvedValue([]);

        await expect(resolveDetectSource('99.99.99')).rejects.toThrow(
            /not found in NuGet DevTools or VS Marketplace/,
        );
    });
});

describe('resolveVersionSource', () => {
    it('finds version in NuGet DevTools without checking marketplace', async () => {
        mockQueryRegistration.mockResolvedValue([
            { version: '17.0.34.45391', listed: true, packageContent: '' },
        ] satisfies RegistrationVersion[]);

        const result = await resolveVersionSource('17.0.34.45391');
        expect(result.source).toBe('nuget-devtools');
        expect(mockQueryMarketplace).not.toHaveBeenCalled();
    });

    it('checks marketplace when NuGet API fails', async () => {
        mockQueryRegistration.mockRejectedValue(new Error('Network error'));
        mockQueryMarketplace.mockResolvedValue([
            { version: '18.0.2293710', vsixUrl: 'https://example.com', isPreRelease: false },
        ]);

        const result = await resolveVersionSource('18.0.2293710');
        expect(result.source).toBe('marketplace');
    });

    it('performs case-insensitive match for NuGet versions', async () => {
        mockQueryRegistration.mockResolvedValue([
            { version: '18.0.35.14686-Beta', listed: true, packageContent: '' },
        ] satisfies RegistrationVersion[]);

        const result = await resolveVersionSource('18.0.35.14686-beta');
        expect(result.source).toBe('nuget-devtools');
    });
});
