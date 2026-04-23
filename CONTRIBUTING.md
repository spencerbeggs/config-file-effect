# Contributing to config-file-effect

Thank you for your interest in contributing to config-file-effect! This document
provides guidelines and instructions for development.

## Prerequisites

- Node.js 24+
- pnpm 10+

## Development Setup

```bash
# Clone the repository
git clone https://github.com/spencerbeggs/config-file-effect.git
cd config-file-effect

# Install dependencies
pnpm install

# Run tests
pnpm run test

# Build all outputs
pnpm run build
```

## Project Structure

```text
config-file-effect/
├── src/
│   ├── index.ts              # Single barrel export
│   ├── codecs/               # Pluggable config file format parsers
│   ├── errors/               # Data.TaggedError types
│   ├── layers/               # Layer.Layer implementations
│   ├── resolvers/            # Config file location strategies
│   ├── services/             # Context.Tag service interfaces
│   └── strategies/           # Config resolution merge strategies
├── __test__/                 # Test files
├── docs/                     # User-facing guides
└── lib/configs/              # Shared tool configurations
```

## Available Scripts

| Script | Description |
| ------ | ----------- |
| `pnpm run build` | Build dev + prod outputs via Turbo |
| `pnpm run test` | Run all tests |
| `pnpm run test:watch` | Run tests in watch mode |
| `pnpm run test:coverage` | Run tests with v8 coverage |
| `pnpm run lint` | Check code with Biome |
| `pnpm run lint:fix` | Auto-fix lint issues |
| `pnpm run lint:md` | Check markdown with markdownlint |
| `pnpm run typecheck` | Type-check via tsgo |

## Code Quality

This project uses:

- **Biome** for linting and formatting
- **Commitlint** for enforcing conventional commits with DCO signoff
- **Husky** for Git hooks
- **markdownlint** for markdown files

### Commit Format

All commits must follow the
[Conventional Commits](https://conventionalcommits.org) specification and
include a DCO signoff:

```text
feat(resolver): add custom config resolver

Signed-off-by: Your Name <your.email@example.com>
```

### Pre-commit Hooks

The following checks run automatically:

- **pre-commit**: Runs lint-staged (Biome on staged files)
- **commit-msg**: Validates commit message format via commitlint
- **pre-push**: Runs tests for affected packages

## Testing

Tests use [Vitest](https://vitest.dev) with v8 coverage and the `forks` pool.

```bash
# Run all tests
pnpm run test

# Run tests in watch mode
pnpm run test:watch

# Run tests with coverage
pnpm run test:coverage

# Run a specific test file
pnpm vitest run __test__/config-file.test.ts
```

## TypeScript

- Strict mode with `strictNullChecks` and `exactOptionalPropertyTypes`
- ES2023 target, NodeNext module resolution
- `verbatimModuleSyntax` enabled

### Import Conventions

```typescript
// Use .js extensions for relative imports (ESM requirement)
import { makeConfigFileLiveImpl } from "./layers/ConfigFileLive.js";

// Use node: protocol for Node.js built-ins
import { dirname } from "node:path";

// Separate type imports
import type { ConfigCodec } from "./codecs/ConfigCodec.js";
```

## Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run tests: `pnpm run test`
5. Run linting: `pnpm run lint:fix`
6. Commit with conventional format and DCO signoff
7. Push and open a pull request

## Documentation

User-facing documentation lives in `docs/`. If your change modifies the public
API (new exports, changed signatures, new services), update the relevant guide.

## License

By contributing, you agree that your contributions will be licensed under the
MIT License.
