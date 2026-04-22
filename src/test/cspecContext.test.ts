import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cspecFieldAt, wordAtCspec, cspecSymbolKind } from '../parser/cspecContext';
import type { CSpecContent } from '../types/rpgTypes';

function mkContent(opcode: string): CSpecContent {
    return {
        controlLevel: '', n01: '', n02: '', n03: '',
        factor1: '', opcode, factor2: '', resultField: '',
        fieldLen: '', decPos: '', halfAdjust: '',
        hiIndicator: '', loIndicator: '', eqIndicator: '',
        factor1Range: [17, 17], opcodeRange: [27, 27],
        factor2Range: [32, 32], resultRange: [42, 42],
    };
}

describe('cspecFieldAt', () => {
    it('identifies Factor 1 range [17, 27)', () => {
        assert.equal(cspecFieldAt(17), 'factor1');
        assert.equal(cspecFieldAt(26), 'factor1');
        assert.equal(cspecFieldAt(27), null);  // opcode starts here
    });
    it('identifies Factor 2 range [32, 42)', () => {
        assert.equal(cspecFieldAt(32), 'factor2');
        assert.equal(cspecFieldAt(41), 'factor2');
    });
    it('identifies Result range [42, 48)', () => {
        assert.equal(cspecFieldAt(42), 'result');
        assert.equal(cspecFieldAt(47), 'result');
        assert.equal(cspecFieldAt(48), null);
    });
    it('returns null outside all fields', () => {
        assert.equal(cspecFieldAt(0),  null);
        assert.equal(cspecFieldAt(16), null);
        assert.equal(cspecFieldAt(30), null);   // opcode column
        assert.equal(cspecFieldAt(60), null);
    });
});

describe('wordAtCspec', () => {
    const line =
        '     C           MYVAR     EXSR      MYSUB                                      ';
    // cols:     5         17               27        32

    it('extracts the Factor 1 word at cursor', () => {
        const hit = wordAtCspec(line, 17);
        assert.ok(hit);
        assert.equal(hit!.word, 'MYVAR');
        assert.equal(hit!.field, 'factor1');
        assert.equal(hit!.start, 17);
        assert.equal(hit!.end, 22);
    });

    it('extracts the Factor 2 word at cursor', () => {
        const hit = wordAtCspec(line, 37);
        assert.ok(hit);
        assert.equal(hit!.word, 'MYSUB');
        assert.equal(hit!.field, 'factor2');
    });

    it('returns null outside any field', () => {
        assert.equal(wordAtCspec(line, 28), null);  // opcode col
    });

    it('returns null when the field is blank at cursor', () => {
        const blank = '     C                                                                          ';
        assert.equal(wordAtCspec(blank, 17), null);
    });
});

describe('cspecSymbolKind', () => {
    it('classifies Factor 1 by opcode', () => {
        assert.equal(cspecSymbolKind(mkContent('BEGSR'), 'factor1'), 'subroutine');
        assert.equal(cspecSymbolKind(mkContent('ENDSR'), 'factor1'), 'subroutine');
        assert.equal(cspecSymbolKind(mkContent('TAG'),   'factor1'), 'tag');
        assert.equal(cspecSymbolKind(mkContent('KLIST'), 'factor1'), 'keylist');
        assert.equal(cspecSymbolKind(mkContent('CHAIN'), 'factor1'), 'keylist');  // KLIST search argument
        assert.equal(cspecSymbolKind(mkContent('MOVE'),  'factor1'), null);
    });

    it('classifies Factor 2 by opcode', () => {
        assert.equal(cspecSymbolKind(mkContent('EXSR'),  'factor2'), 'subroutine');
        assert.equal(cspecSymbolKind(mkContent('GOTO'),  'factor2'), 'tag');
        assert.equal(cspecSymbolKind(mkContent('CABEQ'), 'factor2'), 'tag');
        assert.equal(cspecSymbolKind(mkContent('CHAIN'), 'factor2'), 'file');
        assert.equal(cspecSymbolKind(mkContent('READ'),  'factor2'), 'file');
        assert.equal(cspecSymbolKind(mkContent('MOVE'),  'factor2'), null);
    });

    it('classifies the Result field only for KFLD', () => {
        assert.equal(cspecSymbolKind(mkContent('KFLD'),  'result'), 'keyfield');
        assert.equal(cspecSymbolKind(mkContent('MOVE'),  'result'), null);
    });
});
