import { TargetFramework, VSIX_DLL_PATH } from './types';
import { detectTfmFromBuffer, detectAssemblyVersionFromBuffer } from './binary-tfm';
import { extractZipEntryFromBuffer } from './zip-local';
import { Logger, nullLogger } from './logger';

export interface VsixTfmResult {
    tfm: TargetFramework;
    assemblyVersion: string | null;
}

/**
 * Detect TFM from a raw CodeAnalysis DLL buffer.
 * Reads the TargetFrameworkAttribute and AssemblyFileVersionAttribute
 * directly from the binary using Buffer.indexOf().
 */
export function detectTfmFromDllBuffer(dllBuffer: Buffer, logger: Logger = nullLogger): VsixTfmResult {
    logger.info('Reading target framework from CodeAnalysis DLL');

    const tfm = detectTfmFromBuffer(dllBuffer);
    if (!tfm) {
        throw new Error('Could not detect target framework from CodeAnalysis DLL');
    }

    const assemblyVersion = detectAssemblyVersionFromBuffer(dllBuffer);
    if (assemblyVersion) {
        logger.info(`Assembly version: ${assemblyVersion}, TFM: ${tfm}`);
    } else {
        logger.info(`TFM: ${tfm} (assembly version not found)`);
    }

    return { tfm, assemblyVersion };
}

/**
 * Detect TFM from a VSIX buffer (ALLanguage.vsix).
 * Extracts the CodeAnalysis DLL, then delegates to detectTfmFromDllBuffer.
 */
export function detectTfmFromVsixBuffer(vsixBuffer: Buffer, logger: Logger = nullLogger): VsixTfmResult {
    const dllBuffer = extractZipEntryFromBuffer(vsixBuffer, VSIX_DLL_PATH, logger);
    return detectTfmFromDllBuffer(dllBuffer, logger);
}
