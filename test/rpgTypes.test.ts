import { strict as assert } from 'assert';
import { colSlice, colChar, colTrim, wordAtColumn } from '../src/types/rpgTypes';

describe('rpgTypes helpers', () => {
    describe('colSlice', () => {
        it('extracts a fixed-width slice', () => {
            assert.equal(colSlice('0123456789', 2, 3), '234');
        });

        it('returns empty string when start is beyond line end', () => {
            assert.equal(colSlice('abc', 10, 5), '');
        });

        it('returns a short slice when the line is shorter than start+length', () => {
            assert.equal(colSlice('abc', 1, 10), 'bc');
        });

        it('returns empty string for zero length', () => {
            assert.equal(colSlice('abc', 0, 0), '');
        });
    });

    describe('colChar', () => {
        it('returns the character at a valid index', () => {
            assert.equal(colChar('hello', 1), 'e');
        });

        it('returns empty string for out-of-range index', () => {
            assert.equal(colChar('hi', 10), '');
        });
    });

    describe('colTrim', () => {
        it('trims whitespace from the slice', () => {
            assert.equal(colTrim('  hi  world', 0, 6), 'hi');
        });

        it('returns empty string when the slice is all whitespace', () => {
            assert.equal(colTrim('      abc', 0, 6), '');
        });
    });

    describe('wordAtColumn', () => {
        it('returns the identifier the cursor sits on, upper-cased', () => {
            // Factor 1 field is [17, 27). 'FOO' placed at cols 22..24 (entirely inside).
            const line = ''.padEnd(22, ' ') + 'FOO' + ''.padEnd(20, ' ');
            const hit = wordAtColumn(line, 23, 17, 27);
            assert.deepEqual(hit, { word: 'FOO', start: 22, end: 25 });
        });

        it('returns null when the cursor is on whitespace', () => {
            const line = '     C         FOO';
            assert.equal(wordAtColumn(line, 10, 0, 20), null);
        });

        it('includes a leading *, $, #, or @ in the word', () => {
            const line = '*IN01     more';
            const hit = wordAtColumn(line, 2, 0, 10);
            assert.deepEqual(hit, { word: '*IN01', start: 0, end: 5 });
        });

        it('returns null when the cursor is outside the requested field bounds', () => {
            const line = 'hello world';
            assert.equal(wordAtColumn(line, 0, 6, 11), null);
        });

        it('does not match a word when the cursor is past the end of the line', () => {
            const line = 'abc';
            assert.equal(wordAtColumn(line, 20, 0, 30), null);
        });
    });
});
