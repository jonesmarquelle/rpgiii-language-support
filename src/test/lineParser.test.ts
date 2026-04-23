import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSpec, parseFSpec, parseISpec, parseESpec } from '../parser/lineParser';

// Helper: fixed-column RPG line builder. Places each `(colIndex, text)` pair
// at the given 0-based column, padding with spaces, returning an 80-char line.
function rpgLine(...entries: Array<[number, string]>): string {
    const buf = ' '.repeat(80).split('');
    for (const [col, text] of entries) {
        for (let i = 0; i < text.length; i++) { buf[col + i] = text[i]; }
    }
    return buf.join('');
}

describe('parseCSpec', () => {
    // Columns: spec letter at 5, factor1 @17, opcode @27, factor2 @32, result @42, fieldLen @48
    const line = rpgLine([5, 'C'], [17, 'COUNT'], [27, 'ADD  '], [32, '1'], [42, 'COUNT'], [48, ' 50']);

    it('extracts factor1, opcode, factor2, result', () => {
        const c = parseCSpec(line);
        assert.equal(c.factor1, 'COUNT');
        assert.equal(c.opcode,  'ADD');
        assert.equal(c.factor2, '1');
        assert.equal(c.resultField, 'COUNT');
        assert.equal(c.fieldLen, '50');
    });

    it('uppercases the opcode', () => {
        const low = rpgLine([5, 'C'], [27, 'exsr '], [32, 'MYSR']);
        assert.equal(parseCSpec(low).opcode, 'EXSR');
    });

    it('reports trimmed column ranges', () => {
        const c = parseCSpec(line);
        // factor1 = "COUNT" starting at col 17
        assert.deepEqual(c.factor1Range, [17, 22]);
        // opcode  = "ADD"   starting at col 27
        assert.deepEqual(c.opcodeRange,  [27, 30]);
        // factor2 = "1"     starting at col 32
        assert.deepEqual(c.factor2Range, [32, 33]);
        // result  = "COUNT" starting at col 42
        assert.deepEqual(c.resultRange,  [42, 47]);
    });

    it('returns empty ranges for blank fields', () => {
        const blank = rpgLine([5, 'C']);
        const c = parseCSpec(blank);
        assert.deepEqual(c.factor1Range, [17, 17]);
        assert.deepEqual(c.factor2Range, [32, 32]);
        assert.deepEqual(c.resultRange,  [42, 42]);
    });

    it('handles short lines without throwing', () => {
        const short = '     C';
        const c = parseCSpec(short);
        assert.equal(c.factor1, '');
        assert.equal(c.opcode,  '');
        assert.equal(c.resultField, '');
    });
});

describe('parseFSpec', () => {
    // Columns: filename @6, file type @14, designation @15, sequence @17, format @18, device @39
    const line = rpgLine([5, 'F'], [6, 'CUSTMAST'], [14, 'I'], [15, 'P'], [17, 'A'], [18, 'F'], [23, '0100'], [39, 'DISK   ']);

    it('extracts filename and metadata', () => {
        const f = parseFSpec(line, false);
        assert.equal(f.filename,    'CUSTMAST');
        assert.equal(f.fileType,    'I');
        assert.equal(f.designation, 'P');
        assert.equal(f.sequence,    'A');
        assert.equal(f.format,      'F');
        assert.equal(f.recordLen,   '0100');
        assert.equal(f.device,      'DISK');
        assert.equal(f.isContinuation, false);
    });

    it('detects device keywords anywhere in the device column', () => {
        for (const dev of ['WORKSTN', 'PRINTER', 'SPECIAL', 'DISK', 'SEQ']) {
            const l = rpgLine([5, 'F'], [6, 'TEST'], [39, dev]);
            assert.equal(parseFSpec(l, false).device, dev);
        }
    });

    it('marks continuation lines', () => {
        const c = parseFSpec(line, true);
        assert.equal(c.isContinuation, true);
    });

    it('reports filename range', () => {
        const f = parseFSpec(line, false);
        assert.deepEqual(f.filenameRange, [6, 14]);
    });
});

