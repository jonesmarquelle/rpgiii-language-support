/**
 * lineParser.ts
 *
 * Column-slice parsers for each RPG-III spec type.
 * All column indices are 0-based (JavaScript string convention).
 *
 * RPG-III fixed-column layout (1-based in documentation, 0-based here):
 *   col 0-4  (1-5)  : sequence / page number gutter
 *   col 5    (6)    : spec type letter
 *   col 6+          : spec-specific content
 */

import {
    CSpecContent, FSpecContent, ISpecContent, ESpecContent,
    colSlice, colChar, colTrim,
} from '../types/rpgTypes';

// ─── C-Spec ───────────────────────────────────────────────────────────────
// Body starts at index 6 (after 5-char gutter + 1 spec letter)
//
//  [6..7]   control level  (2) 
//  [8..10]  N01            (3)
//  [11..13] N02            (3)
//  [14..16] N03            (3)
//  [17..26] Factor 1       (10)
//  [27..31] Opcode         (5)
//  [32..41] Factor 2       (10)
//  [42..45] Result field   (6)
//  [48..50] Field length   (3)
//  [51]     Decimal pos    (1)
//  [52]     Half-adjust    (1)
//  [53..54] HI indicator   (2)
//  [55..56] LO indicator   (2)
//  [57..58] EQ indicator   (2)

export function parseCSpec(line: string): CSpecContent {
    const factor1Raw = colSlice(line, 17, 10);
    const factor2Raw = colSlice(line, 32, 10);
    const resultRaw  = colSlice(line, 42, 6);
    const opcodeRaw  = colSlice(line, 27, 5);

    // Compute non-whitespace ranges for semantic tokens
    const factor1Range = trimmedRange(line, 17, 10);
    const factor2Range = trimmedRange(line, 32, 10);
    const resultRange  = trimmedRange(line, 42, 6);
    const opcodeRange  = trimmedRange(line, 27, 5);

    return {
        controlLevel: colSlice(line, 6, 2).trim(),
        n01:          colSlice(line, 8, 3).trim(),
        n02:          colSlice(line, 11, 3).trim(),
        n03:          colSlice(line, 14, 3).trim(),
        factor1:      factor1Raw.trim(),
        opcode:       opcodeRaw.trim().toUpperCase(),
        factor2:      factor2Raw.trim(),
        resultField:  resultRaw.trim(),
        fieldLen:     colSlice(line, 48, 3).trim(),
        decPos:       colChar(line, 51),
        halfAdjust:   colChar(line, 52),
        hiIndicator:  colSlice(line, 53, 2).trim(),
        loIndicator:  colSlice(line, 55, 2).trim(),
        eqIndicator:  colSlice(line, 57, 2).trim(),
        factor1Range,
        opcodeRange,
        factor2Range,
        resultRange,
    };
}

// ─── F-Spec ───────────────────────────────────────────────────────────────
// Body starts at index 6
//
//  [6..13]  Filename       (8)
//  [14]     File type      (1)  I/O/U/C
//  [15]     Designation    (1)  P/S/R/T/F
//  [16]     EOF            (1)
//  [17]     Sequence       (1)  A/D
//  [18]     Format         (1)  F/E
//  [23..26] Record length  (4)
//  [39..45] Device name    (7)  DISK/WORKSTN/PRINTER/SEQ/SPECIAL

export function parseFSpec(line: string, isContinuation: boolean): FSpecContent {
    const filename = colTrim(line, 6, 8);

    // Device name is around col 39-44 in standard RPG-III F-specs.
    // It's easiest to search for known device keywords in cols 38-80.
    const tail = colSlice(line, 38, 42).toUpperCase();
    let device = '';
    for (const dev of ['WORKSTN', 'PRINTER', 'SPECIAL', 'DISK', 'SEQ']) {
        if (tail.includes(dev)) {
            device = dev;
            break;
        }
    }

    return {
        filename,
        fileType:    colChar(line, 14).toUpperCase(),
        designation: colChar(line, 15).toUpperCase(),
        eofFlag:     colChar(line, 16).toUpperCase(),
        sequence:    colChar(line, 17).toUpperCase(),
        format:      colChar(line, 18).toUpperCase(),
        recordLen:   colSlice(line, 23, 4).trim(),
        device,
        isContinuation,
        filenameRange: trimmedRange(line, 6, 8),
    };
}

