import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { Logger, nullLogger } from '../logger';

export const DEFAULT_ASSEMBLIES = [
    'Microsoft.Dynamics.Nav.AL.Common',
    'Microsoft.Dynamics.Nav.Analyzers.Common',
    'Microsoft.Dynamics.Nav.AppSourceCop',
    'Microsoft.Dynamics.Nav.CodeAnalysis',
    'Microsoft.Dynamics.Nav.CodeAnalysis.Workspaces',
    'Microsoft.Dynamics.Nav.CodeCop',
    'Microsoft.Dynamics.Nav.PerTenantExtensionCop',
    'Microsoft.Dynamics.Nav.UICop',
];

export interface DecompileOptions {
    inputDir: string;
    outputDir: string;
    assemblies: string[];
    keepTool: boolean;
}

export interface AssemblyResult {
    name: string;
    status: 'success' | 'failed';
    outputDir?: string;
    error?: string;
}

export interface DecompileResult {
    succeeded: number;
    failed: number;
    total: number;
    outputDir: string;
    assemblies: AssemblyResult[];
}

/**
 * Decompile .NET assemblies using ILSpy CLI (ilspycmd).
 * Requires the .NET SDK to be installed.
 */
export async function executeDecompile(
    options: DecompileOptions,
    logger: Logger = nullLogger,
): Promise<DecompileResult> {
    const { inputDir, outputDir, assemblies, keepTool } = options;

    if (!fs.existsSync(inputDir)) {
        throw new Error(`Input directory not found: ${inputDir}`);
    }

    const dotnetPath = findDotnet();
    logger.info(`Found dotnet: ${dotnetPath}`);

    const toolPath = path.join(os.tmpdir(), `ilspycmd-${Date.now()}`);
    const ilspycmd = path.join(toolPath, process.platform === 'win32' ? 'ilspycmd.exe' : 'ilspycmd');

    try {
        installIlSpy(dotnetPath, toolPath, logger);
        verifyIlSpy(ilspycmd, logger);

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const results: AssemblyResult[] = [];
        let succeeded = 0;
        let failed = 0;

        for (const assembly of assemblies) {
            const dllPath = path.join(inputDir, `${assembly}.dll`);

            if (!fs.existsSync(dllPath)) {
                logger.warn(`DLL not found, skipping: ${dllPath}`);
                results.push({ name: assembly, status: 'failed', error: 'DLL not found' });
                failed++;
                continue;
            }

            const assemblyOutputDir = path.join(outputDir, assembly);

            // Clean previous output for idempotency
            if (fs.existsSync(assemblyOutputDir)) {
                fs.rmSync(assemblyOutputDir, { recursive: true, force: true });
            }

            logger.info(`Decompiling ${assembly}...`);

            try {
                execFileSync(ilspycmd, [dllPath, '-p', '-o', assemblyOutputDir, '--nested-directories'], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    timeout: 120_000,
                });
                logger.info(`  -> ${assemblyOutputDir}`);
                results.push({
                    name: assembly,
                    status: 'success',
                    outputDir: path.resolve(assemblyOutputDir),
                });
                succeeded++;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.warn(`Failed to decompile ${assembly}: ${msg}`);
                results.push({ name: assembly, status: 'failed', error: msg });
                failed++;
            }
        }

        return {
            succeeded,
            failed,
            total: assemblies.length,
            outputDir: path.resolve(outputDir),
            assemblies: results,
        };
    } finally {
        if (!keepTool && fs.existsSync(toolPath)) {
            logger.debug(`Cleaning up ilspycmd from ${toolPath}`);
            fs.rmSync(toolPath, { recursive: true, force: true });
        }
    }
}

function findDotnet(): string {
    const dotnetCmd = process.platform === 'win32' ? 'dotnet.exe' : 'dotnet';
    try {
        execFileSync(dotnetCmd, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
        return dotnetCmd;
    } catch {
        throw new Error(
            'dotnet SDK not found in PATH. Install the .NET SDK (https://dot.net/download) ' +
            'to use the decompile command.',
        );
    }
}

function installIlSpy(dotnetPath: string, toolPath: string, logger: Logger): void {
    logger.info(`Installing ilspycmd to ${toolPath}...`);
    try {
        execFileSync(
            dotnetPath,
            ['tool', 'install', 'ilspycmd', '--tool-path', toolPath],
            { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 },
        );
        logger.info('ilspycmd installed.');
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to install ilspycmd: ${msg}`);
    }
}

function verifyIlSpy(ilspycmdPath: string, logger: Logger): void {
    try {
        const output = execFileSync(ilspycmdPath, ['--version'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        logger.debug(`ilspycmd version: ${output.toString().trim()}`);
    } catch {
        throw new Error(
            `ilspycmd is not functional at ${ilspycmdPath}. ` +
            'Try running the command again.',
        );
    }
}
