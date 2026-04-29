import { createConsoleLogger } from './logger';
import { detectFromBCArtifact } from './detectors/bc-artifact';
import { detectFromMarketplace } from './detectors/marketplace';
import { detectFromNuGetDevTools } from './detectors/nuget-devtools';
import { detectFromCompilerPath } from './detectors/compiler-path';
import { executeDownload } from './download/download-command';
import { executeDevToolsExtract, ExtractSource } from './devtools/extract-command';
import { executeDecompile, DEFAULT_ASSEMBLIES } from './devtools/decompile-command';
import type { DetectSource } from './resolve-detect-source';

function usage(): void {
    process.stderr.write(`
Usage: alcops <command> [args]

Commands:
  detect-tfm bc-artifact <url>         Detect TFM from a BC artifact URL
  detect-tfm marketplace [channel|version]     Detect TFM from VS Marketplace (default: current)
  detect-tfm nuget-devtools [version|channel]  Detect TFM from NuGet DevTools (default: latest)
  detect-tfm compiler-path <dir>       Detect TFM from a local compiler directory
  download --output <dir>               Download and extract ALCops analyzers
  devtools extract --source <src> --output <dir>   Download and extract BC DevTools
  devtools decompile --input <dir> --output <dir>  Decompile DLLs using ILSpy

Download options:
  --output <dir>                       Required. Directory to extract analyzer DLLs into
  --detect-using <input>               TFM detection input (URL, path, channel, or version)
  --tfm <tfm>                          Explicit TFM (skips auto-detection)
  --version <ver>                      ALCops package version (default: latest)
  --detect-from <source>               Force detection source (bc-artifact, marketplace,
                                         nuget-devtools, compiler-path)

Devtools extract options:
  --source <nuget|vsix>                Required. Package source
  --version <ver|channel>              Version or channel (default: latest)
  --tfm <tfm>                          Target framework (required for nuget)
  --output <dir>                       Required. Output directory
  --include <glob>                     Filter extracted files (e.g. "*.dll")

Devtools decompile options:
  --input <dir>                        Required. Directory containing DLLs
  --output <dir>                       Required. Output directory for decompiled projects
  --assemblies <list>                  Comma-separated assembly names (has defaults)
  --keep-tool                          Don't clean up ilspycmd after decompilation

Global options:
  --verbose   Enable debug-level logging
  --help      Show this help message

Output: JSON on stdout, logs on stderr.
`);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const verbose = args.includes('--verbose');
    const filteredArgs = args.filter((a) => a !== '--verbose');
    const logger = createConsoleLogger(verbose);

    if (filteredArgs.length === 0 || filteredArgs.includes('--help')) {
        usage();
        process.exit(filteredArgs.includes('--help') ? 0 : 1);
    }

    const command = filteredArgs[0];

    if (command === 'detect-tfm') {
        const subcommand = filteredArgs[1];
        if (!subcommand) {
            process.stderr.write('Error: detect-tfm requires a subcommand\n');
            usage();
            process.exit(1);
        }

        let result;
        switch (subcommand) {
            case 'bc-artifact': {
                const url = filteredArgs[2];
                if (!url) {
                    process.stderr.write('Error: bc-artifact requires a URL argument\n');
                    process.exit(1);
                }
                result = await detectFromBCArtifact(url, logger);
                break;
            }
            case 'marketplace': {
                const channel = filteredArgs[2] || 'current';
                result = await detectFromMarketplace(channel, logger);
                break;
            }
            case 'nuget-devtools': {
                const version = filteredArgs[2] || 'latest';
                result = await detectFromNuGetDevTools(version, logger);
                break;
            }
            case 'compiler-path': {
                const dir = filteredArgs[2];
                if (!dir) {
                    process.stderr.write('Error: compiler-path requires a directory argument\n');
                    process.exit(1);
                }
                result = await detectFromCompilerPath(dir, logger);
                break;
            }
            default:
                process.stderr.write(`Error: Unknown detect-tfm subcommand: ${subcommand}\n`);
                usage();
                process.exit(1);
        }

        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else if (command === 'download') {
        const downloadArgs = filteredArgs.slice(1);
        const outputDir = getFlagValue(downloadArgs, '--output');
        const tfm = getFlagValue(downloadArgs, '--tfm');
        const version = getFlagValue(downloadArgs, '--version');
        const detectFrom = getFlagValue(downloadArgs, '--detect-from') as DetectSource | undefined;
        const detectSource = getFlagValue(downloadArgs, '--detect-using');

        if (!outputDir) {
            process.stderr.write('Error: --output <dir> is required for the download command\n');
            usage();
            process.exit(1);
        }

        if (detectFrom && !isValidDetectSource(detectFrom)) {
            process.stderr.write(
                `Error: Invalid --detect-from value: ${detectFrom}. ` +
                `Valid values: bc-artifact, marketplace, nuget-devtools, compiler-path\n`,
            );
            process.exit(1);
        }

        const result = await executeDownload(
            { detectSource, tfm, version, detectFrom, outputDir },
            logger,
        );

        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else if (command === 'devtools') {
        const subcommand = filteredArgs[1];
        if (!subcommand) {
            process.stderr.write('Error: devtools requires a subcommand (extract, decompile)\n');
            usage();
            process.exit(1);
        }

        const subArgs = filteredArgs.slice(2);

        if (subcommand === 'extract') {
            const source = getFlagValue(subArgs, '--source') as ExtractSource | undefined;
            const version = getFlagValue(subArgs, '--version') ?? 'latest';
            const tfm = getFlagValue(subArgs, '--tfm');
            const outputDir = getFlagValue(subArgs, '--output');
            const includePattern = getFlagValue(subArgs, '--include');

            if (!source || !isValidExtractSource(source)) {
                process.stderr.write(
                    'Error: --source <nuget|vsix> is required for devtools extract\n',
                );
                process.exit(1);
            }
            if (!outputDir) {
                process.stderr.write('Error: --output <dir> is required for devtools extract\n');
                process.exit(1);
            }

            const result = await executeDevToolsExtract(
                { source, version, tfm, outputDir, includePattern },
                logger,
            );
            process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else if (subcommand === 'decompile') {
            const inputDir = getFlagValue(subArgs, '--input');
            const outputDir = getFlagValue(subArgs, '--output');
            const assembliesStr = getFlagValue(subArgs, '--assemblies');
            const keepTool = subArgs.includes('--keep-tool');

            if (!inputDir) {
                process.stderr.write('Error: --input <dir> is required for devtools decompile\n');
                process.exit(1);
            }
            if (!outputDir) {
                process.stderr.write('Error: --output <dir> is required for devtools decompile\n');
                process.exit(1);
            }

            const assemblies = assembliesStr
                ? assembliesStr.split(',').map((a) => a.trim())
                : DEFAULT_ASSEMBLIES;

            const result = await executeDecompile(
                { inputDir, outputDir, assemblies, keepTool },
                logger,
            );
            process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else {
            process.stderr.write(`Error: Unknown devtools subcommand: ${subcommand}\n`);
            usage();
            process.exit(1);
        }
    } else {
        process.stderr.write(`Error: Unknown command: ${command}\n`);
        usage();
        process.exit(1);
    }
}

function getFlagValue(args: string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) return undefined;
    return args[idx + 1];
}

const VALID_DETECT_SOURCES = new Set(['bc-artifact', 'marketplace', 'nuget-devtools', 'compiler-path']);

function isValidDetectSource(value: string): value is DetectSource {
    return VALID_DETECT_SOURCES.has(value);
}

const VALID_EXTRACT_SOURCES = new Set(['nuget', 'vsix']);

function isValidExtractSource(value: string): value is ExtractSource {
    return VALID_EXTRACT_SOURCES.has(value);
}

main().catch((err) => {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
