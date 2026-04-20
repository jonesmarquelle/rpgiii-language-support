/**
 * Minimal mock of the VSCode API surface used by this extension's runtime code.
 * Only the pieces that production code references at module scope or during
 * unit tests are implemented — no editor, no providers are wired up.
 */

export class Position {
    constructor(public readonly line: number, public readonly character: number) {}
    isEqual(other: Position): boolean {
        return this.line === other.line && this.character === other.character;
    }
    translate(lineDelta = 0, characterDelta = 0): Position {
        return new Position(this.line + lineDelta, this.character + characterDelta);
    }
}

export class Range {
    public readonly start: Position;
    public readonly end: Position;

    constructor(
        startLineOrStart: number | Position,
        startCharOrEnd: number | Position,
        endLine?: number,
        endChar?: number,
    ) {
        if (typeof startLineOrStart === 'number') {
            this.start = new Position(startLineOrStart, startCharOrEnd as number);
            this.end = new Position(endLine as number, endChar as number);
        } else {
            this.start = startLineOrStart;
            this.end = startCharOrEnd as Position;
        }
    }

    contains(pos: Position): boolean {
        if (pos.line < this.start.line || pos.line > this.end.line) { return false; }
        if (pos.line === this.start.line && pos.character < this.start.character) { return false; }
        if (pos.line === this.end.line && pos.character > this.end.character) { return false; }
        return true;
    }

    isEqual(other: Range): boolean {
        return this.start.isEqual(other.start) && this.end.isEqual(other.end);
    }
}

export class Location {
    constructor(public readonly uri: Uri, public readonly range: Range) {}
}

export class Uri {
    static parse(s: string): Uri { return new Uri(s); }
    static file(path: string): Uri { return new Uri('file://' + path); }
    constructor(private readonly s: string) {}
    toString(): string { return this.s; }
}

export enum FoldingRangeKind {
    Comment = 1,
    Imports = 2,
    Region  = 3,
}

export class FoldingRange {
    constructor(
        public readonly start: number,
        public readonly end: number,
        public readonly kind?: FoldingRangeKind,
    ) {}
}

export enum SymbolKind {
    File = 0,
    Module = 1,
    Namespace = 2,
    Package = 3,
    Class = 4,
    Method = 5,
    Property = 6,
    Field = 7,
    Constructor = 8,
    Enum = 9,
    Interface = 10,
    Function = 11,
    Variable = 12,
    Constant = 13,
    String = 14,
    Number = 15,
    Boolean = 16,
    Array = 17,
    Object = 18,
    Key = 19,
    Null = 20,
    EnumMember = 21,
    Struct = 22,
    Event = 23,
    Operator = 24,
    TypeParameter = 25,
}

export class DocumentSymbol {
    public children: DocumentSymbol[] = [];
    constructor(
        public name: string,
        public detail: string,
        public kind: SymbolKind,
        public range: Range,
        public selectionRange: Range,
    ) {}
}

export class MarkdownString {
    public value = '';
    appendMarkdown(text: string): this { this.value += text; return this; }
}

export class Hover {
    constructor(
        public readonly contents: MarkdownString | MarkdownString[],
        public readonly range?: Range,
    ) {}
}

export class SemanticTokensLegend {
    constructor(
        public readonly tokenTypes: string[],
        public readonly tokenModifiers: string[],
    ) {}
}

export interface SemanticTokensPush {
    line: number;
    startChar: number;
    length: number;
    tokenType: number;
    tokenModifiers: number;
}

export class SemanticTokens {
    constructor(public readonly data: Uint32Array) {}
}

export class SemanticTokensBuilder {
    public readonly pushes: SemanticTokensPush[] = [];
    constructor(_legend?: SemanticTokensLegend) {}
    push(line: number, startChar: number, length: number, tokenType: number, tokenModifiers: number): void {
        this.pushes.push({ line, startChar, length, tokenType, tokenModifiers });
    }
    build(): SemanticTokens {
        // Real builder returns delta-encoded Uint32Array; tests read `pushes` directly.
        return new SemanticTokens(new Uint32Array());
    }
}

// ─── TextDocument helper used by tests ─────────────────────────────────────

export class MockTextDocument {
    public version = 1;
    public uri: Uri;
    constructor(
        public readonly text: string,
        uri: string = 'file:///test.rpg',
    ) {
        this.uri = new Uri(uri);
    }

    get lineCount(): number {
        return this.text.split('\n').length;
    }

    lineAt(line: number): { text: string; lineNumber: number } {
        const lines = this.text.split('\n');
        return { text: lines[line] ?? '', lineNumber: line };
    }

    getText(range?: Range): string {
        if (!range) { return this.text; }
        const lines = this.text.split('\n');
        if (range.start.line === range.end.line) {
            return (lines[range.start.line] ?? '').slice(range.start.character, range.end.character);
        }
        const parts: string[] = [];
        parts.push((lines[range.start.line] ?? '').slice(range.start.character));
        for (let i = range.start.line + 1; i < range.end.line; i++) {
            parts.push(lines[i] ?? '');
        }
        parts.push((lines[range.end.line] ?? '').slice(0, range.end.character));
        return parts.join('\n');
    }

    getWordRangeAtPosition(position: Position, regex: RegExp): Range | undefined {
        const line = this.lineAt(position.line).text;
        const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
        const re = new RegExp(regex.source, flags);
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
            const start = m.index;
            const end = m.index + m[0].length;
            if (position.character >= start && position.character < end) {
                return new Range(position.line, start, position.line, end);
            }
            if (m.index === re.lastIndex) { re.lastIndex++; }
        }
        return undefined;
    }
}

// ─── Stubs for APIs the extension module registers on activate ─────────────

export const languages = {
    registerDocumentSemanticTokensProvider: () => ({ dispose(): void {} }),
    registerFoldingRangeProvider:            () => ({ dispose(): void {} }),
    registerDocumentSymbolProvider:          () => ({ dispose(): void {} }),
    registerDefinitionProvider:              () => ({ dispose(): void {} }),
    registerHoverProvider:                   () => ({ dispose(): void {} }),
};

export const workspace = {
    onDidChangeTextDocument: () => ({ dispose(): void {} }),
    onDidCloseTextDocument:  () => ({ dispose(): void {} }),
};
