import { TargetFramework } from './types';

/**
 * Given a .NET runtime version string like "8.0.24", determine the TFM.
 * Major version >= 8 → net{major}.0 (e.g., net8.0, net9.0, net10.0)
 * Otherwise → netstandard2.1
 */
export function getTargetFrameworkFromDotNetVersion(dotNetVersion: string): TargetFramework {
    const major = Number(dotNetVersion.split('.')[0]);
    if (major >= 8) {
        return `net${major}.0`;
    }
    return 'netstandard2.1';
}
