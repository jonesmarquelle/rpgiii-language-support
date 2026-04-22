/**
 * cspecContext.ts
 *
 * Helpers for interpreting a cursor position within a C-spec line.
 * Used by every provider that needs to know which field the cursor is in
 * (Factor 1 / Factor 2 / Result) and what symbol kind the opcode implies.
 */

import { CSpecContent, wordAtColumn } from '../types/rpgTypes';
import {
    FILE_OPS, SR_OPS_F1, SR_OPS_F2, GOTO_OPS, KLIST_OPS_F1,
} from './opcodes';

export type CSpecField = 'factor1' | 'factor2' | 'result';

// Fixed-column bounds [start, end) for the three user-visible C-spec fields.
// See lineParser.parseCSpec for the full column layout.
const CSPEC_FIELD_BOUNDS: Record<CSpecField, [number, number]> = {
    factor1: [17, 27],
    factor2: [32, 42],
    result:  [42, 48],
};

/**
 * Which C-spec field contains column `col`, or null if the cursor is in a
 * gutter, the opcode column, or past the result field.
 */
export function cspecFieldAt(col: number): CSpecField | null {
    for (const name of ['factor1', 'factor2', 'result'] as const) {
        const [s, e] = CSPEC_FIELD_BOUNDS[name];
        if (col >= s && col < e) { return name; }
    }
    return null;
}

/**
 * Re-extract the word at `col` within its C-spec field boundary. This avoids
 * the regex-based `getWordRangeAtPosition` bleeding across adjacent fixed
 * columns (e.g. "MOVEAHIND" when an opcode fills all 5 chars).
 *
 * Returns null if the cursor is not in a C-spec field, or not on a token.
 */
export function wordAtCspec(raw: string, col: number):
    { word: string; start: number; end: number; field: CSpecField } | null {
    const field = cspecFieldAt(col);
    if (!field) { return null; }
    const [s, e] = CSPEC_FIELD_BOUNDS[field];
    const hit = wordAtColumn(raw, col, s, e);
    if (!hit) { return null; }
    return { ...hit, field };
}

/** The symbol kind that an opcode + cursor field implies, if any. */
export type CSpecSymbolKind =
    | 'subroutine'
    | 'tag'
    | 'file'
    | 'keylist'
    | 'keyfield';

/**
 * Classify a C-spec reference by opcode + which field the cursor is in.
 * Returns null if the combination isn't semantically meaningful — callers
 * should fall back to generic symbol-table lookup in that case.
 */
export function cspecSymbolKind(
    content: CSpecContent,
    field: CSpecField,
): CSpecSymbolKind | null {
    const op = content.opcode;
    if (field === 'factor1') {
        if (SR_OPS_F1.has(op)) { return 'subroutine'; }
        if (op === 'TAG')      { return 'tag'; }
        if (op === 'KLIST' || KLIST_OPS_F1.has(op)) { return 'keylist'; }
        return null;
    }
    if (field === 'factor2') {
        if (SR_OPS_F2.has(op)) { return 'subroutine'; }
        if (GOTO_OPS.has(op))  { return 'tag'; }
        if (FILE_OPS.has(op))  { return 'file'; }
        return null;
    }
    // field === 'result'
    if (op === 'KFLD') { return 'keyfield'; }
    return null;
}
