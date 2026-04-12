/**
 * documentSymbolProvider.ts
 *
 * Populates the VSCode Outline panel with RPG-III program symbols:
 *   - Files (from F-specs)
 *   - Arrays (from E-specs)
 *   - Data Structures and their fields (from I-specs)
 *   - Subroutines (from BEGSR/ENDSR pairs in C-specs)
 *   - Tags (from TAG opcode)
 */

import * as vscode from 'vscode';
import { documentCache } from '../parser/rpgDocument';

export class RpgDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ): vscode.DocumentSymbol[] {
        const rpgDoc = documentCache.get(document);
        const { symbols } = rpgDoc;
        const result: vscode.DocumentSymbol[] = [];

        // ── Files ────────────────────────────────────────────────────
        if (symbols.files.size > 0) {
            const container = new vscode.DocumentSymbol(
                'Files',
                '',
                vscode.SymbolKind.Namespace,
                firstLastRange([...symbols.files.values()].map(s => s.definitionLine)),
                firstLastRange([...symbols.files.values()].map(s => s.definitionLine)),
            );
            for (const file of symbols.files.values()) {
                const detail = `${fileTypeLabel(file.fileType)} — ${file.device || '?'}`;
                const sym = new vscode.DocumentSymbol(
                    file.name,
                    detail,
                    vscode.SymbolKind.File,
                    file.definitionRange,
                    file.definitionRange,
                );
                container.children.push(sym);
            }
            result.push(container);
        }

        // ── Arrays ───────────────────────────────────────────────────
        if (symbols.arrays.size > 0) {
            const container = new vscode.DocumentSymbol(
                'Arrays',
                '',
                vscode.SymbolKind.Namespace,
                firstLastRange([...symbols.arrays.values()].map(s => s.definitionLine)),
                firstLastRange([...symbols.arrays.values()].map(s => s.definitionLine)),
            );
            for (const arr of symbols.arrays.values()) {
                const detail = `${arr.entryLength} chars × ${arr.entriesPerRecord || arr.entriesPerTable}`;
                const sym = new vscode.DocumentSymbol(
                    arr.name,
                    detail,
                    vscode.SymbolKind.Array,
                    arr.definitionRange,
                    arr.definitionRange,
                );
                container.children.push(sym);
            }
            result.push(container);
        }

        // ── Data Structures ──────────────────────────────────────────
        if (symbols.dataStructures.length > 0) {
            const dsLines = symbols.dataStructures.map(ds => ds.definitionLine);
            const container = new vscode.DocumentSymbol(
                'Data Structures',
                '',
                vscode.SymbolKind.Namespace,
                firstLastRange(dsLines),
                firstLastRange(dsLines),
            );
            for (const ds of symbols.dataStructures) {
                const name = ds.name || '(anonymous)';
                const detail = ds.dsType || '';
                // Range spans from DS header to last field
                const lastFieldLine = ds.fields.length > 0
                    ? ds.fields[ds.fields.length - 1].definitionLine
                    : ds.definitionLine;
                const dsRange = new vscode.Range(ds.definitionLine, 0, lastFieldLine, 999);

                const dsSym = new vscode.DocumentSymbol(
                    name,
                    detail,
                    vscode.SymbolKind.Struct,
                    dsRange,
                    ds.definitionRange,
                );
                for (const field of ds.fields) {
                    const fieldDetail = `${field.fromPos}–${field.toPos}${field.decPos ? ` dec:${field.decPos}` : ''}`;
                    const fieldSym = new vscode.DocumentSymbol(
                        field.name,
                        fieldDetail,
                        vscode.SymbolKind.Field,
                        field.definitionRange,
                        field.definitionRange,
                    );
                    dsSym.children.push(fieldSym);
                }
                container.children.push(dsSym);
            }
            result.push(container);
        }

        // ── Subroutines ──────────────────────────────────────────────
        if (symbols.subroutines.size > 0) {
            const srLines = [...symbols.subroutines.values()].map(s => s.definitionLine);
            const container = new vscode.DocumentSymbol(
                'Subroutines',
                '',
                vscode.SymbolKind.Namespace,
                firstLastRange(srLines),
                firstLastRange(srLines),
            );
            for (const sr of symbols.subroutines.values()) {
                const srRange = new vscode.Range(sr.definitionLine, 0, sr.endLine, 999);
                const sym = new vscode.DocumentSymbol(
                    sr.name,
                    '',
                    vscode.SymbolKind.Function,
                    srRange,
                    sr.definitionRange,
                );
                container.children.push(sym);
            }
            result.push(container);
        }

        // ── Tags (GOTO labels) ───────────────────────────────────────
        if (symbols.tags.size > 0) {
            const tagLines = [...symbols.tags.values()].map(s => s.definitionLine);
            const container = new vscode.DocumentSymbol(
                'Tags',
                '',
                vscode.SymbolKind.Namespace,
                firstLastRange(tagLines),
                firstLastRange(tagLines),
            );
            for (const tag of symbols.tags.values()) {
                const sym = new vscode.DocumentSymbol(
                    tag.name,
                    '',
                    vscode.SymbolKind.Key,
                    tag.definitionRange,
                    tag.definitionRange,
                );
                container.children.push(sym);
            }
            result.push(container);
        }

        return result;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function firstLastRange(lines: number[]): vscode.Range {
    if (lines.length === 0) {
        return new vscode.Range(0, 0, 0, 0);
    }
    const first = Math.min(...lines);
    const last  = Math.max(...lines);
    return new vscode.Range(first, 0, last, 999);
}

function fileTypeLabel(type: string): string {
    switch (type.toUpperCase()) {
        case 'I': return 'Input';
        case 'O': return 'Output';
        case 'U': return 'Update';
        case 'C': return 'Combined';
        default: return type;
    }
}
