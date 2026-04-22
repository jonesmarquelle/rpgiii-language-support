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
import { SpecType, CSpecContent, SymbolTable, BaseSymbol, ParsedLine } from '../types/rpgTypes';
import { cspecFieldAt, cspecSymbolKind, CSpecSymbolKind } from '../parser/cspecContext';
import { closestVariableDef, resolveSymbolAt } from './providerUtils';
import { ExternalFieldIndexService } from '../services/externalFieldIndex';
import { RPG_RESERVED } from '../parser/opcodes';

export class RpgDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private readonly externalFields: ExternalFieldIndexService) { }

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
    ): Promise<vscode.Definition | null> {
        const rpgDoc = documentCache.get(document);
        const { symbols } = rpgDoc;
        const lineIdx    = position.line;
        const parsedLine = rpgDoc.lines[lineIdx];

        const hit = resolveSymbolAt(document, position, parsedLine);
        if (!hit) { return null; }
        const baseName = hit.name;

        // ── Context-aware lookup on C-spec lines ──────────────────────
        if (parsedLine?.specType === SpecType.Calculation && parsedLine.content) {
            const content = parsedLine.content as CSpecContent;
            const field   = cspecFieldAt(position.character);
            const kind    = field ? cspecSymbolKind(content, field) : null;
            if (kind) {
                const target = lookupByKind(symbols, kind, baseName);
                if (target) { return toLocation(document.uri, target); }
            }
        }

        // ── Fallback: try all symbol tables in priority order ─────────

        // Skip *IN indicators and system constants
        if (baseName.startsWith('*')) { return null; }

        const subroutine = symbols.subroutines.get(baseName);
        if (subroutine) { return toLocation(document.uri, subroutine); }

        const kfield = symbols.kfields.get(baseName);
        if (kfield) { return toLocation(document.uri, kfield); }

        const varDefs = symbols.variables.get(baseName);
        if (varDefs && varDefs.length > 0) {
            return toLocation(document.uri, closestVariableDef(varDefs, lineIdx));
        }

        const field = symbols.fields.get(baseName);
        if (field) { return toLocation(document.uri, field); }

        const array = symbols.arrays.get(baseName);
        if (array) { return toLocation(document.uri, array); }

        const file = symbols.files.get(baseName);
        if (file) { return toLocation(document.uri, file); }

        const tag = symbols.tags.get(baseName);
        if (tag) { return toLocation(document.uri, tag); }

        const klist = symbols.klists.get(baseName);
        if (klist) { return toLocation(document.uri, klist); }

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

function lookupByKind(
    symbols: SymbolTable,
    kind: CSpecSymbolKind,
    name: string,
): BaseSymbol | undefined {
    switch (kind) {
        case 'subroutine': return symbols.subroutines.get(name);
        case 'tag':        return symbols.tags.get(name);
        case 'file':       return symbols.files.get(name);
        case 'keylist':    return symbols.klists.get(name);
        case 'keyfield':   return symbols.kfields.get(name);
    }
}

function toLocation(uri: vscode.Uri, sym: BaseSymbol): vscode.Location {
    return new vscode.Location(uri, sym.definitionRange);
}

/**
 * Cheap filter to avoid firing on obvious non-fields before consulting the
 * external SYSCOLUMNS index: numeric literals, RPG reserved words, names
 * longer than 6 chars (RPG-III field-name limit), and anything outside a
 * C-spec operand field.
 */
function isExternalFieldCandidate(
    baseName: string,
    parsedLine: ParsedLine | undefined,
    position: vscode.Position,
): boolean {
    if (!baseName || baseName.length > 6) { return false; }
    if (/^\d+$/.test(baseName)) { return false; }
    if (RPG_RESERVED.has(baseName)) { return false; }
    if (!parsedLine || parsedLine.specType !== SpecType.Calculation || !parsedLine.content) {
        return false;
    }
    return cspecFieldAt(position.character) !== null;
}
