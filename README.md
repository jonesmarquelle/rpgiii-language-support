# RPG-III Language Support

VSCode extension providing language support for IBM RPG-III (fixed-format) source files.

## Features

### Syntax Highlighting

Full tokenization of the RPG-III 80-column fixed-format spec structure:

- **Spec type letters** — `H`, `F`, `E`, `L`, `I`, `C`, `O` in column 6
- **F-spec** — filename, file type/designation, device keyword (`DISK`, `WORKSTN`, `PRINTER`, etc.)
- **E-spec** — array/table names
- **I-spec** — data structure names, field names, data type codes (`P`, `B`, `L`, `R`)
- **C-spec** — control level indicators, opcodes (structured control flow, operators), factor 1/2, result field, resulting indicators
- **Opcodes** — structured operations (`IFEQ`, `DOWGT`, etc.) and all standard RPG-III opcodes highlighted by kind (control, operator). Correctly tokenized even when a 5-character opcode fills its field with no trailing space (`MOVEAHIND`, `CHAINSUBFL`)
- **Numeric literals** — in factor 1 and factor 2 positions get `constant.numeric` scope, taking priority over the variable scope
- **System constants** — `*BLANKS`, `*ZERO`, `*HIVAL`, `*LOVAL`, `*ON`, `*OFF`, `*IN`, `UDATE`, etc.
- **Indicators** — `*IN`, `*IN01`–`*IN99`
- **Strings** — single-quoted literals and hex (`X'...'`) literals
- **Comments** — spec comment lines (col 7 = `*`) and trailing comments past the usable columns
- **Embedded SQL** — `/EXEC SQL ... /END-EXEC` blocks with inner SQL syntax highlighting
- **Compile-time data** — `**` delimited array data blocks
- **Precompiler directives** — `/COPY`, `/TITLE`, `/EJECT`, `/SPACE`

---

### Go-to-Definition (`F12` / `Ctrl+Click`)

Context-aware navigation understands which fixed-column field the cursor is in and what the opcode expects:

| Cursor location | Resolves to |
|---|---|
| Subroutine name in `EXSR` / `CAS*` Factor 2 | `BEGSR` line |
| Subroutine name in `BEGSR` / `ENDSR` Factor 1 | `BEGSR` line |
| Tag name in `GOTO` / `CAB*` Factor 2 | `TAG` line |
| File name in `CHAIN`, `READ`, `WRITE`, `SETLL`, etc. | F-spec line |
| Array name (e.g. `PATH` in `PATH,X`) | E-spec line |
| Array index (e.g. `X` in `PATH,X`) | Variable declaration |
| DS field or record field | I-spec definition line |
| C-spec variable (result field with a field length) | Most recent assignment at or before the cursor line |

---

### Hover Information

Hovering over any recognized symbol shows a tooltip:

- **Files** — type (Input/Output/Update/Combined), device, designation, format
- **Arrays** — entry count, entry length, decimal positions, data type
- **Fields** (I-spec) — parent data structure, from/to positions, length, data type
- **Variables** (C-spec) — declared at line N, declaring opcode
- **Subroutines** — defined at / ends at line number
- **Tags** — defined at line number

---

### Code Folding

Click the fold gutter to collapse:

- **Structured blocks** — `IF`/`ENDIF`, `DO`/`ENDDO`, `DOW`/`ENDDO`, `DOU`/`ENDDO`, `SELEC`/`ENDSL`
- **Subroutines** — `BEGSR`/`ENDSR` pairs

---

### Document Outline

The Explorer **Outline** panel is populated with all symbols extracted from the file, grouped by kind:

- **Files** — with type and device detail
- **Arrays** — with entry length × count
- **Data Structures** — expandable with subfields showing from–to positions
- **Subroutines** — spanning their full `BEGSR`–`ENDSR` range
- **Tags** — all `TAG` opcode labels

---

## File Association

Files with the `.rpg` or `.RPG` extension are automatically associated with the `rpg` language.

---

## Fixed-Column Layout Reference

The parser uses the standard RPG-III 80-column spec layout (0-based columns):

| Columns | F-spec | E-spec | I-spec | C-spec |
|---|---|---|---|---|
| 0–4 | Sequence/page | Sequence/page | Sequence/page | Sequence/page |
| 5 | `F` | `E` | `I` | `C` |
| 6–13 | Filename (8) | Related file (8) | Filename (8) | — |
| 6–7 | — | — | — | Control level (2) |
| 8–16 | — | — | — | Conditioning indicators N01/N02/N03 |
| 17–26 | — | — | — | Factor 1 (10) |
| 26–31 | — | Array name (6) | — | — |
| 27–31 | — | — | — | Opcode (5) |
| 32–41 | — | — | — | Factor 2 (10) |
| 36–38 | — | Entries per table (3) | — | — |
| 39–41 | — | Entry length (3) | — | — |
| 42–47 | — | — | — | Result field (6) |
| 48–50 | — | — | — | Field length (3) |
| 52–57 | — | — | Field name (6) | — |
| 53–58 | — | — | — | Resulting indicators (HI/LO/EQ) |
