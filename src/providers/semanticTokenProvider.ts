/**
 * semanticTokenProvider.ts
 *
 * Provides context-aware token coloring on top of the tmLanguage baseline:
 *   - Subroutine names in BEGSR/ENDSR/EXSR → "function" token type
 *   - File names in F-spec lines → "type" token type
 *   - Array names in E-spec lines → "type" token type
 *   - DS field names in I-spec lines → "variable.declaration" token type
 *   - Known symbol references in C-spec Factor 1/2/Result → colored by symbol kind
 */

import * as vscode from 'vscode';
import { documentCache } from '../parser/rpgDocument';
import { SpecType, CSpecContent, FSpecContent, ISpecContent, ESpecContent } from '../types/rpgTypes';

// Must match package.json contributes.semanticTokenScopes tokenTypes array (0-indexed)
export const TOKEN_TYPES = ['type', 'variable', 'function', 'parameter'];
export const TOKEN_MODIFIERS = ['declaration', 'definition', 'readonly'];

const TYPE_IDX: Record<string, number> = {
    type:      0,
    variable:  1,
    function:  2,
    parameter: 3,
};
const MOD_IDX: Record<string, number> = {
    declaration: 0,
    definition:  1,
    readonly:    2,
};

function modBit(mod: string): number {
    return 1 << (MOD_IDX[mod] ?? 0);
}

// Opcodes that reference a subroutine name in Factor 2
const SR_F2_OPS = new Set([
    'EXSR', 'CAS', 'CASGT', 'CASLT', 'CASEQ', 'CASGE', 'CASLE', 'CASNE',
]);
// Opcodes that reference a subroutine name in Factor 1
const SR_F1_OPS = new Set(['BEGSR', 'ENDSR']);
// Opcodes whose Factor 2 is a tag/label name
const GOTO_OPS = new Set(['GOTO', 'CAB', 'CABGT', 'CABLT', 'CABEQ', 'CABGE', 'CABLE', 'CABNE']);
// Opcodes whose Factor 1 can be a KLIST name
const KLIST_OPS_F1 = new Set(['CHAIN', 'SETLL', 'SETGT', 'READE', 'READPE']);

export class RpgSemanticTokenProvider implements vscode.DocumentSemanticTokensProvider {
    readonly legend = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);

    provideDocumentSemanticTokens(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ): vscode.SemanticTokens {
        const rpgDoc = documentCache.get(document);
        const builder = new vscode.SemanticTokensBuilder(this.legend);

        for (const line of rpgDoc.lines) {
            const { lineNumber, specType, content } = line;

            switch (specType) {
                case SpecType.File: {
                    // Color the filename as a "type"
                    const f = content as FSpecContent;
                    if (f && f.filename) {
                        const [s, e] = f.filenameRange;
                        if (e > s) {
                            builder.push(lineNumber, s, e - s, TYPE_IDX.type, modBit('declaration'));
                        }
                    }
                    break;
                }

                case SpecType.Extension: {
                    // Color the array name as a "type"
                    const e = content as ESpecContent;
                    if (e && e.arrayName) {
                        const [s, end] = e.arrayNameRange;
                        if (end > s) {
                            builder.push(lineNumber, s, end - s, TYPE_IDX.type, modBit('declaration'));
                        }
                    }
                    break;
                }

                case SpecType.Input: {
                    // Color DS field names as "variable" declarations
                    const i = content as ISpecContent;
                    if (i && i.fieldName && !i.isDataStructure) {
                        const [s, e] = i.fieldNameRange;
                        if (e > s) {
                            builder.push(lineNumber, s, e - s, TYPE_IDX.variable, modBit('declaration'));
                        }
                    }
                    break;
                }

                case SpecType.Calculation: {
                    const c = content as CSpecContent;
                    if (!c) {
                        break;
                    }
                    const opcode = c.opcode;
                    const { symbols } = rpgDoc;

                    // ── Factor 1 ───────────────────────────────────
                    if (c.factor1) {
                        const [s, e] = c.factor1Range;
                        if (e > s) {
                            const f1Key = c.factor1.toUpperCase();
                            if (SR_F1_OPS.has(opcode)) {
                                // Subroutine name → function declaration
                                builder.push(lineNumber, s, e - s, TYPE_IDX.function, modBit('declaration'));
                            } else if (opcode === 'TAG') {
                                // Tag definition site → parameter declaration
                                builder.push(lineNumber, s, e - s, TYPE_IDX.parameter, modBit('declaration'));
                            } else if (opcode === 'KLIST') {
                                // KLIST definition → function declaration (same colour family as BEGSR)
                                builder.push(lineNumber, s, e - s, TYPE_IDX.function, modBit('declaration'));
                            } else if (KLIST_OPS_F1.has(opcode) && symbols.klists.has(f1Key)) {
                                // CHAIN/SETLL/SETGT using a named key list → function reference
                                builder.push(lineNumber, s, e - s, TYPE_IDX.function, 0);
                            } else if (symbols.subroutines.has(f1Key)) {
                                builder.push(lineNumber, s, e - s, TYPE_IDX.function, 0);
                            } else if (symbols.tags.has(f1Key)) {
                                builder.push(lineNumber, s, e - s, TYPE_IDX.parameter, 0);
                            } else if (symbols.fields.has(f1Key) || symbols.variables.has(f1Key)) {
                                builder.push(lineNumber, s, e - s, TYPE_IDX.variable, 0);
                            }
                            // Arrays, files — leave to tmLanguage baseline
                        }
                    }

                    // ── Factor 2 ───────────────────────────────────
                    if (c.factor2) {
                        const [s, e] = c.factor2Range;
                        if (e > s) {
                            const f2Key = c.factor2.split(',')[0].toUpperCase();
                            if (SR_F2_OPS.has(opcode) && symbols.subroutines.has(f2Key)) {
                                builder.push(lineNumber, s, e - s, TYPE_IDX.function, 0);
                            } else if (GOTO_OPS.has(opcode) && symbols.tags.has(f2Key)) {
                                // GOTO / CAB target → parameter
                                builder.push(lineNumber, s, e - s, TYPE_IDX.parameter, 0);
                            } else if (symbols.fields.has(f2Key) || symbols.variables.has(f2Key)) {
                                builder.push(lineNumber, s, e - s, TYPE_IDX.variable, 0);
                            } else if (symbols.files.has(f2Key)) {
                                builder.push(lineNumber, s, e - s, TYPE_IDX.type, 0);
                            } else if (symbols.arrays.has(f2Key)) {
                                builder.push(lineNumber, s, e - s, TYPE_IDX.type, 0);
                            }
                        }
                    }

                    // ── Result field ───────────────────────────────
                    if (c.resultField) {
                        const [s, e] = c.resultRange;
                        if (e > s) {
                            const rKey = c.resultField.toUpperCase();
                            if (opcode === 'KFLD' && symbols.kfields.has(rKey)) {
                                // Key field declaration — parameter colour (distinct from KLIST/function)
                                builder.push(lineNumber, s, e - s, TYPE_IDX.parameter, modBit('declaration'));
                            } else if (symbols.fields.has(rKey)) {
                                builder.push(lineNumber, s, e - s, TYPE_IDX.variable, modBit('definition'));
                            }
                        }
                    }
                    break;
                }

                default:
                    break;
            }
        }

        return builder.build();
    }
}
