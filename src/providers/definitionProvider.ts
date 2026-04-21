/**
 * definitionProvider.ts
 *
 * Go-to-Definition for RPG-III symbols:
 *   - Subroutines: EXSR, BEGSR, ENDSR factor1 → BEGSR line
 *   - Tags: GOTO factor2 → TAG line
 *   - Fields / variables: F2/F1/result columns → I-spec definition
 *   - Files: CHAIN/READ/WRITE/etc. factor2 → F-spec definition
 *   - Arrays: any usage → E-spec definition
 *   - External DB fields: C-spec operand → owning F-spec (via Code for IBM i)
 */

import * as vscode from 'vscode';
import { documentCache } from '../parser/rpgDocument';
import { SpecType, CSpecContent, wordAtColumn } from '../types/rpgTypes';
import { ExternalFieldIndexService } from '../services/externalFieldIndex';

// Opcodes whose Factor 2 is a file/record-format name
const FILE_OPS = new Set([
    'CHAIN', 'READ', 'READE', 'READP', 'READPE',
    'WRITE', 'UPDATE', 'UPDAT', 'DELETE', 'DELET',
    'SETLL', 'SETGT', 'OPEN', 'CLOSE', 'FEOD', 'EXFMT',
]);

// Opcodes whose Factor 2 is a subroutine name
const SR_OPS_F2 = new Set(['EXSR', 'CAS', 'CASGT', 'CASLT', 'CASEQ', 'CASGE', 'CASLE', 'CASNE']);
// Opcodes whose Factor 1 is a subroutine name
const SR_OPS_F1 = new Set(['BEGSR', 'ENDSR']);
// Opcodes whose Factor 2 is a GOTO tag
const GOTO_OPS = new Set(['GOTO', 'CAB', 'CABGT', 'CABLT', 'CABEQ', 'CABGE', 'CABLE', 'CABNE']);
// Opcodes whose Factor 1 can be a KLIST name (composite key search argument)
const KLIST_OPS_F1 = new Set(['CHAIN', 'SETLL', 'SETGT', 'READE', 'READPE']);

// Opcodes and reserved words that must never be resolved as external fields.
// Keeps us from firing a SQL lookup on e.g. "MOVE" or "ADD".
const RPG_RESERVED = new Set([
    'CHAIN', 'READ', 'READE', 'READP', 'READPE', 'WRITE', 'UPDATE', 'UPDAT',
    'DELETE', 'DELET', 'SETLL', 'SETGT', 'OPEN', 'CLOSE', 'FEOD', 'EXFMT',
    'EXSR', 'BEGSR', 'ENDSR', 'GOTO', 'TAG', 'KLIST', 'KFLD',
    'MOVE', 'MOVEA', 'MOVEL', 'ADD', 'SUB', 'MULT', 'DIV', 'MVR',
    'Z-ADD', 'Z-SUB', 'COMP', 'IFEQ', 'IFNE', 'IFGT', 'IFGE', 'IFLT', 'IFLE',
    'IF', 'ELSE', 'ENDIF', 'END', 'DO', 'DOU', 'DOW', 'ENDDO',
    'SELEC', 'WHEQ', 'WHNE', 'WHGT', 'WHGE', 'WHLT', 'WHLE', 'OTHER', 'ENDSL',
    'CAB', 'CABGT', 'CABLT', 'CABEQ', 'CABGE', 'CABLE', 'CABNE',
    'CAS', 'CASGT', 'CASLT', 'CASEQ', 'CASGE', 'CASLE', 'CASNE',
    'LOKUP', 'SORTA', 'XFOOT', 'RETRN', 'CALL', 'PARM', 'PLIST',
    'UDATE', 'UDAY', 'UMONTH', 'UYEAR', 'PAGE',
]);

