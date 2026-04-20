import { strict as assert } from 'assert';
import { parseCSpec, parseFSpec, parseISpec, parseESpec, baseOpcode } from '../src/parser/lineParser';

/**
 * Build a fixed-column RPG line from a list of (startCol, content) segments.
 * Positions are 0-indexed and overlap is not permitted. Gaps are space-padded.
 */
function buildLine(segments: Array<[number, string]>): string {
    const sorted = [...segments].sort((a, b) => a[0] - b[0]);
    let out = '';
    for (const [col, text] of sorted) {
        if (col < out.length) {
            throw new Error(`buildLine: overlap at col ${col}`);
        }
        out = out.padEnd(col, ' ') + text;
    }
    return out;
}

describe('lineParser', () => {
    describe('baseOpcode', () => {
        it('returns the base opcode for compound IF/DO/WH forms', () => {
            assert.equal(baseOpcode('IFEQ'), 'IF');
            assert.equal(baseOpcode('IFNE'), 'IF');
            assert.equal(baseOpcode('DOWGE'), 'DOW');
            assert.equal(baseOpcode('DOULE'), 'DOU');
            assert.equal(baseOpcode('WHEQ'), 'WH');
            assert.equal(baseOpcode('CABGT'), 'CAB');
            assert.equal(baseOpcode('CASEQ'), 'CAS');
        });

        it('uppercases input', () => {
            assert.equal(baseOpcode('ifeq'), 'IF');
        });

        it('passes through opcodes without a recognised suffix', () => {
            assert.equal(baseOpcode('MOVE'), 'MOVE');
            assert.equal(baseOpcode('BEGSR'), 'BEGSR');
            assert.equal(baseOpcode('END'), 'END');
        });

        it('does not alter a plain IF / DO with no comparison suffix', () => {
            assert.equal(baseOpcode('IF'), 'IF');
            assert.equal(baseOpcode('DO'), 'DO');
        });
    });

    describe('parseCSpec', () => {
        it('extracts factor1, opcode, factor2, and result', () => {
            const line = buildLine([
                [5, 'C'],
                [17, 'FOO'],
                [27, 'ADD'],
                [32, 'BAR'],
                [42, 'RESULT'],
            ]);
            const c = parseCSpec(line);
            assert.equal(c.factor1, 'FOO');
            assert.equal(c.opcode, 'ADD');
            assert.equal(c.factor2, 'BAR');
            assert.equal(c.resultField, 'RESULT');
            assert.equal(c.fieldLen, '');
            assert.equal(c.decPos, '');
            assert.equal(c.halfAdjust, '');
            assert.equal(c.hiIndicator, '');
            assert.equal(c.loIndicator, '');
            assert.equal(c.eqIndicator, '');
        });

        it('uppercases the opcode', () => {
            const line = buildLine([[5, 'C'], [27, 'move']]);
            assert.equal(parseCSpec(line).opcode, 'MOVE');
        });

        it('computes trimmed ranges that skip leading whitespace', () => {
            const line = buildLine([
                [5, 'C'],
                [22, 'FOO'],     // leading blanks inside Factor 1 (cols 17..26)
                [27, 'ADD'],
                [38, 'BAR'],     // inside Factor 2 (cols 32..41)
                [42, 'RESULT'],
            ]);
            const c = parseCSpec(line);
            assert.deepEqual(c.factor1Range, [22, 25]);
            assert.deepEqual(c.factor2Range, [38, 41]);
            assert.deepEqual(c.resultRange, [42, 48]);
            assert.deepEqual(c.opcodeRange, [27, 30]);
        });

        it('returns [colStart, colStart] when a field is blank', () => {
            const line = buildLine([[5, 'C'], [27, 'SETON']]);
            const c = parseCSpec(line);
            assert.deepEqual(c.factor1Range, [17, 17]);
            assert.deepEqual(c.factor2Range, [32, 32]);
            assert.equal(c.factor1, '');
            assert.equal(c.factor2, '');
        });

        it('reads control level, conditioning indicators, and resulting indicators', () => {
            const line = buildLine([
                [5, 'C'],
                [6, 'SR'],
                [8, 'N01'],
                [11, '02 '],
                [14, 'N03'],
                [17, 'FACT'],
                [27, 'COMP'],
                [32, 'OTHR'],
                [53, '10'],
                [55, '20'],
                [57, '30'],
            ]);
            const c = parseCSpec(line);
            assert.equal(c.controlLevel, 'SR');
            assert.equal(c.n01, 'N01');
            assert.equal(c.n02, '02');
            assert.equal(c.n03, 'N03');
            assert.equal(c.hiIndicator, '10');
            assert.equal(c.loIndicator, '20');
            assert.equal(c.eqIndicator, '30');
        });

        it('does not crash on short lines', () => {
            const line = '     C';
            const c = parseCSpec(line);
            assert.equal(c.opcode, '');
            assert.equal(c.factor1, '');
            assert.equal(c.factor2, '');
        });
    });

    describe('parseFSpec', () => {
        it('extracts filename, type, designation, format, record length, and device', () => {
            const line = buildLine([
                [5, 'F'],
                [6, 'MYFILE'],
                [14, 'IP  F'],
                [23, ' 132'],
                [38, 'DISK'],
            ]);
            const f = parseFSpec(line, false);
            assert.equal(f.filename, 'MYFILE');
            assert.equal(f.fileType, 'I');
            assert.equal(f.designation, 'P');
            assert.equal(f.eofFlag, ' ');       // colChar does not trim — raw single char
            assert.equal(f.sequence, ' ');
            assert.equal(f.format, 'F');
            assert.equal(f.recordLen, '132');
            assert.equal(f.device, 'DISK');
            assert.equal(f.isContinuation, false);
            assert.deepEqual(f.filenameRange, [6, 12]);
        });

        it('detects WORKSTN device keywords', () => {
            const line = buildLine([
                [5, 'F'],
                [6, 'SCREEN'],
                [14, 'CF  E'],
                [38, 'WORKSTN'],
            ]);
            assert.equal(parseFSpec(line, false).device, 'WORKSTN');
        });

        it('marks continuation lines', () => {
            const line = buildLine([[5, 'F']]);
            assert.equal(parseFSpec(line, true).isContinuation, true);
        });

        it('returns empty device when no known keyword is present', () => {
            const line = buildLine([[5, 'F'], [6, 'NONAME']]);
            assert.equal(parseFSpec(line, false).device, '');
        });
    });

    describe('parseISpec', () => {
        it('detects a data-structure header and its filename', () => {
            const line = buildLine([
                [5, 'I'],
                [6, 'MYDS'],
                [18, 'DS'],
            ]);
            const i = parseISpec(line);
            assert.equal(i.filename, 'MYDS');
            assert.equal(i.isDataStructure, true);
            assert.equal(i.recordId, 'DS');
            assert.equal(i.dsOption, '');
        });

        it('captures the SDS option char following DS', () => {
            const line = buildLine([
                [5, 'I'],
                [18, 'DSS'],
            ]);
            const i = parseISpec(line);
            assert.equal(i.isDataStructure, true);
            assert.equal(i.dsOption, 'S');
        });

        it('extracts a numeric subfield with from/to positions and data type', () => {
            const line = buildLine([
                [5, 'I'],
                [42, 'P'],
                [43, '   1'],
                [47, '   3'],
                [51, '0'],
                [52, 'FIELD1'],
            ]);
            const i = parseISpec(line);
            assert.equal(i.isDataStructure, false);
            assert.equal(i.dataType, 'P');
            assert.equal(i.fromPos, 1);
            assert.equal(i.toPos, 3);
            assert.equal(i.decPos, '0');
            assert.equal(i.fieldName, 'FIELD1');
            assert.deepEqual(i.fieldNameRange, [52, 58]);
        });

        it('leaves fromPos / toPos as 0 when the columns are blank', () => {
            const line = buildLine([[5, 'I'], [52, 'BLANKS']]);
            const i = parseISpec(line);
            assert.equal(i.fromPos, 0);
            assert.equal(i.toPos, 0);
        });

        it('uppercases the recordId/DS marker', () => {
            const line = buildLine([[5, 'I'], [18, 'ds']]);
            assert.equal(parseISpec(line).isDataStructure, true);
        });
    });

    describe('parseESpec', () => {
        it('extracts array name, entry counts, entry length, and attributes', () => {
            const line = buildLine([
                [5, 'E'],
                [23, ' 10'],
                [26, 'MYARR'],
                [39, '  5'],
                [42, 'P'],
                [43, '0'],
                [44, 'A'],
            ]);
            const e = parseESpec(line);
            assert.equal(e.arrayName, 'MYARR');
            assert.equal(e.entriesPerRecord, 10);
            assert.equal(e.entriesPerTable, 0);
            assert.equal(e.entryLength, 5);
            assert.equal(e.dataType, 'P');
            assert.equal(e.decPos, '0');
            assert.equal(e.sequence, 'A');
            assert.deepEqual(e.arrayNameRange, [26, 31]);
        });

        it('leaves numeric fields at zero when blank', () => {
            const line = buildLine([[5, 'E'], [26, 'TBL']]);
            const e = parseESpec(line);
            assert.equal(e.entriesPerRecord, 0);
            assert.equal(e.entriesPerTable, 0);
            assert.equal(e.entryLength, 0);
        });
    });
});
