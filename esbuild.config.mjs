import * as esbuild from 'esbuild';

const isProduction = process.argv.includes('--production');

/** @type {import('esbuild').BuildOptions} */
const sharedOptions = {
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    sourcemap: !isProduction,
    minify: isProduction,
    logLevel: 'info',
    external: [],
};

await Promise.all([
    // Library entry point
    esbuild.build({
        ...sharedOptions,
        entryPoints: ['src/index.ts'],
        outfile: 'dist/index.js',
    }),
    // CLI entry point
    esbuild.build({
        ...sharedOptions,
        entryPoints: ['src/cli.ts'],
        outfile: 'dist/cli.js',
        banner: {
            js: '#!/usr/bin/env node',
        },
    }),
]);
