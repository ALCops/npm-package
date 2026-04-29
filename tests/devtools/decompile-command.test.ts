import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_ASSEMBLIES } from '../../src/devtools/decompile-command';

describe('DEFAULT_ASSEMBLIES', () => {
    it('contains the 8 known BC DevTools assemblies', () => {
        expect(DEFAULT_ASSEMBLIES).toHaveLength(8);
        expect(DEFAULT_ASSEMBLIES).toContain('Microsoft.Dynamics.Nav.CodeAnalysis');
        expect(DEFAULT_ASSEMBLIES).toContain('Microsoft.Dynamics.Nav.AL.Common');
        expect(DEFAULT_ASSEMBLIES).toContain('Microsoft.Dynamics.Nav.Analyzers.Common');
        expect(DEFAULT_ASSEMBLIES).toContain('Microsoft.Dynamics.Nav.AppSourceCop');
        expect(DEFAULT_ASSEMBLIES).toContain('Microsoft.Dynamics.Nav.CodeAnalysis.Workspaces');
        expect(DEFAULT_ASSEMBLIES).toContain('Microsoft.Dynamics.Nav.CodeCop');
        expect(DEFAULT_ASSEMBLIES).toContain('Microsoft.Dynamics.Nav.PerTenantExtensionCop');
        expect(DEFAULT_ASSEMBLIES).toContain('Microsoft.Dynamics.Nav.UICop');
    });

    it('does not contain .dll extensions in assembly names', () => {
        for (const assembly of DEFAULT_ASSEMBLIES) {
            expect(assembly).not.toMatch(/\.dll$/);
        }
    });
});

describe('executeDecompile', () => {
    it('throws when input directory does not exist', async () => {
        const { executeDecompile } = await import('../../src/devtools/decompile-command');
        await expect(
            executeDecompile({
                inputDir: '/nonexistent/path',
                outputDir: '/tmp/out',
                assemblies: DEFAULT_ASSEMBLIES,
                keepTool: false,
            }),
        ).rejects.toThrow('Input directory not found');
    });
});
