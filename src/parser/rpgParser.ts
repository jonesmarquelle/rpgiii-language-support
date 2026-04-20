/**
 * rpgParser.ts
 *
 * Main parse loop. Iterates over lines of an RPG-III document, classifies
 * each line by its spec type, extracts column-structured content, and builds
 * a symbol table for use by language providers.
 */

import * as vscode from 'vscode';
import {
    SpecType, ParsedLine, RpgDocument, SymbolTable,
    FileSymbol, ArraySymbol, DataStructureSymbol, FieldSymbol,
    SubroutineSymbol, TagSymbol, KListSymbol, KFieldSymbol,
    colChar,
} from '../types/rpgTypes';
import { parseCSpec, parseFSpec, parseISpec, parseESpec } from './lineParser';

// ─── Main Entry ───────────────────────────────────────────────────────────

export function parseDocument(textDoc: vscode.TextDocument): RpgDocument {
    const lines: ParsedLine[] = [];
    const symbols = emptySymbolTable();

    // State for continuation detection
    let lastSpecType: SpecType = SpecType.Unknown;
    let inCompileTimeData = false;

    // Track current data structure for accumulating DS fields
    let currentDs: DataStructureSymbol | null = null;

    // Track current KLIST for accumulating KFLD result fields
    let currentKList: KListSymbol | null = null;

    // Two-pass approach: first pass builds lines + symbols (except subroutine end lines),
    // second pass fills in subroutine end lines and folding ranges.
    const begsrPending = new Map<string, number>(); // subroutine name → start line index

    for (let i = 0; i < textDoc.lineCount; i++) {
        const raw = textDoc.lineAt(i).text;

        // ── Compile-time data blocks (**) ──────────────────────────────
        if (raw.length >= 2 && raw[0] === '*' && raw[1] === '*') {
            inCompileTimeData = !inCompileTimeData; // toggle on each **
            lines.push({ lineNumber: i, raw, specType: SpecType.CompileTimeData, content: null });
            continue;
        }
        if (inCompileTimeData) {
            lines.push({ lineNumber: i, raw, specType: SpecType.CompileTimeData, content: null });
            continue;
        }

        // ── Classify by col 6 (index 5) ───────────────────────────────
        const specChar = raw.length > 5 ? raw[5].toUpperCase() : ' ';

        // Comment line: col 7 (index 6) is '*'
        if (raw.length > 6 && raw[6] === '*') {
            lines.push({ lineNumber: i, raw, specType: SpecType.Comment, content: null });
            continue;
        }

        // Precompiler: col 7 is '/'
        if (specChar !== ' ' && raw.length > 6 && raw[6] === '/') {
            lines.push({ lineNumber: i, raw, specType: SpecType.Precompiler, content: null });
            continue;
        }

        const specType = charToSpecType(specChar);

        // Handle F-spec continuation (col 6 is blank, but previous spec was F)
        const isFContinuation =
            specType === SpecType.Blank && lastSpecType === SpecType.File;

        if (specType !== SpecType.Blank && specType !== SpecType.Unknown) {
            lastSpecType = specType;
        }

        // ── Per-spec parsing ──────────────────────────────────────────

        switch (specType) {
            case SpecType.File: {
                const content = parseFSpec(raw, false);
                lines.push({ lineNumber: i, raw, specType, content });
                if (content.filename) {
                    const key = content.filename.toUpperCase();
                    if (!symbols.files.has(key)) {
                        symbols.files.set(key, {
                            name: content.filename,
                            definitionLine: i,
                            definitionRange: lineRange(i, content.filenameRange),
                            fileType: content.fileType,
                            designation: content.designation,
                            device: content.device,
                            format: content.format,
                        } satisfies FileSymbol);
                    }
                }
                break;
            }

            case SpecType.Extension: {
                const content = parseESpec(raw);
                lines.push({ lineNumber: i, raw, specType, content });
                if (content.arrayName) {
                    const key = content.arrayName.toUpperCase();
                    if (!symbols.arrays.has(key)) {
                        symbols.arrays.set(key, {
                            name: content.arrayName,
                            definitionLine: i,
                            definitionRange: lineRange(i, content.arrayNameRange),
                            entriesPerRecord: content.entriesPerRecord,
                            entriesPerTable: content.entriesPerTable,
                            entryLength: content.entryLength,
                            decPos: content.decPos,
                            dataType: content.dataType,
                        } satisfies ArraySymbol);
                    }
                }
                break;
            }

            case SpecType.Input: {
                const content = parseISpec(raw);
                lines.push({ lineNumber: i, raw, specType, content });

                if (content.isDataStructure) {
                    // New DS definition — may be anonymous (filename blank)
                    const dsName = content.filename || '';
                    currentDs = {
                        name: dsName,
                        definitionLine: i,
                        definitionRange: new vscode.Range(i, 6, i, 14),
                        dsType: content.dsOption === 'S' ? 'SDS' : '',
                        fields: [],
                    };
                    symbols.dataStructures.push(currentDs);
                } else if (content.fieldName && currentDs !== null) {
                    // DS subfield definition
                    const fieldSym: FieldSymbol = {
                        name: content.fieldName,
                        definitionLine: i,
                        definitionRange: lineRange(i, content.fieldNameRange),
                        fromPos: content.fromPos,
                        toPos: content.toPos,
                        decPos: content.decPos,
                        dataType: content.dataType,
                        parentDsName: currentDs.name,
                    };
                    currentDs.fields.push(fieldSym);
                    const key = content.fieldName.toUpperCase();
                    if (!symbols.fields.has(key)) {
                        symbols.fields.set(key, fieldSym);
                    }
                } else if (content.fieldName && !content.isDataStructure) {
                    // Record-format field (not in a DS)
                    currentDs = null;
                    const fieldSym: FieldSymbol = {
                        name: content.fieldName,
                        definitionLine: i,
                        definitionRange: lineRange(i, content.fieldNameRange),
                        fromPos: content.fromPos,
                        toPos: content.toPos,
                        decPos: content.decPos,
                        dataType: content.dataType,
                        parentDsName: '',
                    };
                    const key = content.fieldName.toUpperCase();
                    if (!symbols.fields.has(key)) {
                        symbols.fields.set(key, fieldSym);
                    }
                } else if (!content.isDataStructure && !content.fieldName) {
                    // Record identification line with no DS or field — reset DS context
                    if (content.filename) {
                        currentDs = null;
                    }
                }
                break;
            }

            case SpecType.Calculation: {
                const content = parseCSpec(raw);
                lines.push({ lineNumber: i, raw, specType, content });
                currentDs = null; // C-spec ends any DS context

                const opcode = content.opcode;
                const factor1 = content.factor1;
                const factor2 = content.factor2;

                if (opcode === 'KLIST' && factor1) {
                    const key = factor1.toUpperCase();
                    const sym: KListSymbol = {
                        name: factor1,
                        definitionLine: i,
                        definitionRange: lineRange(i, content.factor1Range),
                        keyFields: [],
                    };
                    if (!symbols.klists.has(key)) {
                        symbols.klists.set(key, sym);
                    }
                    currentKList = symbols.klists.get(key)!;
                } else if (opcode === 'KFLD') {
                    // KFLD result field is the key field name (no factor1/factor2 used)
                    if (content.resultField && currentKList) {
                        const fieldKey = content.resultField.toUpperCase();
                        currentKList.keyFields.push(fieldKey);
                        if (!symbols.kfields.has(fieldKey)) {
                            symbols.kfields.set(fieldKey, {
                                name: content.resultField,
                                definitionLine: i,
                                definitionRange: lineRange(i, content.resultRange),
                                parentKListName: currentKList.name,
                                fieldIndex: currentKList.keyFields.length - 1,
                            } satisfies KFieldSymbol);
                        }
                    }
                } else {
                    // Any other opcode ends the current KLIST group
                    currentKList = null;
                }

                if (opcode === 'BEGSR' && factor1) {
                    const key = factor1.toUpperCase();
                    begsrPending.set(key, i);
                } else if (opcode === 'ENDSR') {
                    // factor1 on ENDSR can name the subroutine (it's also a GOTO target)
                    // Find the matching BEGSR — work backwards if factor1 provides the name,
                    // else match the most recent un-closed BEGSR.
                    let matchKey: string | null = null;
                    if (factor1) {
                        const k = factor1.toUpperCase();
                        if (begsrPending.has(k)) {
                            matchKey = k;
                        }
                    }
                    if (!matchKey && begsrPending.size > 0) {
                        // Take the last pending BEGSR (subroutines can't nest in RPG-III)
                        matchKey = [...begsrPending.keys()].pop() ?? null;
                    }
                    if (matchKey !== null) {
                        const startLine = begsrPending.get(matchKey)!;
                        begsrPending.delete(matchKey);
                        // Retrieve the factor1 from the BEGSR line to get the canonical name
                        const begsrLine = lines[startLine];
                        const name = begsrLine.content && 'factor1' in begsrLine.content
                            ? begsrLine.content.factor1
                            : matchKey;
                        const foldRange = new vscode.FoldingRange(startLine, i, vscode.FoldingRangeKind.Region);
                        const sym: SubroutineSymbol = {
                            name,
                            definitionLine: startLine,
                            definitionRange: lineRange(startLine, (begsrLine.content as any).factor1Range),
                            endLine: i,
                            foldRange,
                        };
                        symbols.subroutines.set(name.toUpperCase(), sym);
                    }
                } else if (opcode === 'TAG' && factor1) {
                    const key = factor1.toUpperCase();
                    if (!symbols.tags.has(key)) {
                        symbols.tags.set(key, {
                            name: factor1,
                            definitionLine: i,
                            definitionRange: lineRange(i, content.factor1Range),
                        } satisfies TagSymbol);
                    }
                }

                // Also register the ENDSR factor1 as a tag (jump target within subroutine)
                if (opcode === 'ENDSR' && factor1) {
                    const key = factor1.toUpperCase();
                    if (!symbols.tags.has(key)) {
                        symbols.tags.set(key, {
                            name: factor1,
                            definitionLine: i,
                            definitionRange: lineRange(i, content.factor1Range),
                        } satisfies TagSymbol);
                    }
                }

                // Register any result field that carries a field length — that is the
                // canonical declaration signal in RPG-III. All occurrences are kept in
                // source order so providers can resolve to the closest prior definition.
                if (content.resultField && content.fieldLen) {
                    const key = content.resultField.toUpperCase();
                    const sym: FieldSymbol = {
                        name: content.resultField,
                        definitionLine: i,
                        definitionRange: lineRange(i, content.resultRange),
                        fromPos: 0,
                        toPos: 0,
                        decPos: content.decPos,
                        dataType: '',
                        parentDsName: '',
                    };
                    const existing = symbols.variables.get(key);
                    if (existing) {
                        existing.push(sym);
                    } else {
                        symbols.variables.set(key, [sym]);
                    }
                }
                break;
            }

            case SpecType.Blank: {
                if (isFContinuation) {
                    const content = parseFSpec(raw, true);
                    lines.push({ lineNumber: i, raw, specType: SpecType.File, content });
                } else {
                    lines.push({ lineNumber: i, raw, specType: SpecType.Blank, content: null });
                }
                break;
            }

            default:
                lines.push({ lineNumber: i, raw, specType, content: null });
                break;
        }
    }

    return {
        uri: textDoc.uri.toString(),
        lines,
        symbols,
        version: textDoc.version,
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function charToSpecType(ch: string): SpecType {
    switch (ch.toUpperCase()) {
        case 'H': return SpecType.Header;
        case 'F': return SpecType.File;
        case 'E': return SpecType.Extension;
        case 'L': return SpecType.LineCounter;
        case 'I': return SpecType.Input;
        case 'C': return SpecType.Calculation;
        case 'O': return SpecType.Output;
        case '*': return SpecType.Comment;
        case '/': return SpecType.Precompiler;
        case ' ': return SpecType.Blank;
        default:  return SpecType.Unknown;
    }
}

function emptySymbolTable(): SymbolTable {
    return {
        files: new Map(),
        arrays: new Map(),
        dataStructures: [],
        fields: new Map(),
        variables: new Map(),
        subroutines: new Map(),
        tags: new Map(),
        klists: new Map(),
        kfields: new Map(),
    };
}

/**
 * Build a VSCode Range spanning a single line at the given char range.
 * range is [start, end) exclusive. Defaults to the whole line if range is [x,x].
 */
function lineRange(lineIdx: number, range: [number, number]): vscode.Range {
    const [s, e] = range;
    if (s >= e) {
        return new vscode.Range(lineIdx, 0, lineIdx, 0);
    }
    return new vscode.Range(lineIdx, s, lineIdx, e);
}
