import { createConsoleLogger } from './logger';
import { detectFromBCArtifact } from './detectors/bc-artifact';
import { detectFromMarketplace } from './detectors/marketplace';
import { detectFromNuGetDevTools } from './detectors/nuget-devtools';
import { detectFromCompilerPath } from './detectors/compiler-path';
import { executeDownload } from './download/download-command';
import type { DetectSource } from './resolve-detect-source';

function usage(): void {
    process.stderr.write(`
Usage: alcops <command> [args]

Commands:
  detect-tfm bc-artifact <url>         Detect TFM from a BC artifact URL
  detect-tfm marketplace [channel]     Detect TFM from VS Marketplace (default: current)
  detect-tfm nuget-devtools [version]  Detect TFM from NuGet DevTools (default: latest)
  detect-tfm compiler-path <dir>       Detect TFM from a local compiler directory
  download --output <dir>               Download and extract ALCops analyzers

Download options:
  --output <dir>                       Required. Directory to extract analyzer DLLs into
  --detect-using <input>               TFM detection input (URL, path, channel, or version)
  --tfm <tfm>                          Explicit TFM (skips auto-detection)
  --version <ver>                      ALCops package version (default: latest)
  --detect-from <source>               Force detection source (bc-artifact, marketplace,
                                         nuget-devtools, compiler-path)

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

main().catch((err) => {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
