/**
 * hoverProvider.ts
 *
 * Shows contextual information when hovering over RPG-III symbols.
 */

import * as vscode from 'vscode';
import { documentCache } from '../parser/rpgDocument';
import { CSpecContent, SpecType, wordAtColumn } from '../types/rpgTypes';

export class RpgHoverProvider implements vscode.HoverProvider {
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
    ): vscode.Hover | null {
        const rpgDoc = documentCache.get(document);
        const { symbols } = rpgDoc;

        // Comma excluded so PATH,X yields PATH or X based on cursor position
        const wordRange = document.getWordRangeAtPosition(position, /[\$#@*]?[\w#@$]+/);
        if (!wordRange) {
            return null;
        }
        let key = document.getText(wordRange).toUpperCase();
        let hoverRange: vscode.Range = wordRange;

        // On C-spec lines the regex can bleed across fixed-column field boundaries.
        // Re-extract within the field and correct the highlight range.
        const lineIdx = position.line;
        const parsedLine = rpgDoc.lines[lineIdx];
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
                key = hit.word;
                hoverRange = new vscode.Range(position.line, hit.start, position.line, hit.end);
            }
        }

        // Skip indicators
        if (key.startsWith('*IN')) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${key}** — RPG-III Indicator\n\n`);
            md.appendMarkdown('Numeric indicator field. Can be set via `SETON`/`SETOF` or resulting indicators.');
            return new vscode.Hover(md, hoverRange);
        }

        // Skip other system constants
        if (key.startsWith('*')) {
            return null;
        }

        // Subroutine
        const sr = symbols.subroutines.get(key);
        if (sr) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${sr.name}** — Subroutine\n\n`);
            md.appendMarkdown(`- Defined at line ${sr.definitionLine + 1}\n`);
            md.appendMarkdown(`- Ends at line ${sr.endLine + 1}\n`);
            md.appendMarkdown(`- Call with \`EXSR ${sr.name}\``);
            return new vscode.Hover(md, hoverRange);
        }

        // Key list (KLIST)
        const klist = symbols.klists.get(key);
        if (klist) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${klist.name}** — Key List\n\n`);
            md.appendMarkdown(`- Defined at line ${klist.definitionLine + 1}\n`);
            if (klist.keyFields.length > 0) {
                let klist_formatted = klist.keyFields.map(f => `\`${f}\``)
                md.appendMarkdown(`- Key fields: ${klist_formatted.join(', ')}\n`);
            }
            md.appendMarkdown(`- Used as search argument in \`CHAIN\`, \`SETLL\`, \`SETGT\`, \`READE\``);
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
            const lineIdx = position.line;
            let closest = varDefs[0];
            for (const def of varDefs) {
                if (def.definitionLine <= lineIdx) {
                    closest = def;
                }
            }
            const defParsedLine = rpgDoc.lines[closest.definitionLine];
            const defContent = defParsedLine?.content as CSpecContent | undefined;
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${closest.name}** — Variable\n\n`);
            md.appendMarkdown(`- Declared at line ${closest.definitionLine + 1}`);
            if (defContent?.opcode) {
                md.appendMarkdown(` (\`${defContent.opcode}\`)`);
            }
            if (closest.decPos) {
                md.appendMarkdown(`\n- Decimal positions: ${closest.decPos}`);
            }
            return new vscode.Hover(md, hoverRange);
        }

        // Field (I-spec DS subfields and record fields)
        const field = symbols.fields.get(key);
        if (field) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${field.name}** — Field\n\n`);
            if (field.parentDsName) {
                md.appendMarkdown(`- Data Structure: \`${field.parentDsName}\`\n`);
            }
            md.appendMarkdown(`- From: ${field.fromPos}, To: ${field.toPos}\n`);
            const len = field.toPos - field.fromPos + 1;
            md.appendMarkdown(`- Length: ${len}\n`);
            if (field.decPos) {
                md.appendMarkdown(`- Decimal positions: ${field.decPos}\n`);
            }
            if (field.dataType) {
                md.appendMarkdown(`- Data type: \`${field.dataType}\` (${dataTypeLabel(field.dataType)})`);
            }
            return new vscode.Hover(md, hoverRange);
        }

        // Tag
        const tag = symbols.tags.get(key);
        if (tag) {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${tag.name}** — Tag / Label\n\n`);
            md.appendMarkdown(`- Defined at line ${tag.definitionLine + 1}\n`);
            md.appendMarkdown(`- Target of \`GOTO\` or \`CAB\` operations`);
            return new vscode.Hover(md, hoverRange);
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
