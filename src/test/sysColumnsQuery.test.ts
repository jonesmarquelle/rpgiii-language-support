import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSysColumnsQuery, resolveFiles, mapRowToHit,
} from '../services/sysColumnsQuery';
import type { SysColumnsRow } from '../services/sysColumnsQuery';

// ── Test data helpers ──────────────────────────────────────────────────────

function row(opts: {
    schema: string;
    table: string;
    column: string;
    text?: string | null;
    dataType?: string;
    length?: number;
    scale?: number | null;
}): SysColumnsRow {
    return {
        TABLE_SCHEMA: opts.schema,
        SYSTEM_TABLE_NAME: opts.table,
        SYSTEM_COLUMN_NAME: opts.column,
        COLUMN_TEXT: opts.text ?? null,
        DATA_TYPE: opts.dataType ?? 'CHARACTER',
        LENGTH: opts.length ?? 10,
        NUMERIC_SCALE: opts.scale ?? null,
    };
}

// ── buildSysColumnsQuery ───────────────────────────────────────────────────

describe('buildSysColumnsQuery', () => {
    it('selects the expected columns from QSYS2.SYSCOLUMNS', () => {
        const sql = buildSysColumnsQuery(['CUSTMAST'], ['MYLIB']);
        assert.ok(sql.includes('SYSTEM_COLUMN_NAME'));
        assert.ok(sql.includes('COLUMN_TEXT'));
        assert.ok(sql.includes('DATA_TYPE'));
        assert.ok(sql.includes('LENGTH'));
        assert.ok(sql.includes('NUMERIC_SCALE'));
        assert.ok(sql.includes('QSYS2.SYSCOLUMNS'));
    });

    it('filters by SYSTEM_TABLE_NAME, not bare TABLE_NAME', () => {
        const sql = buildSysColumnsQuery(['CUSTMAST'], ['MYLIB']);
        assert.ok(sql.includes('SYSTEM_TABLE_NAME IN'), 'must filter by SYSTEM_TABLE_NAME');
        // The bare TABLE_NAME (without SYSTEM_ prefix) must not be used as the file filter.
        // Note: TABLE_SCHEMA in the schema filter is fine; we only care about the file column.
        assert.ok(!sql.match(/(?<!SYSTEM_)TABLE_NAME\s+IN/), 'must not filter by bare TABLE_NAME');
    });

    it('builds a correct single-file IN clause', () => {
        const sql = buildSysColumnsQuery(['CUSTMAST'], ['MYLIB']);
        assert.ok(sql.includes("SYSTEM_TABLE_NAME IN ('CUSTMAST')"), sql);
        assert.ok(sql.includes("TABLE_SCHEMA IN ('MYLIB')"), sql);
    });

    it('builds correct multi-file and multi-schema IN clauses', () => {
        const sql = buildSysColumnsQuery(['CUSTMAST', 'ORDHEAD'], ['MYLIB', 'YOURLIB']);
        assert.ok(sql.includes("'CUSTMAST'"));
        assert.ok(sql.includes("'ORDHEAD'"));
        assert.ok(sql.includes("'MYLIB'"));
        assert.ok(sql.includes("'YOURLIB'"));
    });

    it("escapes single quotes in names (SQL injection safety)", () => {
        const sql = buildSysColumnsQuery(["O'BRIEN"], ["LIB'X"]);
        assert.ok(sql.includes("'O''BRIEN'"), `expected escaped value in: ${sql}`);
        assert.ok(sql.includes("'LIB''X'"),  `expected escaped value in: ${sql}`);
    });
});

// ── resolveFiles ───────────────────────────────────────────────────────────

