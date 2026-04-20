import * as vscode from 'vscode';

// ─── Spec Type Classification ──────────────────────────────────────────────

export enum SpecType {
    Header = 'H',
    File = 'F',
    Extension = 'E',
    LineCounter = 'L',
    Input = 'I',
    Calculation = 'C',
    Output = 'O',
    Comment = '*',
    Precompiler = '/',
    CompileTimeData = '**',
    Blank = ' ',
    Unknown = '?',
}

// ─── Per-Spec Parsed Content ───────────────────────────────────────────────

export interface CSpecContent {
    controlLevel: string;   // L0-L9, SR, AN, OR — cols [6..7]
    n01: string;            // conditioning indicator — cols [8..10]
    n02: string;            // cols [11..13]
    n03: string;            // cols [14..16]
    factor1: string;        // trimmed — cols [17..26]
    opcode: string;         // trimmed, uppercase — cols [27..36]
    factor2: string;        // trimmed — cols [37..46]
    resultField: string;    // trimmed — cols [47..52]
    fieldLen: string;       // cols [53..55]
    decPos: string;         // col [56]
    halfAdjust: string;     // col [57]
    hiIndicator: string;    // cols [58..59]
    loIndicator: string;    // cols [60..61]
    eqIndicator: string;    // cols [62..63]
    // Absolute char ranges within the line (for semantic tokens)
    factor1Range: [number, number];   // [start, end) exclusive
    opcodeRange: [number, number];
    factor2Range: [number, number];
    resultRange: [number, number];
}

export interface FSpecContent {
    filename: string;       // trimmed, up to 8 chars — cols [6..13]
    fileType: string;       // I/O/U/C — col [14]
    designation: string;   // P/S/R/T/F — col [15]
    eofFlag: string;        // E — col [16]
    sequence: string;       // A/D — col [17]
    format: string;         // F/E — col [18]
    recordLen: string;      // cols [19..23]
    device: string;         // DISK/WORKSTN/PRINTER/SEQ/SPECIAL — cols [38..44] approx
    isContinuation: boolean;
    filenameRange: [number, number];
}

export interface ISpecContent {
    filename: string;           // for record-format lines — cols [6..13]
    sequenceCode: string;       // cols [14..15]
    number: string;             // col [16]
    option: string;             // col [17]
    recordId: string;           // cols [18..19]
    isDataStructure: boolean;   // 'DS' at cols [18..19]
    dsOption: string;           // S (SDS) / U / I / blank
    dataType: string;           // P/B/L/R — col [42]
    fromPos: number;            // cols [43..46]
    toPos: number;              // cols [47..50]
    decPos: string;             // col [51]
    fieldName: string;          // trimmed — cols [52..57]
    controlLevel: string;       // L1-L9 — cols [58..59]
    matchingField: string;      // M1-M9 — cols [60..61]
    fieldNameRange: [number, number];
}

export interface ESpecContent {
    relatedFileName: string;    // cols [6..13]
    arrayName: string;          // trimmed — cols [17..22]
    entriesPerRecord: number;   // cols [23..25]
    entriesPerTable: number;    // cols [26..29]
    entryLength: number;        // cols [30..32]
    dataType: string;           // P/B/L/R — col [33]
    decPos: string;             // col [34]
    sequence: string;           // A/D — col [35]
    arrayNameRange: [number, number];
}

// ─── Parsed Line ───────────────────────────────────────────────────────────

export interface ParsedLine {
    lineNumber: number;     // 0-indexed (VSCode convention)
    raw: string;
    specType: SpecType;
    content: CSpecContent | FSpecContent | ISpecContent | ESpecContent | null;
}

// ─── Symbol Types ──────────────────────────────────────────────────────────

export interface BaseSymbol {
    name: string;
    definitionLine: number;         // 0-indexed
    definitionRange: vscode.Range;
}

export interface FileSymbol extends BaseSymbol {
    fileType: string;       // I/O/U/C
    designation: string;    // P/S/R/T/F
    device: string;         // DISK/WORKSTN/PRINTER/SEQ/SPECIAL
    format: string;         // F/E
}

export interface ArraySymbol extends BaseSymbol {
    entriesPerRecord: number;
    entriesPerTable: number;
    entryLength: number;
    decPos: string;
    dataType: string;
}

export interface DataStructureSymbol extends BaseSymbol {
    dsType: string;     // SDS / blank
    fields: FieldSymbol[];
}

export interface FieldSymbol extends BaseSymbol {
    fromPos: number;
    toPos: number;
    decPos: string;
    dataType: string;
    parentDsName: string;   // '' for anonymous DS
}

export interface SubroutineSymbol extends BaseSymbol {
    endLine: number;    // 0-indexed line of ENDSR
    foldRange: vscode.FoldingRange;
}

export interface TagSymbol extends BaseSymbol {
    // Defined by TAG opcode — factor1 is the tag name
}

export interface KListSymbol extends BaseSymbol {
    // Defined by KLIST opcode — factor1 is the key-list name.
    // keyFields holds the result-field names of every subsequent KFLD line.
    keyFields: string[];
}

// ─── Symbol Table ──────────────────────────────────────────────────────────

export interface SymbolTable {
    files: Map<string, FileSymbol>;
    arrays: Map<string, ArraySymbol>;
    dataStructures: DataStructureSymbol[];
    fields: Map<string, FieldSymbol>;
    variables: Map<string, FieldSymbol[]>;  // C-spec result fields; all occurrences in source order
    subroutines: Map<string, SubroutineSymbol>;
    tags: Map<string, TagSymbol>;
    klists: Map<string, KListSymbol>;
}

// ─── Parsed Document ──────────────────────────────────────────────────────

export interface RpgDocument {
    uri: string;
    lines: ParsedLine[];
    symbols: SymbolTable;
    version: number;    // matches vscode.TextDocument.version for cache invalidation
}

// ─── Helper: Safe column slice ────────────────────────────────────────────

/**
 * Safely slice a fixed-column RPG line. Returns empty string if the line is
 * shorter than expected — never throws. `start` is 0-indexed.
 */
export function colSlice(line: string, start: number, length: number): string {
    return line.substring(start, start + length);
}

/**
 * Safely get a single character at 0-indexed position. Returns '' if OOB.
 */
export function colChar(line: string, index: number): string {
    return line.charAt(index);
}

/**
 * Trim a fixed-width column value.
 */
export function colTrim(line: string, start: number, length: number): string {
    return colSlice(line, start, length).trim();
}

/**
 * Extract the identifier or numeric token at column `col` from within the
 * fixed-column field `[fieldStart, fieldEnd)`.
 *
 * Handles `$`, `#`, `@`, `*` prefix characters so `*IN`, `$VAR`, etc. are
 * returned whole. Returns `{ word, start, end }` where start/end are absolute
 * column offsets into the original line, or `null` if the cursor is not on a
 * token (e.g. sitting on a space or comma).
 */
export function wordAtColumn(
    line: string,
    col: number,
    fieldStart: number,
    fieldEnd: number,
): { word: string; start: number; end: number } | null {
    const field = line.slice(fieldStart, Math.min(fieldEnd, line.length));
    const cur = col - fieldStart;
    if (cur < 0 || cur >= field.length) { return null; }
    const pattern = /[$#@*]?[\w#@$]+/g;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(field)) !== null) {
        if (cur >= m.index && cur < m.index + m[0].length) {
            return {
                word:  m[0].toUpperCase(),
                start: fieldStart + m.index,
                end:   fieldStart + m.index + m[0].length,
            };
        }
    }
    return null;
}
