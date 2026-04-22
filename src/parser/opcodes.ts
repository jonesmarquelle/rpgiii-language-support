/**
 * opcodes.ts
 *
 * Single source of truth for RPG-III opcode classifications shared by the
 * parser and every language provider. When adding support for a new opcode,
 * update the matching set here.
 */

// Opcodes whose Factor 2 is a file / record-format name
export const FILE_OPS = new Set([
    'CHAIN', 'READ', 'READE', 'READP', 'READPE',
    'WRITE', 'UPDATE', 'UPDAT', 'DELETE', 'DELET',
    'SETLL', 'SETGT', 'OPEN', 'CLOSE', 'FEOD', 'EXFMT',
]);

// Opcodes whose Factor 2 is a subroutine name
export const SR_OPS_F2 = new Set([
    'EXSR', 'CAS', 'CASGT', 'CASLT', 'CASEQ', 'CASGE', 'CASLE', 'CASNE',
]);

// Opcodes whose Factor 1 is a subroutine name
export const SR_OPS_F1 = new Set(['BEGSR', 'ENDSR']);

// Opcodes whose Factor 2 is a GOTO tag / label
export const GOTO_OPS = new Set([
    'GOTO', 'CAB', 'CABGT', 'CABLT', 'CABEQ', 'CABGE', 'CABLE', 'CABNE',
]);

// Opcodes whose Factor 1 can be a KLIST name (composite key search argument)
export const KLIST_OPS_F1 = new Set(['CHAIN', 'SETLL', 'SETGT', 'READE', 'READPE']);

// Opcodes that open a fold block in C-spec
export const FOLD_OPENERS = new Set(['IF', 'DO', 'DOW', 'DOU', 'SELEC', 'BEGSR']);

// Opcodes that close a fold block → the opener they match
export const FOLD_CLOSERS: Record<string, string> = {
    ENDIF: 'IF',
    ENDDO: 'DO',    // also closes DOW / DOU
    ENDSL: 'SELEC',
    ENDSR: 'BEGSR',
};

// Openers that the generic END opcode is NOT allowed to close
export const END_EXCLUDED_OPENERS = new Set(['BEGSR']);

// All RPG-III opcodes — used to guard against treating an opcode token as a
// field name (e.g. suppresses SQL lookups on MOVE, ADD, CHAIN, etc.).
export const RPG_RESERVED = new Set([
    'CHAIN', 'READ', 'READE', 'READP', 'READPE', 'WRITE', 'UPDATE', 'UPDAT',
    'DELETE', 'DELET', 'SETLL', 'SETGT', 'OPEN', 'CLOSE', 'FEOD', 'EXFMT',
    'EXSR', 'BEGSR', 'ENDSR', 'GOTO', 'TAG', 'KLIST', 'KFLD',
    'MOVE', 'MOVEA', 'MOVEL', 'ADD', 'SUB', 'MULT', 'DIV', 'MVR',
    'Z-ADD', 'Z-SUB', 'COMP', 'IFEQ', 'IFNE', 'IFGT', 'IFGE', 'IFLT', 'IFLE',
    'IF', 'ELSE', 'ENDIF', 'END', 'DO', 'DOU', 'DOW', 'ENDDO',
    'SELEC', 'WHEQ', 'WHNE', 'WHGT', 'WHGE', 'WHLT', 'WHLE', 'OTHER', 'ENDSL',
    'CAB', 'CABGT', 'CABLT', 'CABEQ', 'CABGE', 'CABLE', 'CABNE',
    'CAS', 'CASGT', 'CASLT', 'CASEQ', 'CASGE', 'CASLE', 'CASNE',
    'LOKUP', 'SORTA', 'XFOOT', 'RETRN', 'CALL', 'PARM', 'PLIST',
    'UDATE', 'UDAY', 'UMONTH', 'UYEAR', 'PAGE',
]);

/**
 * Extract the base opcode from combined opcodes like IFEQ, DOUGE, DOWLT, etc.
 * `IFEQ` → `IF`, `DOUGE` → `DOU`, `DOWLT` → `DOW`, `CABNE` → `CAB`.
 * Returns the input uppercased if no known prefix matches.
 */
export function baseOpcode(opcode: string): string {
    const upper = opcode.toUpperCase();
    // Longest prefixes first so DOW/DOU don't get swallowed by DO
    const prefixes = ['DOW', 'DOU', 'CAB', 'CAS', 'DO', 'IF', 'WH', 'AND', 'OR'];
    const suffixes = new Set(['GT', 'LT', 'EQ', 'NE', 'GE', 'LE']);
    for (const prefix of prefixes) {
        if (upper.startsWith(prefix) && upper !== prefix) {
            if (suffixes.has(upper.slice(prefix.length))) {
                return prefix;
            }
        }
    }
    return upper;
}
