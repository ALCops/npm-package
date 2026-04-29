import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger, nullLogger } from '../logger';
import { resolveDetectSource, DetectSource } from '../resolve-detect-source';
import { detectFromBCArtifact } from '../detectors/bc-artifact';
import { detectFromMarketplace } from '../detectors/marketplace';
import { detectFromNuGetDevTools } from '../detectors/nuget-devtools';
import { detectFromCompilerPath } from '../detectors/compiler-path';
import { resolveVersion, downloadPackage } from './nuget-api';
import { extractAnalyzers } from './nuget-extractor';

export interface DownloadOptions {
    /** TFM detection input (URL, path, channel keyword, or version number) */
    detectSource?: string;
    /** Explicit TFM, skips detection */
    tfm?: string;
    /** ALCops package version to download (default: 'latest') */
    version?: string;
    /** Force a specific detection source, overrides smart routing */
    detectFrom?: DetectSource;
    /** Output directory for extracted analyzer DLLs */
    outputDir: string;
}

export interface DownloadResult {
    version: string;
    tfm: string;
    outputDir: string;
    files: string[];
}

/**
 * Full download pipeline: detect TFM → resolve ALCops version → download → extract → cleanup.
 */
export async function executeDownload(
    options: DownloadOptions,
    logger: Logger = nullLogger,
): Promise<DownloadResult> {
    const tfm = await resolveTfm(options, logger);
    const alcopsVersion = options.version ?? 'latest';

    logger.info(`Target TFM: ${tfm}`);
    logger.info(`ALCops version: ${alcopsVersion}`);

    const resolved = await resolveVersion(alcopsVersion, logger);
    logger.info(`Resolved ALCops version: ${resolved.version}`);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alcops-'));
    try {
        const nupkgPath = await downloadPackage(
            resolved.version,
            tmpDir,
            logger,
            resolved.packageContentUrl,
        );

        const { files, actualTfm } = await extractAnalyzers(
            nupkgPath,
            tfm,
            options.outputDir,
            logger,
        );

        logger.info(`Download complete. ${files.length} analyzer(s) extracted.`);

        return {
            version: resolved.version,
            tfm: actualTfm,
            outputDir: path.resolve(options.outputDir),
            files: files.map((f) => path.resolve(f)),
        };
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        logger.debug(`Cleaned up temp directory: ${tmpDir}`);
    }
}

async function resolveTfm(options: DownloadOptions, logger: Logger): Promise<string> {
    if (options.tfm) {
        logger.info(`Using explicit TFM: ${options.tfm}`);
        return options.tfm;
    }

    if (!options.detectSource) {
        throw new Error(
            'Either --tfm or --detect-using is required. ' +
            'Run "alcops download --help" for usage.',
        );
    }

    const detectSource = options.detectFrom
        ? { source: options.detectFrom, input: options.detectSource }
        : await resolveDetectSource(options.detectSource, logger);

    logger.info(`Detection source: ${detectSource.source} (input: ${detectSource.input})`);

    return detectTfm(detectSource.source, detectSource.input, logger);
}

async function detectTfm(source: DetectSource, input: string, logger: Logger): Promise<string> {
    switch (source) {
        case 'bc-artifact': {
            const result = await detectFromBCArtifact(input, logger);
            return result.tfm;
        }
        case 'marketplace': {
            const result = await detectFromMarketplace(input, logger);
            return result.tfm;
        }
        case 'nuget-devtools': {
            const result = await detectFromNuGetDevTools(input, logger);
            return result.tfm;
        }
        case 'compiler-path': {
            const result = await detectFromCompilerPath(input, logger);
            return result.tfm;
        }
        default:
            throw new Error(`Unknown detection source: ${source as string}`);
    }
}
