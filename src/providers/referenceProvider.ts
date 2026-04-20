/**
 * referenceProvider.ts
 *
 * Find All References for RPG-III symbols.
 * Supports navigation to every use of subroutines, tags, files, arrays,
 * data-structure fields, variables, and KLIST key lists across all spec types.
 */

import * as vscode from 'vscode';
import { documentCache } from '../parser/rpgDocument';
import {
    SpecType, CSpecContent, FSpecContent, ISpecContent, ESpecContent,
    wordAtColumn,
} from '../types/rpgTypes';

const FILE_OPS = new Set([
    'CHAIN', 'READ', 'READE', 'READP', 'READPE',
    'WRITE', 'UPDATE', 'UPDAT', 'DELETE', 'DELET',
    'SETLL', 'SETGT', 'OPEN', 'CLOSE', 'FEOD', 'EXFMT',
]);
const SR_OPS_F2 = new Set(['EXSR', 'CAS', 'CASGT', 'CASLT', 'CASEQ', 'CASGE', 'CASLE', 'CASNE']);
const SR_OPS_F1 = new Set(['BEGSR', 'ENDSR']);
const GOTO_OPS  = new Set(['GOTO', 'CAB', 'CABGT', 'CABLT', 'CABEQ', 'CABGE', 'CABLE', 'CABNE']);
// Opcodes that accept a KLIST name in Factor 1 as the composite search key
const KLIST_OPS_F1 = new Set(['CHAIN', 'SETLL', 'SETGT', 'READE', 'READPE']);

const enum SymbolKind { Subroutine, Tag, File, Array, Field, Variable, KeyList, KeyField }

/**
 * If the base name of `fieldValue` (the part before any comma, e.g. "ARR" in
 * "ARR,5") equals `targetName`, return the exact [start, end) column range for
 * that name within the line.  Returns null if it does not match.
 */
function fieldMatchRange(
    fieldValue: string,
    fieldRange: [number, number],
    targetName: string,
): [number, number] | null {
    const baseName = fieldValue.toUpperCase().split(',')[0];
    if (baseName !== targetName) { return null; }
    return [fieldRange[0], fieldRange[0] + baseName.length];
}

function loc(uri: vscode.Uri, line: number, start: number, end: number): vscode.Location {
    return new vscode.Location(uri, new vscode.Range(line, start, line, end));
}

