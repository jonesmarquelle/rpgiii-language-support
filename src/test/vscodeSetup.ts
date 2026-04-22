/**
 * vscodeSetup.ts
 *
 * Loaded via `node --require ./out/test/vscodeSetup.js` before any test file.
 * Registers a minimal 'vscode' stub in the CommonJS module cache so that
 * extension modules which import 'vscode' can be exercised in plain-node tests.
 *
 * Also exports capturedOutputLines / clearCapturedOutput for log assertions.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
const Module = require('module') as any;

// Intercept module resolution so `require('vscode')` returns a known cache key.
const _origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request: string, ...args: unknown[]) {
    if (request === 'vscode') { return 'vscode'; }
    return _origResolve(request, ...args) as string;
};

// ── Output capture ──────────────────────────────────────────────────────────

export const capturedOutputLines: string[] = [];
export function clearCapturedOutput(): void { capturedOutputLines.length = 0; }

// ── Stub implementations ────────────────────────────────────────────────────

class MockRange {
    readonly start: { line: number; character: number };
    readonly end:   { line: number; character: number };
    constructor(
        public readonly c0: number, public readonly c1: number,
        public readonly c2: number, public readonly c3: number,
    ) {
        this.start = { line: c0, character: c1 };
        this.end   = { line: c2, character: c3 };
    }
}

class MockFoldingRange {
    constructor(
        public readonly start: number, public readonly end: number,
        public readonly kind: number,
    ) {}
}

class MockEventEmitter<T> {
    private _ls: Array<(v: T) => void> = [];
    readonly event = (l: (v: T) => void) => {
        this._ls.push(l);
        return { dispose: () => { this._ls = this._ls.filter(x => x !== l); } };
    };
    fire(v: T) { [...this._ls].forEach(l => l(v)); }
    dispose()  { this._ls = []; }
}

const vscodeStub = {
    Range:           MockRange,
    FoldingRange:    MockFoldingRange,
    FoldingRangeKind: { Region: 1, Imports: 2, Comment: 3 },
    EventEmitter:    MockEventEmitter,
    window: {
        createOutputChannel: () => ({
            appendLine: (s: string) => { capturedOutputLines.push(s); },
            dispose:    () => {},
        }),
        showInformationMessage: async () => undefined,
        showWarningMessage:     async () => undefined,
        setStatusBarMessage:    (_: string, p: Promise<unknown>) => {
            void p; return { dispose: () => {} };
        },
    },
};

(require.cache as Record<string, unknown>)['vscode'] = {
    id: 'vscode', filename: 'vscode', loaded: true,
    exports: vscodeStub, paths: [], children: [],
};
