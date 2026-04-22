/**
 * providerUtils.ts
 *
 * Small helpers shared between the language providers.
 */

import * as vscode from 'vscode';
import { FieldSymbol, SpecType, ParsedLine } from '../types/rpgTypes';
import { cspecFieldAt, wordAtCspec } from '../parser/cspecContext';

/**
 * C-spec variable declarations can appear multiple times in source order.
 * The "active" declaration at a given line is the last one at or before it.
 */
export function closestVariableDef(
    defs: FieldSymbol[],
    lineIdx: number,
): FieldSymbol {
    let closest = defs[0];
    for (const def of defs) {
        if (def.definitionLine <= lineIdx) {
            closest = def;
        }
    }
    return closest;
}

/**
 * Resolve the identifier at `position` for a provider. Returns the uppercased
 * symbol name plus its highlight range, or null if the cursor isn't on a
 * token. On C-spec lines, re-extracts within fixed-column field bounds so the
 * generic word regex can't bleed across adjacent fields.
 */
export function resolveSymbolAt(
    document: vscode.TextDocument,
    position: vscode.Position,
    parsedLine: ParsedLine | undefined,
): { name: string; range: vscode.Range } | null {
    if (parsedLine?.specType === SpecType.Calculation) {
        if (cspecFieldAt(position.character) !== null) {
            const raw = document.lineAt(position.line).text;
            const hit = wordAtCspec(raw, position.character);
            if (!hit) { return null; }
            return {
                name:  hit.word,
                range: new vscode.Range(position.line, hit.start, position.line, hit.end),
            };
        }
    }
    const wordRange = document.getWordRangeAtPosition(position, /[\$#@*]?[\w#@$]+/);
    if (!wordRange) { return null; }
    return {
        name:  document.getText(wordRange).toUpperCase(),
        range: wordRange,
    };
}

