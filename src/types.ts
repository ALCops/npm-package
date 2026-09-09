/** Target framework moniker (e.g., 'net8.0', 'netstandard2.1') */
export type TargetFramework = string;

/** TFM preference order: most modern first */
export const TFM_PREFERENCE: string[] = [
    'net10.0',
    'net9.0',
    'net8.0',
    'netstandard2.1',
    'netstandard2.0',
];

/** The DLL filename used for TFM detection from the AL compiler directory */
export const AL_COMPILER_DLL = 'Microsoft.Dynamics.Nav.CodeAnalysis.dll';

/** ALCops NuGet package name */
export const NUGET_PACKAGE_NAME = 'ALCops.Analyzers';

/** NuGet v3 flat container base URL */
export const NUGET_FLAT_CONTAINER = 'https://api.nuget.org/v3-flatcontainer';

/** NuGet v3 Registration API base URL (gzip + SemVer 2.0.0 hive) */
export const NUGET_REGISTRATION_BASE = 'https://api.nuget.org/v3/registration5-gz-semver2';

/** VS Marketplace API endpoint */
export const VS_MARKETPLACE_API =
    'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=3.0-preview.1';

/** AL Language extension identifier on VS Marketplace */
export const AL_EXTENSION_ID = 'ms-dynamics-smb.al';

/**
 * Paths to the CodeAnalysis DLL inside the AL Language VSIX, in probe order:
 * 1. `extension/bin/` — flat layout used by AL 18+ / BC 29 (net10.0, framework-dependent).
 * 2. `extension/bin/Analyzers/` — legacy layout used by AL <= 17.
 *
 * The order is unambiguous: legacy VSIXs never place the DLL directly in
 * `extension/bin/`, so a flat hit always means the new layout.
 */
export const VSIX_DLL_PATH_CANDIDATES: readonly string[] = [
    `extension/bin/${AL_COMPILER_DLL}`,
    `extension/bin/Analyzers/${AL_COMPILER_DLL}`,
];

/** @deprecated Legacy (AL <= 17) VSIX path. Use {@link VSIX_DLL_PATH_CANDIDATES}. */
export const VSIX_DLL_PATH = VSIX_DLL_PATH_CANDIDATES[1];

/** Human-readable name of the VSIX bin layout a matched candidate path belongs to. */
export function describeVsixLayout(entryPath: string): string {
    return entryPath === VSIX_DLL_PATH_CANDIDATES[0]
        ? 'flat (AL 18+)'
        : 'legacy (AL <= 17)';
}

/** Result of TFM detection */
export interface TfmDetectionResult {
    tfm: TargetFramework;
    source: string;
    details?: string;
}

// ── NuGet V3 Registration API types ──

export interface RegistrationCatalogEntry {
    version: string;
    listed?: boolean;
}

export interface RegistrationLeaf {
    catalogEntry: RegistrationCatalogEntry;
    packageContent: string;
}

export interface RegistrationPage {
    '@id': string;
    items?: RegistrationLeaf[];
}

export interface RegistrationIndex {
    items: RegistrationPage[];
}

/** Parsed version info from the Registration API */
export interface RegistrationVersion {
    version: string;
    listed: boolean;
    packageContent: string;
}
