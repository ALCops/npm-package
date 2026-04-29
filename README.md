# @alcops/core

[![CI](https://github.com/ALCops/npm-package/actions/workflows/ci.yml/badge.svg)](https://github.com/ALCops/npm-package/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@alcops/core)](https://www.npmjs.com/package/@alcops/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Automatically detect the Target Framework Moniker (TFM) for Business Central and download the matching code analyzer files. Build AL extensions with the right analyzers, without manual version juggling. Designed for CI/CD pipelines.

## Features

- Detect the TFM from four different sources:
  - **BC artifact URL** (e.g. a sandbox or OnPrem artifact)
  - **VS Marketplace** (the AL Language extension)
  - **NuGet DevTools** (Microsoft's AL development tools package)
  - **Local compiler path** (a directory containing the AL compiler DLLs)
- **Download and extract** ALCops analyzer DLLs for a detected TFM
- JSON output on stdout, logs on stderr (pipe-friendly)
- Zero configuration required
- Usable as a CLI or as a Node.js library

## Installation

```bash
# Install globally
npm install -g @alcops/core

# Or run directly with npx
npx @alcops/core detect-tfm marketplace
```

## Requirements

- Node.js >= 20

## CLI Usage

```
alcops <command> [args]

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
```

### Examples

Detect from the VS Marketplace (most common):

```bash
alcops detect-tfm marketplace
```

Detect from a specific NuGet DevTools version:

```bash
alcops detect-tfm nuget-devtools 26.0.12345
```

Detect from a BC artifact URL:

```bash
alcops detect-tfm bc-artifact "https://bcartifacts.azureedge.net/sandbox/26.0.12345.0/us"
```

Detect from a local compiler directory:

```bash
alcops detect-tfm compiler-path ./path/to/compiler
```

### Download Command

The `download` command combines TFM detection with analyzer extraction in a single step.

Download analyzers with auto-detected TFM from the latest NuGet DevTools:

```bash
alcops download --detect-using latest --output ./analyzers
```

Download analyzers with auto-detected TFM from a BC artifact URL:

```bash
alcops download --detect-using "https://bcartifacts.azureedge.net/sandbox/26.0.12345.0/us" --output ./analyzers
```

Download analyzers with auto-detected TFM from a local compiler directory:

```bash
alcops download --detect-using ./path/to/compiler --output ./analyzers
```

Download analyzers with an explicit TFM (skips detection):

```bash
alcops download --tfm net8.0 --output ./analyzers
```

Download a specific ALCops version:

```bash
alcops download --detect-using latest --output ./analyzers --version 1.0.0
```

Force a detection source with `--detect-from` (overrides smart routing):

```bash
alcops download --detect-using 18.0.2293710 --detect-from marketplace --output ./analyzers
```

Enable verbose logging for debugging:

```bash
alcops download --detect-using latest --output ./analyzers --verbose
```

#### Download Output

```json
{
  "version": "1.0.0",
  "tfm": "net8.0",
  "outputDir": "/absolute/path/to/analyzers",
  "files": [
    "/absolute/path/to/analyzers/ALCops.Analyzers.dll"
  ]
}
```

### Output

All commands write JSON to stdout:

```json
{
  "tfm": "net8.0",
  "source": "marketplace",
  "details": "AL Language extension v14.0.12345"
}
```

Logs go to stderr, so you can safely pipe the result:

```bash
TFM=$(alcops detect-tfm marketplace | jq -r '.tfm')
echo "Building with TFM: $TFM"
```

### CI/CD Example (GitHub Actions)

```yaml
- name: Detect TFM
  id: tfm
  run: |
    result=$(npx @alcops/core detect-tfm marketplace)
    echo "tfm=$(echo "$result" | jq -r '.tfm')" >> "$GITHUB_OUTPUT"

- name: Use TFM
  run: echo "Target framework is ${{ steps.tfm.outputs.tfm }}"
```

Or use the `download` command for a one-step solution:

```yaml
- name: Download ALCops Analyzers
  run: npx @alcops/core download --detect-using latest --output ./analyzers --verbose
```

## Programmatic API

The package exports all detection functions for use as a library:

```typescript
import { detectFromMarketplace, createConsoleLogger } from '@alcops/core';

const logger = createConsoleLogger();
const result = await detectFromMarketplace('current', logger);
console.log(result.tfm); // e.g. "net8.0"
```

See the [exported API surface](./src/index.ts) for the full list of available functions and types.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and contribution guidelines.

## License

[MIT](./LICENSE)
