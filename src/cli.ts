import { createConsoleLogger } from './logger';
import { detectFromBCArtifact } from './detectors/bc-artifact';
import { detectFromMarketplace } from './detectors/marketplace';
import { detectFromNuGetDevTools } from './detectors/nuget-devtools';
import { detectFromCompilerPath } from './detectors/compiler-path';

const logger = createConsoleLogger();

function usage(): void {
    process.stderr.write(`
Usage: alcops <command> [args]

Commands:
  detect-tfm bc-artifact <url>         Detect TFM from a BC artifact URL
  detect-tfm marketplace [channel]     Detect TFM from VS Marketplace (default: current)
  detect-tfm nuget-devtools [version]  Detect TFM from NuGet DevTools (default: latest)
  detect-tfm compiler-path <dir>       Detect TFM from a local compiler directory

Options:
  --help    Show this help message

Output: JSON on stdout, logs on stderr.
`);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('--help')) {
        usage();
        process.exit(args.includes('--help') ? 0 : 1);
    }

    const command = args[0];

    if (command === 'detect-tfm') {
        const subcommand = args[1];
        if (!subcommand) {
            process.stderr.write('Error: detect-tfm requires a subcommand\n');
            usage();
            process.exit(1);
        }

        let result;
        switch (subcommand) {
            case 'bc-artifact': {
                const url = args[2];
                if (!url) {
                    process.stderr.write('Error: bc-artifact requires a URL argument\n');
                    process.exit(1);
                }
                result = await detectFromBCArtifact(url, logger);
                break;
            }
            case 'marketplace': {
                const channel = args[2] || 'current';
                result = await detectFromMarketplace(channel, logger);
                break;
            }
            case 'nuget-devtools': {
                const version = args[2] || 'latest';
                result = await detectFromNuGetDevTools(version, logger);
                break;
            }
            case 'compiler-path': {
                const dir = args[2];
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
    } else {
        process.stderr.write(`Error: Unknown command: ${command}\n`);
        usage();
        process.exit(1);
    }
}

main().catch((err) => {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
