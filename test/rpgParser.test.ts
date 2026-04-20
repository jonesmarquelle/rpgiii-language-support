import { strict as assert } from 'assert';
import { parseDocument } from '../src/parser/rpgParser';
import { SpecType, CSpecContent } from '../src/types/rpgTypes';
import { MockTextDocument } from './mocks/vscode';

function pad(cols: Array<[number, string]>): string {
    const sorted = [...cols].sort((a, b) => a[0] - b[0]);
    let out = '';
    for (const [col, text] of sorted) {
        if (col < out.length) { throw new Error(`overlap at ${col}`); }
        out = out.padEnd(col, ' ') + text;
    }
    return out;
}

function doc(lines: string[]): any {
    return new MockTextDocument(lines.join('\n'));
}

describe('rpgParser.parseDocument', () => {
    it('classifies each line by spec type', () => {
        const d = doc([
            pad([[5, 'H']]),
            pad([[5, 'F'], [6, 'MYFILE'], [14, 'IP  F'], [38, 'DISK']]),
            pad([[5, 'C'], [27, 'MOVE']]),
            pad([[5, '*'], [6, ' a comment']]),
            '',
        ]);
        const out = parseDocument(d);
        assert.equal(out.lines.length, 5);
        assert.equal(out.lines[0].specType, SpecType.Header);
        assert.equal(out.lines[1].specType, SpecType.File);
        assert.equal(out.lines[2].specType, SpecType.Calculation);
        assert.equal(out.lines[3].specType, SpecType.Comment);
        assert.equal(out.lines[4].specType, SpecType.Blank);
    });

    it('builds a file symbol for each F-spec filename', () => {
        const d = doc([
            pad([[5, 'F'], [6, 'CUSTMAS'], [14, 'IF  E'], [38, 'DISK']]),
            pad([[5, 'F'], [6, 'QSYSPRT'], [14, 'O   F'], [38, 'PRINTER']]),
        ]);
        const out = parseDocument(d);
        assert.equal(out.symbols.files.size, 2);
        const cust = out.symbols.files.get('CUSTMAS')!;
        assert.equal(cust.name, 'CUSTMAS');
        assert.equal(cust.fileType, 'I');
        assert.equal(cust.device, 'DISK');
        assert.equal(cust.definitionLine, 0);
        const prt = out.symbols.files.get('QSYSPRT')!;
        assert.equal(prt.fileType, 'O');
        assert.equal(prt.device, 'PRINTER');
        assert.equal(prt.definitionLine, 1);
    });

    it('captures an array symbol from an E-spec', () => {
        const d = doc([
            pad([
                [5, 'E'],
                [23, ' 10'],
                [26, 'MYARR'],
                [39, '  5'],
                [42, 'P'],
                [43, '0'],
                [44, 'A'],
            ]),
        ]);
        const out = parseDocument(d);
        const arr = out.symbols.arrays.get('MYARR')!;
        assert.ok(arr, 'array symbol should be registered');
        assert.equal(arr.entriesPerRecord, 10);
        assert.equal(arr.entryLength, 5);
        assert.equal(arr.dataType, 'P');
    });

    it('associates I-spec subfields with their enclosing data structure', () => {
        const d = doc([
            pad([[5, 'I'], [6, 'MYDS'], [18, 'DS']]),
            pad([
                [5, 'I'],
                [42, 'P'],
                [43, '   1'],
                [47, '   3'],
                [51, '0'],
                [52, 'FIELD1'],
            ]),
            pad([
                [5, 'I'],
                [42, ' '],
                [43, '   4'],
                [47, '  10'],
                [52, 'FIELD2'],
            ]),
        ]);
        const out = parseDocument(d);
        assert.equal(out.symbols.dataStructures.length, 1);
        const ds = out.symbols.dataStructures[0];
        assert.equal(ds.name, 'MYDS');
        assert.equal(ds.fields.length, 2);
        assert.equal(ds.fields[0].name, 'FIELD1');
        assert.equal(ds.fields[0].parentDsName, 'MYDS');
        assert.equal(ds.fields[1].name, 'FIELD2');
        assert.equal(ds.fields[1].fromPos, 4);
        assert.equal(ds.fields[1].toPos, 10);
        // The global field index should reference the first occurrence
        assert.ok(out.symbols.fields.get('FIELD1'));
        assert.ok(out.symbols.fields.get('FIELD2'));
    });

    it('tags the data structure as SDS when the S option follows DS', () => {
        const d = doc([
            pad([[5, 'I'], [18, 'DSS']]),
        ]);
        const out = parseDocument(d);
        assert.equal(out.symbols.dataStructures[0].dsType, 'SDS');
    });

    it('pairs BEGSR / ENDSR into a subroutine symbol with a folding range', () => {
        const d = doc([
            pad([[5, 'C'], [17, 'MYSUB'], [27, 'BEGSR']]),
            pad([[5, 'C'], [27, 'MOVE']]),
            pad([[5, 'C'], [27, 'ENDSR']]),
        ]);
        const out = parseDocument(d);
        assert.equal(out.symbols.subroutines.size, 1);
        const sr = out.symbols.subroutines.get('MYSUB')!;
        assert.equal(sr.name, 'MYSUB');
        assert.equal(sr.definitionLine, 0);
        assert.equal(sr.endLine, 2);
        assert.equal(sr.foldRange.start, 0);
        assert.equal(sr.foldRange.end, 2);
    });

    it('matches ENDSR to a named BEGSR when factor1 is given on ENDSR', () => {
        const d = doc([
            pad([[5, 'C'], [17, 'SUB1'], [27, 'BEGSR']]),
            pad([[5, 'C'], [17, 'SUB1'], [27, 'ENDSR']]),
        ]);
        const out = parseDocument(d);
        const sr = out.symbols.subroutines.get('SUB1')!;
        assert.ok(sr);
        // ENDSR factor1 should additionally be registered as a jump tag
        assert.ok(out.symbols.tags.get('SUB1'));
    });

    it('registers TAG opcodes as tag symbols', () => {
        const d = doc([
            pad([[5, 'C'], [17, 'MYLBL'], [27, 'TAG']]),
        ]);
        const out = parseDocument(d);
        const tag = out.symbols.tags.get('MYLBL')!;
        assert.ok(tag);
        assert.equal(tag.name, 'MYLBL');
        assert.equal(tag.definitionLine, 0);
    });

    it('records C-spec result-field variables (with field length) in source order', () => {
        const d = doc([
            pad([[5, 'C'], [27, 'Z-ADD'], [32, '0'], [42, 'COUNT'], [48, ' 30']]),
            pad([[5, 'C'], [27, 'Z-ADD'], [32, '1'], [42, 'COUNT'], [48, ' 30']]),
            pad([[5, 'C'], [27, 'MOVE'],  [32, 'XYZ'], [42, 'COUNT']]),  // no fieldLen → not a (re)declaration
        ]);
        const out = parseDocument(d);
        const defs = out.symbols.variables.get('COUNT')!;
        assert.equal(defs.length, 2);
        assert.equal(defs[0].definitionLine, 0);
        assert.equal(defs[1].definitionLine, 1);
    });

    it('does not register a C-spec result as a variable without a field length', () => {
        const d = doc([
            pad([[5, 'C'], [27, 'MOVE'], [32, '1'], [42, 'TMP']]),
        ]);
        const out = parseDocument(d);
        assert.equal(out.symbols.variables.has('TMP'), false);
    });

    it('toggles compile-time data mode on each ** line', () => {
        const d = doc([
            pad([[5, 'C'], [27, 'MOVE']]),
            '**',
            'ARRAY DATA ROW 1',
            'ARRAY DATA ROW 2',
            '**',
            pad([[5, 'C'], [27, 'SETON']]),
        ]);
        const out = parseDocument(d);
        assert.equal(out.lines[0].specType, SpecType.Calculation);
        assert.equal(out.lines[1].specType, SpecType.CompileTimeData);
        assert.equal(out.lines[2].specType, SpecType.CompileTimeData);
        assert.equal(out.lines[3].specType, SpecType.CompileTimeData);
        assert.equal(out.lines[4].specType, SpecType.CompileTimeData);
        // After the second ** toggle, parsing resumes
        assert.equal(out.lines[5].specType, SpecType.Calculation);
    });

    it('treats blank-col-6 lines following an F-spec as F-spec continuations', () => {
        const d = doc([
            pad([[5, 'F'], [6, 'MAINFILE'], [14, 'IF  E'], [38, 'DISK']]),
            pad([[38, 'KINFSR']]),                    // blank spec char → continuation
            pad([[5, 'C'], [27, 'MOVE']]),
        ]);
        const out = parseDocument(d);
        assert.equal(out.lines[0].specType, SpecType.File);
        assert.equal(out.lines[1].specType, SpecType.File, 'continuation line is reclassified as F');
        const cont = out.lines[1].content as any;
        assert.equal(cont.isContinuation, true);
        assert.equal(out.lines[2].specType, SpecType.Calculation);
    });

    it('stores a uri and the text-document version for cache invalidation', () => {
        const d = new MockTextDocument('     H', 'file:///sample.rpg');
        d.version = 7;
        const out = parseDocument(d as any);
        assert.equal(out.uri, 'file:///sample.rpg');
        assert.equal(out.version, 7);
    });

    it('keeps the first definition when the same file name recurs', () => {
        const d = doc([
            pad([[5, 'F'], [6, 'DUPE'], [14, 'IF  E'], [38, 'DISK']]),
            pad([[5, 'F'], [6, 'DUPE'], [14, 'O   F'], [38, 'PRINTER']]),
        ]);
        const out = parseDocument(d);
        const dupe = out.symbols.files.get('DUPE')!;
        assert.equal(dupe.fileType, 'I', 'first definition wins');
        assert.equal(dupe.definitionLine, 0);
    });

    it('resets DS context when a C-spec line appears between DS and a subsequent I-spec field', () => {
        const d = doc([
            pad([[5, 'I'], [6, 'MYDS'], [18, 'DS']]),
            pad([[5, 'I'], [43, '   1'], [47, '   3'], [52, 'INSIDE']]),
            pad([[5, 'C'], [27, 'MOVE']]),
            pad([[5, 'I'], [43, '   1'], [47, '   4'], [52, 'OUTSID']]),
        ]);
        const out = parseDocument(d);
        const ds = out.symbols.dataStructures[0];
        assert.equal(ds.fields.length, 1);
        assert.equal(ds.fields[0].name, 'INSIDE');
        const outside = out.symbols.fields.get('OUTSID')!;
        assert.equal(outside.parentDsName, '', 'field after C-spec is not attached to the DS');
    });

    it('parses C-spec opcode ranges suitable for semantic coloring', () => {
        const d = doc([
            pad([[5, 'C'], [17, 'FOO'], [27, 'ADD'], [32, 'BAR'], [42, 'RESULT']]),
        ]);
        const out = parseDocument(d);
        const c = out.lines[0].content as CSpecContent;
        assert.deepEqual(c.factor1Range, [17, 20]);
        assert.deepEqual(c.opcodeRange,  [27, 30]);
        assert.deepEqual(c.factor2Range, [32, 35]);
        assert.deepEqual(c.resultRange,  [42, 48]);
    });
});
