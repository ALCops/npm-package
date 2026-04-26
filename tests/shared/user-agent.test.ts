import { describe, it, expect } from 'vitest';
import { getUserAgent } from '../../src/user-agent';

describe('getUserAgent', () => {
    it('returns clientId/version format', () => {
        const ua = getUserAgent('ALCops', '1.2.3');
        expect(ua).toMatch(/^ALCops\/1\.2\.3 \(Node\.js v\d+\.\d+\.\d+; \w+ .+\)$/);
    });

    it('includes process.version and os info', () => {
        const ua = getUserAgent('ALCops', '0.0.1');
        expect(ua).toContain(`Node.js ${process.version}`);
        expect(ua).toContain('ALCops/0.0.1');
    });

    it('works with pre-release style versions', () => {
        const ua = getUserAgent('ALCops', '2.0.0-beta.1');
        expect(ua).toMatch(/^ALCops\/2\.0\.0-beta\.1 \(/);
    });

    it('supports custom client identifiers', () => {
        const ua = getUserAgent('vsts-task-installer', '1.0.0');
        expect(ua).toMatch(/^vsts-task-installer\/1\.0\.0 \(/);
    });
});
