/**
 * externalFieldIndex.test.ts
 *
 * Tests for ExternalFieldIndexService.
 *
 * The vscode stub is pre-loaded via `node --require ./out/test/vscodeSetup.js`
 * (see package.json) so standard static imports work here — no mock.module().
 *
 * Instead of mocking documentCache, we feed real RPG F-spec source lines
 * to a fake TextDocument so parseDocument() returns a genuine RpgDocument.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { capturedOutputLines, clearCapturedOutput } from './vscodeSetup';
import { ExternalFieldIndexService } from '../services/externalFieldIndex';
import type { ExternalFieldIndex } from '../services/externalFieldIndex';
import type { SysColumnsRow } from '../services/sysColumnsQuery';
import type { CodeForIbmiAdapter, IbmiConnectionInfo } from '../services/codeForIbmi';

// ── Fake TextDocument helpers ───────────────────────────────────────────────
// Build a real TextDocument-lookalike with actual F-spec lines so that the
// real parseDocument() populates symbols.files from them (no documentCache mock).

function buildFspecLine(filename: string): string {
    const buf: string[] = Array(80).fill(' ');
    buf[5] = 'F';
    [...filename.toUpperCase().padEnd(8)].forEach((c, i) => { buf[6 + i] = c; });
    buf[14] = 'I'; // file type: Input
    buf[15] = 'F'; // designation: Full procedural
    buf[18] = 'E'; // format: Externally described
    [...'DISK'].forEach((c, i) => { buf[38 + i] = c; });
    return buf.join('');
}

let _docSeq = 0;
function fakeDoc(...fspecFiles: string[]) {
    const rawLines = fspecFiles.map(buildFspecLine);
    const uri = `file:///test_${++_docSeq}.rpg`;
    return {
        uri:       { toString: () => uri },
        version:   1,
        languageId: 'rpg',
        lineCount:  rawLines.length,
        lineAt:    (i: number) => ({ text: rawLines[i] }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

// ── SQL row factory ─────────────────────────────────────────────────────────

function sysRow(opts: {
    schema: string; table: string; column: string;
    text?: string | null; dataType?: string; length?: number; scale?: number | null;
}): SysColumnsRow {
    return {
        TABLE_SCHEMA:       opts.schema,
        SYSTEM_TABLE_NAME:  opts.table,
        SYSTEM_COLUMN_NAME: opts.column,
        COLUMN_TEXT:        opts.text    ?? null,
        DATA_TYPE:          opts.dataType ?? 'CHARACTER',
        LENGTH:             opts.length   ?? 10,
        NUMERIC_SCALE:      opts.scale !== undefined ? opts.scale : null,
    };
}

// ── Mock adapter factory ────────────────────────────────────────────────────

function makeMockConnection(opts: {
    libraryList?: string[];
    rows?: SysColumnsRow[];
} = {}): IbmiConnectionInfo & { sqlCallCount: number } {
    let calls = 0;
    const conn = {
        id: 'test-host:test-user',
        libraryList: opts.libraryList ?? ['MYLIB'],
        async runSQL(_sql: string) {
            calls++;
            return opts.rows ?? [] as SysColumnsRow[];
        },
        get sqlCallCount() { return calls; },
    };
    return conn as unknown as IbmiConnectionInfo & { sqlCallCount: number };
}

function makeMockAdapter(opts: {
    available?: boolean;
    connection?: IbmiConnectionInfo | null;
}): CodeForIbmiAdapter {
    return {
        isAvailable:           () => opts.available ?? true,
        getConnection:         async () => opts.connection ?? undefined,
        onDidChangeConnection: () => ({ dispose: () => {} }),
        dispose:               () => {},
    } as unknown as CodeForIbmiAdapter;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ExternalFieldIndexService', () => {
    beforeEach(() => clearCapturedOutput());

    // ── Availability guards ─────────────────────────────────────────────────

    describe('getIndex — availability guards', () => {
        it('returns null when Code for IBM i is not installed', async () => {
            const svc = new ExternalFieldIndexService(
                makeMockAdapter({ available: false }),
            );
            assert.equal(await svc.getIndex(fakeDoc('CUSTMAST')), null);
            svc.dispose();
        });

        it('returns null when Code for IBM i has no active connection', async () => {
            const svc = new ExternalFieldIndexService(
                makeMockAdapter({ available: true, connection: null }),
            );
            assert.equal(await svc.getIndex(fakeDoc('CUSTMAST')), null);
            svc.dispose();
        });
    });

    // ── Empty document ──────────────────────────────────────────────────────

    describe('getIndex — document with no F-specs', () => {
        it('returns an empty index without querying SQL', async () => {
            const conn = makeMockConnection();
            const svc  = new ExternalFieldIndexService(makeMockAdapter({ connection: conn }));
            // fakeDoc() with no args → no source lines → no F-specs
            const result = await svc.getIndex(fakeDoc());
            assert.ok(result, 'should return a non-null index');
            assert.equal(result.fields.size, 0);
            assert.equal(conn.sqlCallCount, 0, 'must not query SQL when document has no F-specs');
            svc.dispose();
        });
    });

    // ── Happy path ──────────────────────────────────────────────────────────

    describe('getIndex — happy path', () => {
        it('builds a correct field map from SQL rows', async () => {
            const conn = makeMockConnection({
                rows: [
                    sysRow({ schema: 'MYLIB', table: 'CUSTMAST', column: 'CUSTNO', text: 'Customer No', dataType: 'DECIMAL', length: 7, scale: 0 }),
                    sysRow({ schema: 'MYLIB', table: 'CUSTMAST', column: 'CNAME',  text: 'Customer Name' }),
                ],
            });
            const svc  = new ExternalFieldIndexService(makeMockAdapter({ connection: conn }));
            const result = await svc.getIndex(fakeDoc('CUSTMAST')) as ExternalFieldIndex;

            assert.ok(result);
            assert.equal(result.fields.size, 2);
            assert.ok(result.fields.has('CUSTNO'));
            assert.ok(result.fields.has('CNAME'));

            const hits = result.fields.get('CUSTNO')!;
            assert.equal(hits.length, 1);
            assert.equal(hits[0].fileName,   'CUSTMAST');
            assert.equal(hits[0].schema,     'MYLIB');
            assert.equal(hits[0].columnText, 'Customer No');
            assert.equal(hits[0].dataType,   'DECIMAL');
            assert.equal(hits[0].length,      7);
            assert.equal(hits[0].numericScale, 0);
            svc.dispose();
        });

        it('merges the same field name across multiple files', async () => {
            const conn = makeMockConnection({
                rows: [
                    sysRow({ schema: 'MYLIB', table: 'CUSTMAST', column: 'PHONE' }),
                    sysRow({ schema: 'MYLIB', table: 'VENDMAST', column: 'PHONE' }),
                ],
            });
            const svc  = new ExternalFieldIndexService(makeMockAdapter({ connection: conn }));
            const result = await svc.getIndex(fakeDoc('CUSTMAST', 'VENDMAST')) as ExternalFieldIndex;

            const hits = result.fields.get('PHONE')!;
            assert.equal(hits.length, 2);
            const fileNames = hits.map(h => h.fileName).sort();
            assert.deepEqual(fileNames, ['CUSTMAST', 'VENDMAST']);
            svc.dispose();
        });

        it('resolves the correct library when file exists in multiple schemas', async () => {
            const conn = makeMockConnection({
                libraryList: ['FIRSTLIB', 'SECONDLIB'],
                rows: [
                    sysRow({ schema: 'SECONDLIB', table: 'CUSTMAST', column: 'CUST' }),
                    sysRow({ schema: 'FIRSTLIB',  table: 'CUSTMAST', column: 'CUST' }),
                ],
            });
            const svc  = new ExternalFieldIndexService(makeMockAdapter({ connection: conn }));
            const result = await svc.getIndex(fakeDoc('CUSTMAST')) as ExternalFieldIndex;

            const hits = result.fields.get('CUST')!;
            // Only one hit — FIRSTLIB is first in library list so it wins
            assert.equal(hits.length, 1);
            assert.equal(hits[0].schema, 'FIRSTLIB');
            svc.dispose();
        });

        it('does not query LIBRARY_LIST_INFO — uses connection.libraryList directly', async () => {
            const sqlStatements: string[] = [];
            const conn = {
                id: 'host:user',
                libraryList: ['MYLIB'],
                async runSQL(sql: string) {
                    sqlStatements.push(sql);
                    return [sysRow({ schema: 'MYLIB', table: 'CUSTMAST', column: 'CUST' })];
                },
            } as unknown as IbmiConnectionInfo;
            const svc = new ExternalFieldIndexService(makeMockAdapter({ connection: conn }));

            await svc.getIndex(fakeDoc('CUSTMAST'));

            assert.equal(sqlStatements.length, 1, 'must issue exactly one SQL statement');
            assert.ok(sqlStatements[0].includes('SYSCOLUMNS'), 'the one query must target SYSCOLUMNS');
            assert.ok(
                !sqlStatements[0].includes('LIBRARY_LIST_INFO'),
                'must not query LIBRARY_LIST_INFO — library list comes from conn.libraryList',
            );
            svc.dispose();
        });

        it('marks files not present in any library with found=false', async () => {
            // SQL returns no rows (file not found in any schema)
            const conn = makeMockConnection({ rows: [] });
            const svc  = new ExternalFieldIndexService(makeMockAdapter({ connection: conn }));
            const result = await svc.getIndex(fakeDoc('MISSING')) as ExternalFieldIndex;

            const entry = result.resolvedFiles.get('MISSING');
            assert.ok(entry, 'file should appear in resolvedFiles');
            assert.equal(entry.found, false);
            svc.dispose();
        });
    });

    // ── Caching ─────────────────────────────────────────────────────────────

    describe('caching', () => {
        it('coalesces concurrent calls into a single SQL query', async () => {
            const conn = makeMockConnection({
                rows: [sysRow({ schema: 'MYLIB', table: 'CUSTMAST', column: 'CUST' })],
            });
            const svc  = new ExternalFieldIndexService(makeMockAdapter({ connection: conn }));
            const doc  = fakeDoc('CUSTMAST');

            // Start two calls before either resolves
            const p1 = svc.getIndex(doc);
            const p2 = svc.getIndex(doc);
            assert.equal(p1, p2, 'concurrent calls for the same URI must return the same Promise');

            await p1;
            assert.equal(conn.sqlCallCount, 1, 'SQL must run exactly once');
            svc.dispose();
        });

        it('returns the cached result on subsequent settled calls', async () => {
            const conn = makeMockConnection({
                rows: [sysRow({ schema: 'MYLIB', table: 'CUSTMAST', column: 'CUST' })],
            });
            const svc = new ExternalFieldIndexService(makeMockAdapter({ connection: conn }));
            const doc = fakeDoc('CUSTMAST');

            const first  = await svc.getIndex(doc);
            const second = await svc.getIndex(doc);
            assert.strictEqual(first, second, 'second call must return the same resolved object');
            assert.equal(conn.sqlCallCount, 1);
            svc.dispose();
        });
    });

    // ── Invalidation ────────────────────────────────────────────────────────

    describe('invalidate', () => {
        it('forces a fresh SQL query after invalidate(uri)', async () => {
            const conn = makeMockConnection({
                rows: [sysRow({ schema: 'MYLIB', table: 'CUSTMAST', column: 'CUST' })],
            });
            const svc = new ExternalFieldIndexService(makeMockAdapter({ connection: conn }));
            const doc = fakeDoc('CUSTMAST');

            await svc.getIndex(doc);
            assert.equal(conn.sqlCallCount, 1);

            svc.invalidate(doc.uri.toString());
            await svc.getIndex(doc);
            assert.equal(conn.sqlCallCount, 2, 'should re-query after URI invalidation');
            svc.dispose();
        });

        it('forces a fresh query after invalidate() with no argument', async () => {
            const conn = makeMockConnection({
                rows: [sysRow({ schema: 'MYLIB', table: 'CUSTMAST', column: 'CUST' })],
            });
            const svc = new ExternalFieldIndexService(makeMockAdapter({ connection: conn }));
            const doc = fakeDoc('CUSTMAST');

            await svc.getIndex(doc);
            svc.invalidate();               // clear all
            await svc.getIndex(doc);
            assert.equal(conn.sqlCallCount, 2);
            svc.dispose();
        });

        it('does not clear the cache for a different document URI', async () => {
            const conn = makeMockConnection({
                rows: [sysRow({ schema: 'MYLIB', table: 'CUSTMAST', column: 'CUST' })],
            });
            const svc = new ExternalFieldIndexService(makeMockAdapter({ connection: conn }));
            const doc = fakeDoc('CUSTMAST');

            await svc.getIndex(doc);
            svc.invalidate('file:///completely-different.rpg');
            await svc.getIndex(doc);
            assert.equal(conn.sqlCallCount, 1, 'cache for this document must be unaffected');
            svc.dispose();
        });
    });

    // ── Logging ─────────────────────────────────────────────────────────────

    describe('logging', () => {
        it('logs file name, SQL query, and row count on a successful fetch', async () => {
            const conn = makeMockConnection({
                rows: [sysRow({ schema: 'MYLIB', table: 'CUSTMAST', column: 'CUST' })],
            });
            const svc = new ExternalFieldIndexService(makeMockAdapter({ connection: conn }));
            await svc.getIndex(fakeDoc('CUSTMAST'));

            const log = capturedOutputLines.join('\n');
            assert.ok(log.includes('CUSTMAST'), 'should log the file name');
            assert.ok(log.includes('SYSCOLUMNS'), 'should log the SQL query');
            assert.ok(log.includes('1 row'), 'should log the row count');
            svc.dispose();
        });

        it('logs when Code for IBM i is not available', async () => {
            const svc = new ExternalFieldIndexService(makeMockAdapter({ available: false }));
            await svc.getIndex(fakeDoc('CUSTMAST'));
            const log = capturedOutputLines.join('\n').toLowerCase();
            assert.ok(
                log.includes('extension') || log.includes('not found') || log.includes('unavailable'),
                `expected a message about the missing extension, got:\n${log}`,
            );
            svc.dispose();
        });

        it('logs when connected but no connection object returned', async () => {
            const svc = new ExternalFieldIndexService(
                makeMockAdapter({ available: true, connection: null }),
            );
            await svc.getIndex(fakeDoc('CUSTMAST'));
            const log = capturedOutputLines.join('\n').toLowerCase();
            assert.ok(
                log.includes('connect') || log.includes('no active') || log.includes('disconnected'),
                `expected a message about no connection, got:\n${log}`,
            );
            svc.dispose();
        });
    });
});
