// TFM detection
export { detectFromBCArtifact } from './detectors/bc-artifact';
export { detectFromMarketplace, queryMarketplace, resolveExtensionVersion } from './detectors/marketplace';
export { detectFromNuGetDevTools, resolveDevToolsVersion, selectBestDllEntry } from './detectors/nuget-devtools';
export { detectFromCompilerPath, findDllFiles } from './detectors/compiler-path';

// Install
export { resolveVersion, downloadPackage, getDownloadUrl } from './install/nuget-api';
export { extractAnalyzers, findMatchingTfmFolder } from './install/nuget-extractor';

// Shared utilities
export { getUserAgent } from './user-agent';
export { getTargetFrameworkFromDotNetVersion } from './version-threshold';
export { detectTfmFromBuffer, detectAssemblyVersionFromBuffer, toShortTfm } from './binary-tfm';
export { detectTfmFromDllBuffer, detectTfmFromVsixBuffer } from './vsix-tfm';
export { parseArtifactUrl, buildArtifactVariantUrl } from './bc-artifact-url';

// Types
export type { TfmDetectionResult, TargetFramework, RegistrationVersion } from './types';
export { TFM_PREFERENCE, AL_COMPILER_DLL, NUGET_PACKAGE_NAME } from './types';

// Logger
export type { Logger } from './logger';
export { nullLogger, createConsoleLogger } from './logger';
