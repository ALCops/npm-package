import { describe, it, expect } from 'vitest';
import { parseArtifactUrl, buildArtifactVariantUrl } from '../../src/bc-artifact-url';

describe('parseArtifactUrl', () => {
    it('parses a standard BC artifact URL', () => {
        const result = parseArtifactUrl(
            'https://bcartifacts-exdbf9fwegejdqak.b02.azurefd.net/sandbox/20.0.37253.50766/w1',
        );

        expect(result.type).toBe('sandbox');
        expect(result.version).toBe('20.0.37253.50766');
        expect(result.country).toBe('w1');
        expect(result.query).toBe('');
    });

    it('parses a URL with a query string', () => {
        const result = parseArtifactUrl(
            'https://bcartifacts.azureedge.net/onprem/21.0.12345.0/be?sv=2024-01-01',
        );

        expect(result.type).toBe('onprem');
        expect(result.version).toBe('21.0.12345.0');
        expect(result.country).toBe('be');
        expect(result.query).toBe('?sv=2024-01-01');
    });

    it('throws on a URL with too few segments', () => {
        expect(() => parseArtifactUrl('https://example.com/sandbox')).toThrow(
            'Invalid BC artifact URL format',
        );
    });

    it('handles various country codes', () => {
        for (const country of ['us', 'nl', 'it', 'de', 'au', 'base']) {
            const url = `https://host/sandbox/26.0.0.0/${country}`;
            const result = parseArtifactUrl(url);
            expect(result.country).toBe(country);
        }
    });
});

describe('buildArtifactVariantUrl', () => {
    it('replaces country with "core"', () => {
        const result = buildArtifactVariantUrl(
            'https://bcartifacts-exdbf9fwegejdqak.b02.azurefd.net/sandbox/20.0.37253.50766/w1',
            'core',
        );

        expect(result).toBe(
            'https://bcartifacts-exdbf9fwegejdqak.b02.azurefd.net/sandbox/20.0.37253.50766/core',
        );
    });

    it('replaces country with "platform"', () => {
        const result = buildArtifactVariantUrl(
            'https://host/onprem/21.0.0.0/be',
            'platform',
        );

        expect(result).toBe('https://host/onprem/21.0.0.0/platform');
    });

    it('preserves query string', () => {
        const result = buildArtifactVariantUrl(
            'https://host/sandbox/20.0.0.0/w1?token=abc',
            'core',
        );

        expect(result).toBe('https://host/sandbox/20.0.0.0/core?token=abc');
    });
});
