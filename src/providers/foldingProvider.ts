/**
 * foldingProvider.ts
 *
 * Provides folding ranges for RPG-III code blocks:
 *   - BEGSR / ENDSR  (subroutines)
 *   - IF / ENDIF
 *   - DO / ENDDO  (also DOW, DOU)
 *   - SELEC / ENDSL
 *   - Contiguous spec-type sections (F-specs, I-specs, E-specs, etc.)
 */

import * as vscode from 'vscode';
import { documentCache } from '../parser/rpgDocument';
import { SpecType, CSpecContent } from '../types/rpgTypes';
import {
    baseOpcode, FOLD_OPENERS, FOLD_CLOSERS, END_EXCLUDED_OPENERS,
} from '../parser/opcodes';

interface FoldFrame {
    opcode: string;     // base opcode
    startLine: number;
}

export class RpgFoldingProvider implements vscode.FoldingRangeProvider {
    provideFoldingRanges(
        document: vscode.TextDocument,
        _context: vscode.FoldingContext,
        _token: vscode.CancellationToken,
    ): vscode.FoldingRange[] {
        const rpgDoc = documentCache.get(document);
        const ranges: vscode.FoldingRange[] = [];
        const stack: FoldFrame[] = [];

        // ── C-spec block folding ─────────────────────────────────────
        for (const line of rpgDoc.lines) {
            if (line.specType !== SpecType.Calculation) {
                continue;
            }
            const c = line.content as CSpecContent;
            const base = baseOpcode(c.opcode);

            if (FOLD_OPENERS.has(base)) {
                stack.push({ opcode: base, startLine: line.lineNumber });
            } else if (base in FOLD_CLOSERS) {
                // Pop any mismatched frames first (robustness)
                const expected = FOLD_CLOSERS[base];
                let top = stack[stack.length - 1];
                // DOW and DOU both close with ENDDO
                while (
                    top &&
                    top.opcode !== expected &&
                    !(base === 'ENDDO' && (top.opcode === 'DOW' || top.opcode === 'DOU' || top.opcode === 'DO'))
                ) {
                    stack.pop();
                    top = stack[stack.length - 1];
                }
                if (top) {
                    stack.pop();
                    if (top.startLine < line.lineNumber) {
                        ranges.push(new vscode.FoldingRange(
                            top.startLine,
                            line.lineNumber,
                            vscode.FoldingRangeKind.Region,
                        ));
                    }
                }
            } else if (base === 'END') {
                // END is a generic closer for IF, DO, DOW, DOU, SELEC — but NOT BEGSR
                // Walk the stack from top to find the nearest eligible opener
                let idx = stack.length - 1;
                while (idx >= 0 && END_EXCLUDED_OPENERS.has(stack[idx].opcode)) {
                    idx--;
                }
                if (idx >= 0) {
                    const frame = stack[idx];
                    stack.splice(idx, 1);
                    if (frame.startLine < line.lineNumber) {
                        ranges.push(new vscode.FoldingRange(
                            frame.startLine,
                            line.lineNumber,
                            vscode.FoldingRangeKind.Region,
                        ));
                    }
                }
            }
            // Interior markers (ELSE, WHEN, OTHER) — no stack change
        }

        // ── Spec-section folding (contiguous blocks of same spec type) ─
        const sectionSpecs: SpecType[] = [
            SpecType.Header,
            SpecType.File,
            SpecType.Extension,
            SpecType.LineCounter,
            SpecType.Input,
            SpecType.Output,
        ];
        const sectionSet = new Set<SpecType>(sectionSpecs);

        let sectionStart: number | null = null;
        let sectionType: SpecType | null = null;

        for (const line of rpgDoc.lines) {
            const type = line.specType === SpecType.Comment
                ? sectionType  // comments inside a section don't break it
                : line.specType;

            if (type !== null && sectionSet.has(type as SpecType)) {
                if (sectionType === null) {
                    sectionType = type as SpecType;
                    sectionStart = line.lineNumber;
                } else if (type !== sectionType) {
                    // New section type — close current
                    if (sectionStart !== null && line.lineNumber - 1 > sectionStart) {
                        ranges.push(new vscode.FoldingRange(
                            sectionStart,
                            line.lineNumber - 1,
                            vscode.FoldingRangeKind.Region,
                        ));
                    }
                    sectionType = type as SpecType;
                    sectionStart = line.lineNumber;
                }
            } else if (line.specType !== SpecType.Comment && line.specType !== SpecType.Blank) {
                // Non-comment, non-blank line that isn't a section spec — flush
                if (sectionStart !== null && sectionType !== null) {
                    const lastSection = line.lineNumber - 1;
                    if (lastSection > sectionStart) {
                        ranges.push(new vscode.FoldingRange(
                            sectionStart,
                            lastSection,
                            vscode.FoldingRangeKind.Region,
                        ));
                    }
                }
                sectionType = null;
                sectionStart = null;
            }
        }
        // Close trailing section
        if (sectionStart !== null && sectionType !== null) {
            const last = rpgDoc.lines[rpgDoc.lines.length - 1]?.lineNumber ?? sectionStart;
            if (last > sectionStart) {
                ranges.push(new vscode.FoldingRange(sectionStart, last, vscode.FoldingRangeKind.Region));
            }
        }

        return ranges;
    }
}
