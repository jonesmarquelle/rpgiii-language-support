# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run compile       # One-time TypeScript build (outputs to out/)
npm run watch         # Watch mode for incremental compilation
```

There are no tests. The `.gitignore` has a `test/` placeholder but no test infrastructure exists.

To package the extension manually:
```bash
npx @vscode/vsce package
```

Releases are triggered manually via `.github/workflows/release.yml`, which bumps the minor version, tags, packages, creates a GitHub release, and publishes to the VS Code Marketplace using the `VSCE_PAT` secret.

## Architecture Overview

This is a VS Code extension providing language features for IBM RPG-III (fixed-format, 80-column) source files.

### Data Flow

```
TextDocument → parseDocument() → RpgDocument (cached) → Language Providers
```

All six language providers share a single `documentCache` singleton (`src/parser/rpgDocument.ts`). The cache is version-aware — it re-parses only when `TextDocument.version` changes. Cache is invalidated on document change and close events registered in `activate()`.

### Parser (`src/parser/`)

`rpgParser.ts` runs a **single-pass** parser over all lines:
- Classifies each line by the character in column 5 (0-indexed) into `SpecType` (F/E/I/C/H/L/O/comment/directive/compile-time data)
- Delegates to per-spec parsers in `lineParser.ts`: `parseFSpec`, `parseESpec`, `parseISpec`, `parseCSpec`
- Builds a `SymbolTable` with maps for files, arrays, fields, variables, subroutines, tags, klists, and kfields
- Tracks stateful context (current data structure, current KLIST, pending BEGSR stack for subroutine folding)

All column parsing uses 0-based slicing via helpers in `src/types/rpgTypes.ts`: `colSlice`, `colTrim`, `colChar`, `wordAtColumn`. The fixed-column layout for each spec type is documented in the README.

### Language Providers (`src/providers/`)

Each provider calls `documentCache.get(document)` then reads from the resulting `SymbolTable`. They do not re-parse.

- **`definitionProvider.ts`** — Uses `cspecSymbolKind()` from `src/parser/cspecContext.ts` to resolve an opcode + cursor field (Factor 1 [17..27], Factor 2 [32..42], Result [42..48]) to a specific symbol kind. Falls back to a symbol-table scan for non-C-spec positions.
- **`referenceProvider.ts`** — Determines the symbol kind the same way, then scans all lines for matching identifiers. Uses `fieldMatchRange()` to strip array subscripts (e.g., `ARR,5` → `ARR`).
- **`semanticTokenProvider.ts`** — Priority-based token coloring; opcode context determines whether a Factor 1/2 token is colored as `function` (subroutine), `parameter` (tag), `type` (file/array), or `variable`.
- **`foldingProvider.ts`** — Stack-based; pushes opcodes in `FOLD_OPENERS` and pops on `FOLD_CLOSERS` / generic `END`. Also folds contiguous spec-type sections (all F-specs, all I-specs, etc.).
- **`hoverProvider.ts`** — Uses `resolveSymbolAt()` from `providerUtils.ts` to extract the word respecting C-spec field boundaries, then formats a tooltip from the `SymbolTable`.
- **`documentSymbolProvider.ts`** — Groups symbols into six top-level containers (Files, Arrays, Data Structures, Subroutines, Tags); DS symbols are expandable with subfields.

Shared helpers:
- `src/parser/opcodes.ts` — all opcode classification sets + `baseOpcode()`.
- `src/parser/cspecContext.ts` — `cspecFieldAt()`, `wordAtCspec()`, `cspecSymbolKind()`.
- `src/providers/providerUtils.ts` — `resolveSymbolAt()` (word-at-cursor respecting C-spec fields) and `closestVariableDef()` (walk-back for multi-declared variables).

### Key Conventions

- **Opcodes** are always uppercased and 5 characters wide in the source. `baseOpcode()` in `src/parser/opcodes.ts` strips trailing condition letters (e.g., `IFEQ` → `IF`, `DOUGE` → `DOU`) for control-flow classification.
- **Opcode sets** (`FILE_OPS`, `SR_OPS_F1`, `SR_OPS_F2`, `GOTO_OPS`, `KLIST_OPS_F1`, `FOLD_OPENERS`, `FOLD_CLOSERS`) are the single source of truth in `src/parser/opcodes.ts` — update them there when adding support for a new opcode and every provider picks it up.
- **Variables vs. Fields**: Variables are C-spec result fields that have a field length defined (cols 48–50). Fields are I-spec declarations. They are stored in separate symbol table maps.
- **Multiple variable assignments**: The variables map stores *all* occurrences in source order. Go-to-definition walks the list and picks the last definition at or before the cursor line.
- **Indicators** (`*IN`, `*IN01`–`*IN99`) and system constants (`*BLANKS`, `*ZERO`, etc.) are explicitly skipped in definition and hover resolution.
