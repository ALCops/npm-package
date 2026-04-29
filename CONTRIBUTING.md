# Contributing to @alcops/core

Thanks for your interest in contributing! This document explains how to get started.

## Getting Started

1. Fork the repository and clone your fork:

   ```bash
   git clone https://github.com/<your-username>/npm-package.git
   cd npm-package
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Verify everything works:

   ```bash
   npm test
   ```

## Development Workflow

1. Create a branch from `main`:

   ```bash
   git checkout -b feature/my-change
   ```

2. Make your changes and ensure the checks pass:

   ```bash
   npm run lint      # ESLint
   npm test          # Vitest
   npm run build     # TypeScript compilation
   npm run bundle    # esbuild production bundle
   ```

3. Commit your changes with a clear message.

4. Push and open a pull request against `main`.

## Available Scripts

| Script | Purpose |
|--------|---------|
| `npm run lint` | Run ESLint on `src/` |
| `npm test` | Run tests with Vitest |
| `npm run test:watch` | Run tests in watch mode |
| `npm run build` | Compile TypeScript |
| `npm run bundle` | Build production bundle with esbuild |

## Code Style

- TypeScript in strict mode
- ESLint rules are enforced via `npm run lint`
- CI runs lint, tests, build, and bundle on every pull request

## Pull Request Guidelines

- Open an issue first for large or breaking changes so we can discuss the approach.
- Keep PRs focused on a single change.
- Add tests for new functionality.
- CI must pass before a PR can be merged.

## Releases

Releases are automated. When changes are merged to `main`, the maintainers trigger a release workflow that versions the package with [GitVersion](https://gitversion.net/), publishes to npm, and creates a GitHub Release.