// ─── I-Spec ───────────────────────────────────────────────────────────────
// Body starts at index 6
//
//  [6..13]  Filename / blank       (8)
//  [14..15] Sequence code          (2)
//  [16]     Number/indicator       (1)
//  [17]     Option code            (1)
//  [18..19] Record ID / 'DS'       (2)
//  [42]     Data type P/B/L/R      (1)
//  [43..46] From position          (4)
//  [47..50] To position            (4)
//  [51]     Decimal positions      (1)
//  [52..57] Field name             (6)
//  [58..59] Control level L1-L9   (2)
//  [60..61] Matching field M1-M9  (2)

export function parseISpec(line: string): ISpecContent {
    const recordIdArea = colSlice(line, 18, 2).trim().toUpperCase();
    const isDS = recordIdArea === 'DS';

    // SDS option is at col [20] — the char right after 'DS'
    let dsOption = '';
    if (isDS) {
        dsOption = colChar(line, 20).toUpperCase();
    }

    const fromStr = colSlice(line, 43, 4).trim();
    const toStr   = colSlice(line, 47, 4).trim();

    return {
        filename:        colTrim(line, 6, 8),
        sequenceCode:    colSlice(line, 14, 2).trim(),
        number:          colChar(line, 16),
        option:          colChar(line, 17),
        recordId:        recordIdArea,
        isDataStructure: isDS,
        dsOption,
        dataType:        colChar(line, 42).toUpperCase(),
        fromPos:         fromStr ? parseInt(fromStr, 10) : 0,
        toPos:           toStr   ? parseInt(toStr,   10) : 0,
        decPos:          colChar(line, 51),
        fieldName:       colTrim(line, 52, 6),
        controlLevel:    colSlice(line, 58, 2).trim(),
        matchingField:   colSlice(line, 60, 2).trim(),
        fieldNameRange:  trimmedRange(line, 52, 6),
    };
}

// ─── E-Spec ───────────────────────────────────────────────────────────────
// Body starts at index 6
//
//  [6..13]  Related file name      (8)  — blank if no related file
//  [26..31] Array/table name       (6)
//  [23..25] Entries per record     (3)
//  [36..38] Entries per table      (3)
//  [39..41] Entry length           (3)
//  [42]     Data type P/B/L/R      (1)
//  [43]     Decimal positions      (1)
//  [44]     Sequence A/D           (1)

export function parseESpec(line: string): ESpecContent {
    const eprStr = colSlice(line, 23, 3).trim();
    const eptStr = colSlice(line, 36, 3).trim();
    const elStr  = colSlice(line, 39, 3).trim();

    return {
        relatedFileName: colTrim(line, 6, 8),
        arrayName:       colTrim(line, 26, 6),
        entriesPerRecord: eprStr ? parseInt(eprStr, 10) : 0,
        entriesPerTable:  eptStr ? parseInt(eptStr, 10) : 0,
        entryLength:      elStr  ? parseInt(elStr,  10) : 0,
        dataType:         colChar(line, 42).toUpperCase(),
        decPos:           colChar(line, 43),
        sequence:         colChar(line, 44).toUpperCase(),
        arrayNameRange:   trimmedRange(line, 26, 6),
    };
}

// ─── Utility ──────────────────────────────────────────────────────────────

/**
 * Find the [start, end) range of the non-whitespace content within a
 * fixed-width column slice. Returns [start, start] if the slice is blank.
 */
function trimmedRange(line: string, colStart: number, colLen: number): [number, number] {
    const raw = colSlice(line, colStart, colLen);
    const leadingSpaces = raw.length - raw.trimStart().length;
    const trailingSpaces = raw.length - raw.trimEnd().length;
    const contentLen = raw.length - leadingSpaces - trailingSpaces;
    if (contentLen <= 0) {
        return [colStart, colStart];
    }
    const start = colStart + leadingSpaces;
    const end   = start + contentLen;
    return [start, end];
}
