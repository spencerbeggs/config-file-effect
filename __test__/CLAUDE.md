# Test Directory

This project uses `@savvy-web/vitest` for test discovery. Tests live here in
`__test__/`, not co-located in `src/`.

## Directory Structure

```text
__test__/
  utils/              # Shared mocks, helpers, and type utilities for unit tests
  fixtures/           # Static test data and fixture files for unit tests
  codecs.test.ts      # Unit: JsonCodec, TomlCodec parse/stringify/metadata
  errors.test.ts      # Unit: ConfigError, CodecError _tag and message
  events.test.ts      # Unit: ConfigEvent, ConfigEventPayload schema
  migrations.test.ts  # Unit: ConfigMigration codec wrapper
  strategies.test.ts  # Unit: FirstMatch, LayeredMerge

  e2e/
    utils/            # Shared mocks, helpers, and type utilities for e2e tests
    fixtures/         # Static test data and fixture files for e2e tests
    *.e2e.test.ts     # End-to-end tests

  integration/
    utils/            # Shared mocks, helpers, and type utilities for integration tests
    fixtures/         # Static test data and fixture files for integration tests
    config-file.int.test.ts   # Full service pipeline, validate hook, Test layer
    events.int.test.ts        # ConfigEvents PubSub integration
    git-root.int.test.ts      # GitRoot resolver with .git dir/file/subpaths
    resolvers.int.test.ts     # ExplicitPath, StaticDir, UpwardWalk, WorkspaceRoot
    watcher.int.test.ts       # ConfigWatcher polling and change detection
```

## Rules

- **Classification is by filename, not location.** `*.e2e.test.ts` is always
  e2e regardless of which directory it sits in. Same for `*.int.test.ts`.
- **`utils/` and `fixtures/` are excluded from test discovery.** Put shared
  mocks, test helpers, builder functions, and type utilities in `utils/`. Put
  static data (JSON, fixtures, sample files) in `fixtures/`.
- **Each test category has its own `utils/` and `fixtures/`.** Unit test
  helpers go in `__test__/utils/`, e2e helpers go in `__test__/e2e/utils/`,
  etc. Do not share helpers across categories — their setup needs differ.
- **Never put test files in `src/`.** All tests belong in `__test__/`.
- **Never inline large test data in test files.** Extract it to `fixtures/`.
- **Never define shared mocks or helper functions in test files.** Extract them
  to the appropriate `utils/` directory so other tests can reuse them.