describe('parseISpec', () => {
    it('detects a data structure header', () => {
        const line = rpgLine([5, 'I'], [6, 'MYDS'], [18, 'DS']);
        const i = parseISpec(line);
        assert.equal(i.filename, 'MYDS');
        assert.equal(i.isDataStructure, true);
        assert.equal(i.fieldName, '');
    });

    it('parses an SDS option', () => {
        const line = rpgLine([5, 'I'], [18, 'DS'], [20, 'S']);
        const i = parseISpec(line);
        assert.equal(i.isDataStructure, true);
        assert.equal(i.dsOption, 'S');
    });

    it('parses a field line (from/to/name)', () => {
        // from @43, to @47, dec @51, name @52
        const line = rpgLine([5, 'I'], [43, '   1'], [47, '  10'], [51, '0'], [52, 'NAME  ']);
        const i = parseISpec(line);
        assert.equal(i.isDataStructure, false);
        assert.equal(i.fromPos,   1);
        assert.equal(i.toPos,     10);
        assert.equal(i.decPos,    '0');
        assert.equal(i.fieldName, 'NAME');
        assert.deepEqual(i.fieldNameRange, [52, 56]);
    });

    it('returns zero positions when from/to are blank', () => {
        const line = rpgLine([5, 'I'], [52, 'X']);
        const i = parseISpec(line);
        assert.equal(i.fromPos, 0);
        assert.equal(i.toPos,   0);
    });

    it('extracts a complete named constant value', () => {
        // col 20: opening quote, cols 21-23: YES, col 24: closing quote
        const line = rpgLine([5, 'I'], [20, "'YES'"], [42, 'C'], [52, 'YESCON']);
        const i = parseISpec(line);
        assert.equal(i.dataType,          'C');
        assert.equal(i.constantValue,     'YES');
        assert.equal(i.constantTruncated, false);
    });

    it('extracts a continuation constant and sets truncated flag', () => {
        // 22-char area filled: opening quote + 20 chars of text + continuation dash
        const line = rpgLine([5, 'I'], [20, "'OPTION W ALLOWED FOR-"], [42, 'C'], [52, 'ERR1  ']);
        const i = parseISpec(line);
        assert.equal(i.constantValue,     'OPTION W ALLOWED FOR');
        assert.equal(i.constantTruncated, true);
    });

    it('extracts a numeric-looking constant with a closing quote', () => {
        const line = rpgLine([5, 'I'], [20, "'000000000000'"], [42, 'C'], [52, 'PPJT  ']);
        const i = parseISpec(line);
        assert.equal(i.constantValue,     '000000000000');
        assert.equal(i.constantTruncated, false);
    });

    it('returns empty constantValue for non-constant (positional) lines', () => {
        const line = rpgLine([5, 'I'], [43, '   1'], [47, '  10'], [52, 'FLD   ']);
        const i = parseISpec(line);
        assert.equal(i.constantValue,     '');
        assert.equal(i.constantTruncated, false);
    });
});

describe('parseESpec', () => {
    // Array name @26, entries-per-record @23, entries-per-table @36, entry-length @39, data type @42
    const line = rpgLine([5, 'E'], [23, ' 10'], [26, 'ARR   '], [36, ' 10'], [39, '  5'], [42, 'P'], [43, '2'], [44, 'A']);

    it('extracts array name and dimensions', () => {
        const e = parseESpec(line);
        assert.equal(e.arrayName,        'ARR');
        assert.equal(e.entriesPerRecord, 10);
        assert.equal(e.entriesPerTable,  10);
        assert.equal(e.entryLength,      5);
        assert.equal(e.dataType,         'P');
        assert.equal(e.decPos,           '2');
        assert.equal(e.sequence,         'A');
    });

    it('reports the array name range', () => {
        const e = parseESpec(line);
        assert.deepEqual(e.arrayNameRange, [26, 29]);
    });

    it('defaults numeric fields to 0 when blank', () => {
        const line = rpgLine([5, 'E'], [26, 'EMPTY']);
        const e = parseESpec(line);
        assert.equal(e.entriesPerRecord, 0);
        assert.equal(e.entriesPerTable,  0);
        assert.equal(e.entryLength,      0);
    });
});
