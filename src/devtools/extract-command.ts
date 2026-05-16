import * as path from 'path';
import { Logger, nullLogger } from '../logger';
import { resolveDevToolsVersion } from '../detectors/nuget-devtools';
import { resolveExtensionVersion } from '../detectors/marketplace';
import { httpsGetBuffer } from '../http-client';
import { getUserAgent } from '../user-agent';
import { NUGET_FLAT_CONTAINER } from '../types';
import { extractFromBuffer } from './package-extractor';
import packageJson from '../../package.json';

const DEVTOOLS_PACKAGE = 'microsoft.dynamics.businesscentral.development.tools';
const DEFAULT_USER_AGENT = getUserAgent('ALCops', packageJson.version);

export type ExtractSource = 'nuget' | 'vsix';

export interface DevToolsExtractOptions {
    source: ExtractSource;
    version: string;
    tfm?: string;
    outputDir: string;
    includePattern?: string;
}

export interface DevToolsExtractResult {
    version: string;
    source: ExtractSource;
    tfm?: string;
    outputDir: string;
    fileCount: number;
    files: string[];
}

/**
 * Download and extract BC DevTools files from NuGet or VS Marketplace VSIX.
 */
export async function executeDevToolsExtract(
    options: DevToolsExtractOptions,
    logger: Logger = nullLogger,
): Promise<DevToolsExtractResult> {
    if (options.source === 'nuget') {
        return extractFromNuGet(options, logger);
    }
    return extractFromVsix(options, logger);
}

async function extractFromNuGet(
    options: DevToolsExtractOptions,
    logger: Logger,
): Promise<DevToolsExtractResult> {
    if (!options.tfm) {
        throw new Error('--tfm is required when source is "nuget" (e.g. net8.0, net10.0)');
    }

    const version = await resolveDevToolsVersion(options.version, logger);
    logger.info(`Resolved DevTools version: ${version}`);

    const nupkgUrl = `${NUGET_FLAT_CONTAINER}/${DEVTOOLS_PACKAGE}/${version}/${DEVTOOLS_PACKAGE}.${version}.nupkg`;
    logger.info(`Downloading NuGet package: ${nupkgUrl}`);

    const buffer = await httpsGetBuffer(nupkgUrl, DEFAULT_USER_AGENT);
    logger.info(`Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

    const pathPrefix = `tools/${options.tfm}/any`;
    const result = extractFromBuffer({
        zipBuffer: buffer,
        pathPrefix,
        outputDir: options.outputDir,
        includePattern: options.includePattern,
        logger,
    });

    return {
        version,
        source: 'nuget',
        tfm: options.tfm,
        outputDir: result.outputDir,
        fileCount: result.fileCount,
        files: result.files.map((f) => path.resolve(f)),
    };
}

async function extractFromVsix(
    options: DevToolsExtractOptions,
    logger: Logger,
): Promise<DevToolsExtractResult> {
    const channel = options.version || 'prerelease';
    const resolved = await resolveExtensionVersion(channel, logger);
    logger.info(`Resolved extension version: ${resolved.version}`);

    logger.info(`Downloading VSIX: ${resolved.vsixUrl}`);
    const buffer = await httpsGetBuffer(resolved.vsixUrl, DEFAULT_USER_AGENT);
    logger.info(`Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

    const pathPrefix = 'extension/bin/Analyzers';
    const result = extractFromBuffer({
        zipBuffer: buffer,
        pathPrefix,
        outputDir: options.outputDir,
        includePattern: options.includePattern,
        logger,
    });

    return {
        version: resolved.version,
        source: 'vsix',
        outputDir: result.outputDir,
        fileCount: result.fileCount,
        files: result.files.map((f) => path.resolve(f)),
    };
}