describe('resolveFiles', () => {
    it('reports found=false when the file is not in any SQL row', () => {
        const result = resolveFiles(['CUSTMAST'], [], ['MYLIB']);
        const entry = result.get('CUSTMAST');
        assert.ok(entry);
        assert.equal(entry.found, false);
        assert.equal(entry.schema, '');
        assert.deepEqual(entry.rows, []);
    });

    it('reports found=false when the file exists but not in the library list', () => {
        const rows = [row({ schema: 'OTHERLIB', table: 'CUSTMAST', column: 'CUST' })];
        // Library list does NOT contain OTHERLIB
        const result = resolveFiles(['CUSTMAST'], rows, ['MYLIB']);
        assert.equal(result.get('CUSTMAST')?.found, false);
    });

    it('resolves a file found in a single library', () => {
        const rows = [
            row({ schema: 'MYLIB', table: 'CUSTMAST', column: 'CUST' }),
            row({ schema: 'MYLIB', table: 'CUSTMAST', column: 'CNAME' }),
        ];
        const result = resolveFiles(['CUSTMAST'], rows, ['MYLIB']);
        const entry = result.get('CUSTMAST');
        assert.ok(entry?.found);
        assert.equal(entry.schema, 'MYLIB');
        assert.equal(entry.rows.length, 2);
    });

    it('picks the first library in list when the same file exists in multiple', () => {
        const rows = [
            row({ schema: 'SECONDLIB', table: 'CUSTMAST', column: 'CUST' }),
            row({ schema: 'FIRSTLIB',  table: 'CUSTMAST', column: 'CUST' }),
        ];
        // FIRSTLIB is first in the library list
        const result = resolveFiles(['CUSTMAST'], rows, ['FIRSTLIB', 'SECONDLIB']);
        const entry = result.get('CUSTMAST');
        assert.ok(entry?.found);
        assert.equal(entry.schema, 'FIRSTLIB');
    });

    it('returns only rows from the winning schema', () => {
        const rows = [
            row({ schema: 'FIRSTLIB',  table: 'CUSTMAST', column: 'CUST' }),
            row({ schema: 'SECONDLIB', table: 'CUSTMAST', column: 'CUST' }),
            row({ schema: 'SECONDLIB', table: 'CUSTMAST', column: 'EXTRA_COL' }),
        ];
        const result = resolveFiles(['CUSTMAST'], rows, ['FIRSTLIB', 'SECONDLIB']);
        const entry = result.get('CUSTMAST');
        assert.ok(entry?.found);
        // Only the FIRSTLIB row — SECONDLIB rows excluded even though it has more columns
        assert.equal(entry.rows.length, 1);
        assert.equal(entry.rows[0].TABLE_SCHEMA, 'FIRSTLIB');
    });

    it('resolves multiple files independently', () => {
        const rows = [
            row({ schema: 'MYLIB', table: 'CUSTMAST', column: 'CUST' }),
            row({ schema: 'MYLIB', table: 'ORDHEAD',  column: 'ORDNO' }),
        ];
        const result = resolveFiles(['CUSTMAST', 'ORDHEAD'], rows, ['MYLIB']);
        assert.equal(result.get('CUSTMAST')?.found, true);
        assert.equal(result.get('ORDHEAD')?.found,  true);
    });

    it('reports every requested file, even those not found', () => {
        const rows = [row({ schema: 'MYLIB', table: 'CUSTMAST', column: 'CUST' })];
        const result = resolveFiles(['CUSTMAST', 'MISSING'], rows, ['MYLIB']);
        assert.equal(result.size, 2);
        assert.equal(result.get('MISSING')?.found, false);
    });

    it('is case-insensitive for file and schema names', () => {
        const rows = [row({ schema: 'mylib', table: 'custmast', column: 'CUST' })];
        const result = resolveFiles(['CUSTMAST'], rows, ['MYLIB']);
        assert.equal(result.get('CUSTMAST')?.found, true);
    });
});

// ── mapRowToHit ────────────────────────────────────────────────────────────

describe('mapRowToHit', () => {
    it('maps column name and file name to uppercase', () => {
        const hit = mapRowToHit(row({ schema: 'mylib', table: 'custmast', column: 'cname' }));
        assert.equal(hit.fieldName, 'CNAME');
        assert.equal(hit.fileName,  'CUSTMAST');
        assert.equal(hit.schema,    'MYLIB');
    });

    it('trims and passes through COLUMN_TEXT', () => {
        const hit = mapRowToHit(row({ schema: 'LIB', table: 'FILE', column: 'COL', text: '  Customer Name  ' }));
        assert.equal(hit.columnText, 'Customer Name');
    });

    it('converts null COLUMN_TEXT to undefined', () => {
        const hit = mapRowToHit(row({ schema: 'LIB', table: 'FILE', column: 'COL', text: null }));
        assert.equal(hit.columnText, undefined);
    });

    it('preserves numeric scale (including null)', () => {
        const withScale = mapRowToHit(row({ schema: 'L', table: 'F', column: 'C', dataType: 'DECIMAL', length: 7, scale: 2 }));
        assert.equal(withScale.numericScale, 2);

        const noScale = mapRowToHit(row({ schema: 'L', table: 'F', column: 'C', dataType: 'CHARACTER', length: 10, scale: null }));
        assert.equal(noScale.numericScale, null);
    });

    it('maps data type and length', () => {
        const hit = mapRowToHit(row({ schema: 'L', table: 'F', column: 'C', dataType: 'DECIMAL', length: 9, scale: 0 }));
        assert.equal(hit.dataType, 'DECIMAL');
        assert.equal(hit.length,   9);
    });

    it('handles empty COLUMN_TEXT string as undefined', () => {
        const hit = mapRowToHit(row({ schema: 'L', table: 'F', column: 'C', text: '   ' }));
        assert.equal(hit.columnText, undefined);
    });
});
