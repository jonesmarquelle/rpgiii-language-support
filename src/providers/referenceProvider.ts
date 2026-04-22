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
    ParsedLine, SymbolTable,
} from '../types/rpgTypes';
import {
    FILE_OPS, SR_OPS_F1, SR_OPS_F2, GOTO_OPS,
} from '../parser/opcodes';
import { cspecFieldAt, cspecSymbolKind } from '../parser/cspecContext';
import { resolveSymbolAt } from './providerUtils';

const enum SymbolKind { Subroutine, Tag, File, Array, Field, Variable, KeyList, KeyField }

/**
 * If the base name of `fieldValue` (the part before any comma, e.g. "ARR" in
 * "ARR,5") equals `targetName`, return the exact [start, end) column range for
 * that name within the line. Returns null otherwise.
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
        const lineIdx    = position.line;
        const parsedLine = rpgDoc.lines[lineIdx];

        const hit = resolveSymbolAt(document, position, parsedLine);
        if (!hit) { return []; }
        const baseName = hit.name;

        // Skip system constants (*BLANK, *IN, etc.)
        if (baseName.startsWith('*')) { return []; }

        // ── Determine symbol kind ─────────────────────────────────────────
        let kind: SymbolKind | null = kindFromContext(parsedLine, position.character);
        if (kind === null) {
            kind = kindFromSymbolTable(symbols, baseName);
            if (kind === null) { return []; }
        }

        // ── Scan every line for occurrences ──────────────────────────────
        const locations: vscode.Location[] = [];
        const uri = document.uri;

        for (const line of rpgDoc.lines) {
            const { lineNumber: ln, specType, content } = line;

            switch (specType) {

                case SpecType.File: {
                    if (kind !== SymbolKind.File) { break; }
                    const f = content as FSpecContent;
                    if (f?.filename.toUpperCase() === baseName && context.includeDeclaration) {
                        const [s, e] = f.filenameRange;
                        locations.push(loc(uri, ln, s, e));
                    }
                    break;
                }

                case SpecType.Extension: {
                    if (kind !== SymbolKind.Array) { break; }
                    const ext = content as ESpecContent;
                    if (ext?.arrayName.toUpperCase() === baseName && context.includeDeclaration) {
                        const [s, e] = ext.arrayNameRange;
                        locations.push(loc(uri, ln, s, e));
                    }
                    break;
                }

                case SpecType.Input: {
                    if (kind !== SymbolKind.Field && kind !== SymbolKind.Variable
                            && kind !== SymbolKind.KeyField) { break; }
                    const inp = content as ISpecContent;
                    if (inp && !inp.isDataStructure && inp.fieldName.toUpperCase() === baseName
                            && context.includeDeclaration) {
                        const [s, e] = inp.fieldNameRange;
                        locations.push(loc(uri, ln, s, e));
                    }
                    break;
                }

                case SpecType.Calculation: {
                    const c = content as CSpecContent;
                    if (!c) { break; }
                    collectCSpecReferences(c, ln, kind, baseName, context, locations, uri);
                    break;
                }

                default:
                    break;
            }
        }

        return locations;
    }
}

function kindFromContext(
    parsedLine: ParsedLine | undefined,
    col: number,
): SymbolKind | null {
    if (!parsedLine) { return null; }
    if (parsedLine.specType === SpecType.File)      { return SymbolKind.File; }
    if (parsedLine.specType === SpecType.Extension) { return SymbolKind.Array; }
    if (parsedLine.specType === SpecType.Input)     { return SymbolKind.Field; }
    if (parsedLine.specType !== SpecType.Calculation || !parsedLine.content) { return null; }

    const field = cspecFieldAt(col);
    if (!field) { return null; }
    const cspecKind = cspecSymbolKind(parsedLine.content as CSpecContent, field);
    switch (cspecKind) {
        case 'subroutine': return SymbolKind.Subroutine;
        case 'tag':        return SymbolKind.Tag;
        case 'file':       return SymbolKind.File;
        case 'keylist':    return SymbolKind.KeyList;
        case 'keyfield':   return SymbolKind.KeyField;
        default:           return null;
    }
}

function kindFromSymbolTable(
    symbols: SymbolTable,
    name: string,
): SymbolKind | null {
    if (symbols.subroutines.has(name)) { return SymbolKind.Subroutine; }
    if (symbols.klists.has(name))      { return SymbolKind.KeyList; }
    if (symbols.kfields.has(name))     { return SymbolKind.KeyField; }
    if (symbols.variables.has(name))   { return SymbolKind.Variable; }
    if (symbols.fields.has(name))      { return SymbolKind.Field; }
    if (symbols.arrays.has(name))      { return SymbolKind.Array; }
    if (symbols.files.has(name))       { return SymbolKind.File; }
    if (symbols.tags.has(name))        { return SymbolKind.Tag; }
    return null;
}

function collectCSpecReferences(
    c: CSpecContent,
    ln: number,
    kind: SymbolKind,
    baseName: string,
    context: vscode.ReferenceContext,
    locations: vscode.Location[],
    uri: vscode.Uri,
): void {
    const op = c.opcode;

    // Factor 1 ---------------------------------------------------------
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
            // KLIST = declaration; CHAIN/SETLL/SETGT/etc. = reference
            if (op === 'KLIST' ? context.includeDeclaration : true) {
                locations.push(loc(uri, ln, s, e));
            }
        } else if (
            isValueKind(kind)
            && !SR_OPS_F1.has(op) && op !== 'TAG' && op !== 'KLIST'
            && f1 === baseName
        ) {
            locations.push(loc(uri, ln, s, e));
        }
    }

    // Factor 2 ---------------------------------------------------------
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
                isValueKind(kind)
                && !SR_OPS_F2.has(op) && !GOTO_OPS.has(op) && !FILE_OPS.has(op)
            ) {
                locations.push(loc(uri, ln, s, e));
            }
        }
    }

    // Result field -----------------------------------------------------
    if (c.resultField) {
        const rKey = c.resultField.toUpperCase();
        if (kind === SymbolKind.KeyField && rKey === baseName) {
            const [s, e] = c.resultRange;
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
}

/** Kinds that behave like plain values in Factor 1 / Factor 2. */
function isValueKind(kind: SymbolKind): boolean {
    return kind === SymbolKind.Variable
        || kind === SymbolKind.Field
        || kind === SymbolKind.Array
        || kind === SymbolKind.KeyField;
}
