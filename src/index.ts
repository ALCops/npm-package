// TFM detection
export { detectFromBCArtifact } from './detectors/bc-artifact';
export { detectFromMarketplace, queryMarketplace, resolveExtensionVersion } from './detectors/marketplace';
export { detectFromNuGetDevTools, resolveDevToolsVersion, selectBestDllEntry } from './detectors/nuget-devtools';
export { detectFromCompilerPath, findDllFiles } from './detectors/compiler-path';

// Download
export { resolveVersion, downloadPackage, getDownloadUrl } from './download/nuget-api';
export { extractAnalyzers, findMatchingTfmFolder } from './download/nuget-extractor';
export { executeDownload } from './download/download-command';
export type { DownloadOptions, DownloadResult } from './download/download-command';

// Detection source resolution
export { resolveDetectSource, resolveVersionSource } from './resolve-detect-source';
export type { DetectSource, ResolvedDetectSource } from './resolve-detect-source';

// Shared utilities
export { getUserAgent } from './user-agent';
export { getTargetFrameworkFromDotNetVersion } from './version-threshold';
export { detectTfmFromBuffer, detectAssemblyVersionFromBuffer, toShortTfm } from './binary-tfm';
export { detectTfmFromDllBuffer, detectTfmFromVsixBuffer } from './vsix-tfm';
export { parseArtifactUrl, buildArtifactVariantUrl, downloadFullZip } from './bc-artifact-url';
export { extractZipEntryFromBuffer, listZipEntries } from './zip-local';
export {
    fetchRange, getContentLength, readZipEOCD,
    parseZipCentralDirectory, findEntryByFilename,
    extractRemoteZipCentralEntry, extractRemoteZipEntry,
} from './http-range';
export type { ZipEOCD, ZipCentralEntry } from './http-range';
export { httpsGetBuffer, httpsGetJson } from './http-client';
export { queryNuGetRegistration, parseRegistrationIndex } from './nuget-registration';

// Types
export type { TfmDetectionResult, TargetFramework, RegistrationVersion, RegistrationIndex } from './types';
export {
    TFM_PREFERENCE, AL_COMPILER_DLL, NUGET_PACKAGE_NAME,
    NUGET_FLAT_CONTAINER, NUGET_REGISTRATION_BASE,
    VS_MARKETPLACE_API, AL_EXTENSION_ID, VSIX_DLL_PATH,
} from './types';

// Logger
export type { Logger } from './logger';
export { nullLogger, createConsoleLogger } from './logger';