export class RpgDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private readonly externalFields: ExternalFieldIndexService) { }

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
    ): Promise<vscode.Definition | null> {
        const rpgDoc = documentCache.get(document);
        const { symbols } = rpgDoc;

        // Get word at cursor — comma excluded so PATH,X yields PATH or X based on cursor position
        const wordRange = document.getWordRangeAtPosition(position, /[\$#@*]?[\w#@$]+/);
        if (!wordRange) {
            return null;
        }

        // Find which parsed line the cursor is on
        const lineIdx = position.line;
        const parsedLine = rpgDoc.lines[lineIdx];

        // On C-spec lines the regex can bleed across fixed-column field boundaries
        // (e.g. "MOVEAHIND" when opcode fills all 5 chars). Re-extract within the field.
        let baseName = document.getText(wordRange).toUpperCase();
        if (parsedLine?.specType === SpecType.Calculation) {
            const col = position.character;
            const raw = document.lineAt(lineIdx).text;
            let bounds: [number, number] | null = null;
            if      (col >= 17 && col < 27) { bounds = [17, 27]; }
            else if (col >= 32 && col < 42) { bounds = [32, 42]; }
            else if (col >= 42 && col < 48) { bounds = [42, 48]; }
            if (bounds) {
                const hit = wordAtColumn(raw, col, bounds[0], bounds[1]);
                if (!hit) { return null; }
                baseName = hit.word;
            }
        }

        // ── Context-aware lookup for C-spec lines ─────────────────────
        if (parsedLine && parsedLine.specType === SpecType.Calculation && parsedLine.content) {
            const c = parsedLine.content as CSpecContent;
            const opcode = c.opcode;
            const cursorChar = position.character;

            // Determine which field the cursor is in
            const inFactor1 = cursorChar >= c.factor1Range[0] && cursorChar < c.factor1Range[1];
            const inFactor2 = cursorChar >= c.factor2Range[0] && cursorChar < c.factor2Range[1];
            const inResult  = cursorChar >= c.resultRange[0]  && cursorChar < c.resultRange[1];

            if (inFactor1 && SR_OPS_F1.has(opcode)) {
                // BEGSR / ENDSR — factor1 is the subroutine name
                const sym = symbols.subroutines.get(baseName);
                if (sym) {
                    return new vscode.Location(document.uri, sym.definitionRange);
                }
            }

            if (inFactor1 && (opcode === 'KLIST' || KLIST_OPS_F1.has(opcode))) {
                // KLIST definition line, or file-op using a named key list
                const sym = symbols.klists.get(baseName);
                if (sym) {
                    return new vscode.Location(document.uri, sym.definitionRange);
                }
            }

            if (inResult && opcode === 'KFLD') {
                // KFLD result field is the key field declaration
                const sym = symbols.kfields.get(baseName);
                if (sym) {
                    return new vscode.Location(document.uri, sym.definitionRange);
                }
            }

            if (inFactor2 && SR_OPS_F2.has(opcode)) {
                const sym = symbols.subroutines.get(baseName);
                if (sym) {
                    return new vscode.Location(document.uri, sym.definitionRange);
                }
            }

            if (inFactor2 && GOTO_OPS.has(opcode)) {
                const sym = symbols.tags.get(baseName);
                if (sym) {
                    return new vscode.Location(document.uri, sym.definitionRange);
                }
            }

            if (inFactor2 && FILE_OPS.has(opcode)) {
                const sym = symbols.files.get(baseName);
                if (sym) {
                    return new vscode.Location(document.uri, sym.definitionRange);
                }
            }
        }

        // ── Fallback: try all symbol tables in priority order ─────────

        // Skip *IN indicators and system constants
        if (baseName.startsWith('*IN') || baseName.startsWith('*')) {
            return null;
        }

        const subroutine = symbols.subroutines.get(baseName);
        if (subroutine) {
            return new vscode.Location(document.uri, subroutine.definitionRange);
        }

        const kfield = symbols.kfields.get(baseName);
        if (kfield) {
            return new vscode.Location(document.uri, kfield.definitionRange);
        }

        const varDefs = symbols.variables.get(baseName);
        if (varDefs && varDefs.length > 0) {
            // Walk backwards through all definitions to find the last one at or
            // before the cursor line — that is the "active" assignment.
            let closest = varDefs[0];
            for (const def of varDefs) {
                if (def.definitionLine <= lineIdx) {
                    closest = def;
                }
            }
            return new vscode.Location(document.uri, closest.definitionRange);
        }

        const field = symbols.fields.get(baseName);
        if (field) {
            return new vscode.Location(document.uri, field.definitionRange);
        }

        const array = symbols.arrays.get(baseName);
        if (array) {
            return new vscode.Location(document.uri, array.definitionRange);
        }

        const file = symbols.files.get(baseName);
        if (file) {
            return new vscode.Location(document.uri, file.definitionRange);
        }

        const tag = symbols.tags.get(baseName);
        if (tag) {
            return new vscode.Location(document.uri, tag.definitionRange);
        }

        const klist = symbols.klists.get(baseName);
        if (klist) {
            return new vscode.Location(document.uri, klist.definitionRange);
        }

        // ── External DB fields (via Code for IBM i) ───────────────────
        // Only consulted when the cursor is in a C-spec operand and the token
        // survives a cheap set of filters. Index is prefetched on open, so
        // this is usually a cache hit.
        if (!isExternalFieldCandidate(baseName, parsedLine, position)) {
            return null;
        }
        const externalIdx = await this.externalFields.getIndex(document);
        const hits = externalIdx?.fields.get(baseName);
        if (!hits || hits.length === 0) {
            return null;
        }
        const locations: vscode.Location[] = [];
        for (const hit of hits) {
            const fspec = symbols.files.get(hit.fileName);
            if (fspec) {
                locations.push(new vscode.Location(document.uri, fspec.definitionRange));
            }
        }
        return locations.length > 0 ? locations : null;
    }
}

/**
 * Cheap filter to avoid firing on obvious non-fields: numeric literals,
 * opcodes, names longer than 6 chars (RPG-III field name limit). The cursor
 * must also be in a C-spec operand — H/F/E/I/O specs have their own handling.
 */
function isExternalFieldCandidate(
    baseName: string,
    parsedLine: { specType: SpecType; content: CSpecContent | null | unknown } | undefined,
    position: vscode.Position,
): boolean {
    if (!baseName || baseName.length > 6) { return false; }
    if (/^\d+$/.test(baseName)) { return false; }
    if (RPG_RESERVED.has(baseName)) { return false; }
    if (!parsedLine || parsedLine.specType !== SpecType.Calculation || !parsedLine.content) {
        return false;
    }
    const c = parsedLine.content as CSpecContent;
    const col = position.character;
    const inFactor1 = col >= c.factor1Range[0] && col < c.factor1Range[1];
    const inFactor2 = col >= c.factor2Range[0] && col < c.factor2Range[1];
    const inResult  = col >= c.resultRange[0]  && col < c.resultRange[1];
    return inFactor1 || inFactor2 || inResult;
}
