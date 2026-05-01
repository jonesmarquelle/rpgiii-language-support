/**
 * hoverProvider.ts
 *
 * Shows contextual information when hovering over RPG-III symbols.
 */

import * as vscode from 'vscode';
import { documentCache } from '../parser/rpgDocument';
import { ExternalFieldIndexService } from '../services/externalFieldIndex';
import { CSpecContent, SpecType } from '../types/rpgTypes';
import { cspecFieldAt } from '../parser/cspecContext';
import { RPG_RESERVED } from '../parser/opcodes';
import { closestVariableDef, resolveSymbolAt } from './providerUtils';

export class RpgHoverProvider implements vscode.HoverProvider {
    constructor(private readonly externalFields?: ExternalFieldIndexService) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
    ): Promise<vscode.Hover | null> {
        const rpgDoc = documentCache.get(document);
        const { symbols } = rpgDoc;
        const lineIdx    = position.line;
        const parsedLine = rpgDoc.lines[lineIdx];

        const hit = resolveSymbolAt(document, position, parsedLine);
        if (!hit) { return null; }
        const key = hit.name;
        const hoverRange = hit.range;

        // *IN indicators get a canned tooltip
        if (key.startsWith('*IN')) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${key}** — Indicator\n\n`);
            return new vscode.Hover(md, hoverRange);
        }

        // Skip other system constants
        if (key.startsWith('*')) { return null; }

        // Subroutine
        const sr = symbols.subroutines.get(key);
        if (sr) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${sr.name}** — Subroutine\n\n`);
            md.appendMarkdown(`- Defined at line ${sr.definitionLine + 1}\n`);
            md.appendMarkdown(`- Ends at line ${sr.endLine + 1}\n`);
            return new vscode.Hover(md, hoverRange);
        }

        // Key list (KLIST)
        const klist = symbols.klists.get(key);
        if (klist) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${klist.name}** — Key List\n\n`);
            if (klist.keyFields.length > 0) {
                const formatted = klist.keyFields.map(f => `\`${f}\``);
                md.appendMarkdown(`- Key fields: ${formatted.join(', ')}\n`);
            }
            return new vscode.Hover(md, hoverRange);
        }

        // Key field (KFLD) — check before generic variable/field lookups
        const kfield = symbols.kfields.get(key);
        if (kfield) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${kfield.name}** — Key Field\n\n`);
            md.appendMarkdown(`- Key list: \`${kfield.parentKListName}\`\n`);
            if (this.externalFields) {
                const index = await this.externalFields.getIndex(document);
                const hits = index?.fields.get(key);
                if (hits && hits.length > 0) {
                    const fileNames = [...new Set(hits.map(h => h.fileName))];
                    md.appendMarkdown(`\n- File: ${fileNames.map(f => `\`${f}\``).join(', ')}`);
                    const h = hits[0];
                    md.appendMarkdown(`\n- Length: ${h.length}`);
                    if (h.numericScale !== null && h.numericScale > 0) {
                        md.appendMarkdown(`\n- Decimal positions: \`${h.numericScale}\``);
                    }
                    if (h.dataType) {
                        md.appendMarkdown(`\n- Data type: \`${h.dataType}\``);
                    }
                    if (h.columnText) {
                        md.appendMarkdown(`\n- Description: \`${h.columnText}\``);
                    }
                }
            }
            return new vscode.Hover(md, hoverRange);
        }

        // File
        const file = symbols.files.get(key);
        if (file) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${file.name}** — File Definition\n\n`);
            md.appendMarkdown(`- Type: \`${file.fileType}\` (${fileTypeLabel(file.fileType)})\n`);
            md.appendMarkdown(`- Device: \`${file.device || '?'}\`\n`);
            if (file.designation) {
                md.appendMarkdown(`- Designation: \`${file.designation}\` (${designationLabel(file.designation)})\n`);
            }
            md.appendMarkdown(`- Format: \`${file.format === 'E' ? 'Externally described' : 'Program described'}\``);
            return new vscode.Hover(md, hoverRange);
        }

        // Array
        const arr = symbols.arrays.get(key);
        if (arr) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${arr.name}** — Array\n\n`);
            md.appendMarkdown(`- Entries: ${arr.entriesPerRecord || arr.entriesPerTable}\n`);
            md.appendMarkdown(`- Entry length: ${arr.entryLength} chars\n`);
            if (arr.decPos) {
                md.appendMarkdown(`- Decimal positions: ${arr.decPos}\n`);
            }
            if (arr.dataType) {
                md.appendMarkdown(`- Data type: \`${arr.dataType}\``);
            }
            return new vscode.Hover(md, hoverRange);
        }

        // C-spec variable (position-aware: last declaration at or before this line)
        const varDefs = symbols.variables.get(key);
        if (varDefs && varDefs.length > 0) {
            const closest = closestVariableDef(varDefs, lineIdx);
            const defParsedLine = rpgDoc.lines[closest.definitionLine];
            const defContent = defParsedLine?.content as CSpecContent | undefined;
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${closest.name}** — Variable\n\n`);
            if (defContent?.opcode) {
                md.appendMarkdown(` (\`${defContent.opcode}\`)`);
            }
            if (closest.decPos) {
                md.appendMarkdown(`\n- Decimal positions: ${closest.decPos}`);
            }
            return new vscode.Hover(md, hoverRange);
        }

        // Field (I-spec DS subfields, record fields, and named constants)
        const field = symbols.fields.get(key);
        if (field) {
            // Named constant — show the value text, truncated if needed
            if (field.dataType === 'C') {
                const md = new vscode.MarkdownString();
                const MAX = 30;
                const val = field.constantValue;
                const tooLong = val.length > MAX;
                const display = tooLong ? val.slice(0, MAX) : val;
                const suffix = (field.constantTruncated || tooLong) ? '...' : '';
                md.appendMarkdown(`**${field.name}** — Named Constant\n\n\`'${display}${suffix}'\``);
                return new vscode.Hover(md, hoverRange);
            }
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${field.name}** — Field\n\n`);
            if (field.parentDsName) {
                md.appendMarkdown(`- Data Structure: \`${field.parentDsName}\`\n`);
            }
            md.appendMarkdown(`- From: \`${field.fromPos}\`, To: \`${field.toPos}\`\n`);
            const len = field.toPos - field.fromPos + 1;
            md.appendMarkdown(`- Length: \`${len}\`\n`);
            if (field.decPos) {
                md.appendMarkdown(`- Decimal positions: \`${field.decPos}\`\n`);
            }
            if (field.dataType) {
                md.appendMarkdown(`- Data type: \`${field.dataType}\` (${dataTypeLabel(field.dataType)})`);
            }
            if (this.externalFields) {
                const index = await this.externalFields.getIndex(document);
                const columnText = index?.fields.get(key)?.[0]?.columnText;
                if (columnText) {
                    md.appendMarkdown(`\n- Description: \`${columnText}\``);
                }
            }
            return new vscode.Hover(md, hoverRange);
        }

        // Tag
        const tag = symbols.tags.get(key);
        if (tag) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${tag.name}** — Tag / Label\n\n`);
            md.appendMarkdown(`- Defined at line ${tag.definitionLine + 1}\n`);
            return new vscode.Hover(md, hoverRange);
        }

        // External DB fields — fallback for fields used in C-spec operands that
        // have no local symbol (externally described file fields with no I-spec).
        if (
            this.externalFields &&
            key.length <= 6 &&
            !/^\d+$/.test(key) &&
            !RPG_RESERVED.has(key) &&
            parsedLine?.specType === SpecType.Calculation &&
            cspecFieldAt(position.character) !== null
        ) {
            const index = await this.externalFields.getIndex(document);
            const hits = index?.fields.get(key);
            if (hits && hits.length > 0) {
                const md = new vscode.MarkdownString();
                md.appendMarkdown(`**${key}** — Field\n\n`);
                const fileNames = [...new Set(hits.map(h => h.fileName))];
                md.appendMarkdown(`- File: ${fileNames.map(f => `\`${f}\``).join(', ')}\n`);
                const h = hits[0];
                md.appendMarkdown(`- Length: \`${h.length}\`\n`);
                if (h.numericScale !== null && h.numericScale > 0) {
                    md.appendMarkdown(`- Decimal positions: \`${h.numericScale}\`\n`);
                }
                if (h.dataType) {
                    md.appendMarkdown(`- Data type: \`${h.dataType}\`\n`);
                }
                if (h.columnText) {
                    md.appendMarkdown(`- Description: \`${h.columnText}\``);
                }
                return new vscode.Hover(md, hoverRange);
            }
        }

        return null;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function fileTypeLabel(type: string): string {
    switch (type.toUpperCase()) {
        case 'I': return 'Input';
        case 'O': return 'Output';
        case 'U': return 'Update';
        case 'C': return 'Combined';
        default: return type;
    }
}

function designationLabel(d: string): string {
    switch (d.toUpperCase()) {
        case 'P': return 'Primary';
        case 'S': return 'Secondary';
        case 'R': return 'Record-address';
        case 'T': return 'Array/Table';
        case 'F': return 'Full-procedural';
        default: return d;
    }
}

function dataTypeLabel(t: string): string {
    switch (t.toUpperCase()) {
        case 'P': return 'Packed decimal';
        case 'B': return 'Binary';
        case 'L': return 'Left-justified';
        case 'R': return 'Right-justified';
        default: return 'Character';
    }
}
