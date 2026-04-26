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

/** Path to CodeAnalysis DLL inside the AL Language VSIX */
export const VSIX_DLL_PATH = 'extension/bin/Analyzers/Microsoft.Dynamics.Nav.CodeAnalysis.dll';

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