export class RpgReferenceProvider implements vscode.ReferenceProvider {
    provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        _token: vscode.CancellationToken,
    ): vscode.Location[] {
        const rpgDoc  = documentCache.get(document);
        const { symbols } = rpgDoc;

        // Resolve the identifier at the cursor
        const wordRange = document.getWordRangeAtPosition(position, /[$#@*]?[\w#@$]+/);
        if (!wordRange) { return []; }

        const lineIdx    = position.line;
        const parsedLine = rpgDoc.lines[lineIdx];

        let baseName = document.getText(wordRange).toUpperCase();

        // On C-spec lines re-extract within fixed-column field boundaries to
        // avoid the regex bleeding across adjacent fields.
        if (parsedLine?.specType === SpecType.Calculation) {
            const col = position.character;
            const raw = document.lineAt(lineIdx).text;
            let bounds: [number, number] | null = null;
            if      (col >= 17 && col < 27) { bounds = [17, 27]; }
            else if (col >= 32 && col < 42) { bounds = [32, 42]; }
            else if (col >= 42 && col < 48) { bounds = [42, 48]; }
            if (bounds) {
                const hit = wordAtColumn(raw, col, bounds[0], bounds[1]);
                if (!hit) { return []; }
                baseName = hit.word;
            }
        }

        // Skip system constants (*BLANK, *IN, etc.)
        if (baseName.startsWith('*')) { return []; }

        // ── Determine symbol kind ─────────────────────────────────────────
        let kind: SymbolKind | null = null;

        if (parsedLine?.specType === SpecType.Calculation && parsedLine.content) {
            const c   = parsedLine.content as CSpecContent;
            const op  = c.opcode;
            const chr = position.character;
            const inF1     = chr >= c.factor1Range[0] && chr < c.factor1Range[1];
            const inF2     = chr >= c.factor2Range[0] && chr < c.factor2Range[1];
            const inResult = chr >= 42 && chr < 48;  // result field column

            if      (inF1 && SR_OPS_F1.has(op))         { kind = SymbolKind.Subroutine; }
            else if (inF1 && op === 'TAG')               { kind = SymbolKind.Tag; }
            else if (inF1 && (op === 'KLIST' || KLIST_OPS_F1.has(op))) { kind = SymbolKind.KeyList; }
            else if (inF2 && SR_OPS_F2.has(op))         { kind = SymbolKind.Subroutine; }
            else if (inF2 && GOTO_OPS.has(op))          { kind = SymbolKind.Tag; }
            else if (inF2 && FILE_OPS.has(op))          { kind = SymbolKind.File; }
            else if (inResult && op === 'KFLD')         { kind = SymbolKind.KeyField; }
        } else if (parsedLine?.specType === SpecType.File)      { kind = SymbolKind.File; }
        else if   (parsedLine?.specType === SpecType.Extension)  { kind = SymbolKind.Array; }
        else if   (parsedLine?.specType === SpecType.Input)      { kind = SymbolKind.Field; }

        // Fallback: consult symbol tables (mirrors definitionProvider priority)
        if (kind === null) {
            if      (symbols.subroutines.has(baseName)) { kind = SymbolKind.Subroutine; }
            else if (symbols.klists.has(baseName))      { kind = SymbolKind.KeyList; }
            else if (symbols.kfields.has(baseName))     { kind = SymbolKind.KeyField; }
            else if (symbols.variables.has(baseName))   { kind = SymbolKind.Variable; }
            else if (symbols.fields.has(baseName))      { kind = SymbolKind.Field; }
            else if (symbols.arrays.has(baseName))      { kind = SymbolKind.Array; }
            else if (symbols.files.has(baseName))       { kind = SymbolKind.File; }
            else if (symbols.tags.has(baseName))        { kind = SymbolKind.Tag; }
            else { return []; }
        }

        // ── Scan every line for occurrences ──────────────────────────────
        const locations: vscode.Location[] = [];
        const uri = document.uri;

        for (const line of rpgDoc.lines) {
            const { lineNumber: ln, specType, content } = line;

            switch (specType) {

                // ── F-spec: file declaration ──────────────────────────────
                case SpecType.File: {
                    if (kind !== SymbolKind.File) { break; }
                    const f = content as FSpecContent;
                    if (f?.filename.toUpperCase() === baseName && context.includeDeclaration) {
                        const [s, e] = f.filenameRange;
                        locations.push(loc(uri, ln, s, e));
                    }
                    break;
                }

                // ── E-spec: array declaration ─────────────────────────────
                case SpecType.Extension: {
                    if (kind !== SymbolKind.Array) { break; }
                    const ext = content as ESpecContent;
                    if (ext?.arrayName.toUpperCase() === baseName && context.includeDeclaration) {
                        const [s, e] = ext.arrayNameRange;
                        locations.push(loc(uri, ln, s, e));
                    }
                    break;
                }

                // ── I-spec: field declaration ─────────────────────────────
                case SpecType.Input: {
                    if (kind !== SymbolKind.Field && kind !== SymbolKind.Variable && kind !== SymbolKind.KeyField) { break; }
                    const inp = content as ISpecContent;
                    if (inp && !inp.isDataStructure && inp.fieldName.toUpperCase() === baseName
                            && context.includeDeclaration) {
                        const [s, e] = inp.fieldNameRange;
                        locations.push(loc(uri, ln, s, e));
                    }
                    break;
                }

                // ── C-spec: all reference sites ───────────────────────────
                case SpecType.Calculation: {
                    const c = content as CSpecContent;
                    if (!c) { break; }
                    const op = c.opcode;

                    // Factor 1 ------------------------------------------------
                    if (c.factor1) {
                        const f1 = c.factor1.toUpperCase();
                        const [s, e] = c.factor1Range;

                        if (kind === SymbolKind.Subroutine && SR_OPS_F1.has(op) && f1 === baseName) {
                            // BEGSR = declaration site; ENDSR = reference
                            if (op === 'BEGSR' ? context.includeDeclaration : true) {
                                locations.push(loc(uri, ln, s, e));
                            }
                        } else if (kind === SymbolKind.Tag && op === 'TAG' && f1 === baseName) {
                            if (context.includeDeclaration) {
                                locations.push(loc(uri, ln, s, e));
                            }
                        } else if (kind === SymbolKind.KeyList && f1 === baseName) {
                            // KLIST definition line = declaration; CHAIN/SETLL/SETGT = reference
                            if (op === 'KLIST' ? context.includeDeclaration : true) {
                                locations.push(loc(uri, ln, s, e));
                            }
                        } else if (
                            (kind === SymbolKind.Variable || kind === SymbolKind.Field || kind === SymbolKind.Array
                                || kind === SymbolKind.KeyField)
                            && !SR_OPS_F1.has(op) && op !== 'TAG' && op !== 'KLIST'
                            && f1 === baseName
                        ) {
                            locations.push(loc(uri, ln, s, e));
                        }
                    }

                    // Factor 2 ------------------------------------------------
                    if (c.factor2) {
                        const matchRange = fieldMatchRange(c.factor2, c.factor2Range, baseName);
                        if (matchRange) {
                            const [s, e] = matchRange;
                            if (kind === SymbolKind.Subroutine && SR_OPS_F2.has(op)) {
                                locations.push(loc(uri, ln, s, e));
                            } else if (kind === SymbolKind.Tag && GOTO_OPS.has(op)) {
                                locations.push(loc(uri, ln, s, e));
                            } else if (kind === SymbolKind.File && FILE_OPS.has(op)) {
                                locations.push(loc(uri, ln, s, e));
                            } else if (
                                (kind === SymbolKind.Variable || kind === SymbolKind.Field || kind === SymbolKind.Array
                                    || kind === SymbolKind.KeyField)
                                && !SR_OPS_F2.has(op) && !GOTO_OPS.has(op) && !FILE_OPS.has(op)
                            ) {
                                locations.push(loc(uri, ln, s, e));
                            }
                        }
                    }

                    // Result field --------------------------------------------
                    if (c.resultField) {
                        const rKey = c.resultField.toUpperCase();
                        if (kind === SymbolKind.KeyField && rKey === baseName) {
                            const [s, e] = c.resultRange;
                            // KFLD result field = declaration; all other result uses = reference
                            const isDecl = op === 'KFLD';
                            if (!isDecl || context.includeDeclaration) {
                                locations.push(loc(uri, ln, s, e));
                            }
                        } else if ((kind === SymbolKind.Variable || kind === SymbolKind.Field) && rKey === baseName) {
                            const [s, e] = c.resultRange;
                            const isDecl = c.fieldLen.length > 0;
                            if (!isDecl || context.includeDeclaration) {
                                locations.push(loc(uri, ln, s, e));
                            }
                        }
                    }
                    break;
                }

                default:
                    break;
            }
        }

        return locations;
    }
}
