import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    baseOpcode, FILE_OPS, GOTO_OPS, SR_OPS_F1, SR_OPS_F2, KLIST_OPS_F1,
    FOLD_OPENERS, FOLD_CLOSERS, END_EXCLUDED_OPENERS,
} from '../parser/opcodes';

describe('baseOpcode', () => {
    it('strips comparison suffixes from structured opcodes', () => {
        assert.equal(baseOpcode('IFEQ'),  'IF');
        assert.equal(baseOpcode('IFNE'),  'IF');
        assert.equal(baseOpcode('DOUGE'), 'DOU');
        assert.equal(baseOpcode('DOWLT'), 'DOW');
        assert.equal(baseOpcode('DOEQ'),  'DO');
        assert.equal(baseOpcode('CABNE'), 'CAB');
        assert.equal(baseOpcode('CASLE'), 'CAS');
        assert.equal(baseOpcode('WHGT'),  'WH');
        assert.equal(baseOpcode('ANDEQ'), 'AND');
        assert.equal(baseOpcode('ORLE'),  'OR');
    });

    it('does NOT strip DOW→DO or DOU→DO (longest-prefix-first)', () => {
        assert.equal(baseOpcode('DOW'), 'DOW');
        assert.equal(baseOpcode('DOU'), 'DOU');
    });

    it('returns input uppercase when no known prefix matches', () => {
        assert.equal(baseOpcode('MOVE'),  'MOVE');
        assert.equal(baseOpcode('ENDSR'), 'ENDSR');
        assert.equal(baseOpcode('KLIST'), 'KLIST');
        assert.equal(baseOpcode('tag'),   'TAG');
    });

    it('leaves bare IF / DO / CAB alone', () => {
        assert.equal(baseOpcode('IF'),  'IF');
        assert.equal(baseOpcode('DO'),  'DO');
        assert.equal(baseOpcode('CAB'), 'CAB');
    });
});

describe('opcode sets', () => {
    it('classify CHAIN as both FILE_OPS and KLIST_OPS_F1', () => {
        assert.ok(FILE_OPS.has('CHAIN'));
        assert.ok(KLIST_OPS_F1.has('CHAIN'));
    });
    it('classify EXSR as a Factor-2 subroutine reference', () => {
        assert.ok(SR_OPS_F2.has('EXSR'));
    });
    it('classify BEGSR/ENDSR as Factor-1 subroutine sites', () => {
        assert.ok(SR_OPS_F1.has('BEGSR'));
        assert.ok(SR_OPS_F1.has('ENDSR'));
    });
    it('classify GOTO-family opcodes', () => {
        for (const op of ['GOTO', 'CAB', 'CABGT', 'CABLT', 'CABEQ', 'CABGE', 'CABLE', 'CABNE']) {
            assert.ok(GOTO_OPS.has(op), `${op} in GOTO_OPS`);
        }
    });
    it('register fold openers & closers consistently', () => {
        // Every closer target should be a known opener
        for (const opener of Object.values(FOLD_CLOSERS)) {
            assert.ok(FOLD_OPENERS.has(opener), `${opener} is an opener`);
        }
        assert.ok(END_EXCLUDED_OPENERS.has('BEGSR'));
    });
});
