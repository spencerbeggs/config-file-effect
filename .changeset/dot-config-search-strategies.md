---
"config-file-effect": minor
---

## Features

### New Walk Stratagies

Add a per-level `subpaths` option to `UpwardWalk` and a new `SystemEtc` resolver. `UpwardWalk({ filename, subpaths })` checks each subpath (e.g. `[".", ".config"]`) at every directory while walking up, closest match first, enabling the dot-config (`.config/<tool>/`) convention. `SystemEtc({ app, filename, dir? })` probes `/etc/<app>/<filename>` and resolves to none on Windows.
