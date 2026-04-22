/**
 * sysColumnsQuery.ts
 *
 * SQL query builders and row mappers for resolving external file-field
 * metadata via QSYS2 catalogs. Pure functions — no VSCode or Code for IBM i
 * runtime imports, so they're trivially unit-testable with a fake runSQL.
 *
 * All RPG names resolve against SYSTEM_* columns (short, uppercase, CCSID-safe),
 * never the SQL long-name columns.
 */

export interface SysColumnsRow {
    TABLE_SCHEMA: string;
    SYSTEM_TABLE_NAME: string;
    SYSTEM_COLUMN_NAME: string;
    COLUMN_TEXT: string | null;
    DATA_TYPE: string;
    LENGTH: number;
    NUMERIC_SCALE: number | null;
}

export interface ExternalFieldHit {
    fieldName: string;              // SYSTEM_COLUMN_NAME, uppercase
    fileName: string;               // SYSTEM_TABLE_NAME, uppercase (matches F-spec name)
    schema: string;                 // resolved library
    columnText?: string;            // COLUMN_TEXT — stored now for future hover use
    dataType: string;
    length: number;
    numericScale: number | null;
}

export function buildSysColumnsQuery(systemTableNames: string[], schemas: string[]): string {
    const tableList = systemTableNames.map(sqlLiteral).join(', ');
    const schemaList = schemas.map(sqlLiteral).join(', ');
    return 'SELECT TABLE_SCHEMA, SYSTEM_TABLE_NAME, SYSTEM_COLUMN_NAME, ' +
        'COLUMN_TEXT, DATA_TYPE, LENGTH, NUMERIC_SCALE ' +
        'FROM QSYS2.SYSCOLUMNS ' +
        `WHERE SYSTEM_TABLE_NAME IN (${tableList}) ` +
        `AND TABLE_SCHEMA IN (${schemaList})`;
}

/**
 * Given SYSCOLUMNS rows and the ordered library list (array index = priority),
 * pick the winning (schema, rows) pair for each file name — lowest index wins.
 * Files not found in any library are reported with found=false.
 */
export function resolveFiles(
    fileNames: string[],
    rows: SysColumnsRow[],
    libraryList: string[],
): Map<string, { schema: string; found: boolean; rows: SysColumnsRow[] }> {
    const ordinalBySchema = new Map<string, number>();
    for (let i = 0; i < libraryList.length; i++) {
        ordinalBySchema.set(libraryList[i].toUpperCase(), i);
    }

    const byFileBySchema = new Map<string, Map<string, SysColumnsRow[]>>();
    for (const row of rows) {
        const file = row.SYSTEM_TABLE_NAME.toUpperCase();
        const schema = row.TABLE_SCHEMA.toUpperCase();
        let schemaMap = byFileBySchema.get(file);
        if (!schemaMap) {
            schemaMap = new Map();
            byFileBySchema.set(file, schemaMap);
        }
        const list = schemaMap.get(schema) ?? [];
        list.push(row);
        schemaMap.set(schema, list);
    }

    const result = new Map<string, { schema: string; found: boolean; rows: SysColumnsRow[] }>();
    for (const fileRaw of fileNames) {
        const file = fileRaw.toUpperCase();
        const schemaMap = byFileBySchema.get(file);
        if (!schemaMap || schemaMap.size === 0) {
            result.set(file, { schema: '', found: false, rows: [] });
            continue;
        }
        let winningSchema: string | undefined;
        let winningOrdinal = Number.POSITIVE_INFINITY;
        for (const schema of schemaMap.keys()) {
            const ord = ordinalBySchema.get(schema);
            if (ord !== undefined && ord < winningOrdinal) {
                winningOrdinal = ord;
                winningSchema = schema;
            }
        }
        if (winningSchema === undefined) {
            result.set(file, { schema: '', found: false, rows: [] });
            continue;
        }
        result.set(file, {
            schema: winningSchema,
            found: true,
            rows: schemaMap.get(winningSchema)!,
        });
    }
    return result;
}

export function mapRowToHit(row: SysColumnsRow): ExternalFieldHit {
    return {
        fieldName: row.SYSTEM_COLUMN_NAME.toUpperCase(),
        fileName: row.SYSTEM_TABLE_NAME.toUpperCase(),
        schema: row.TABLE_SCHEMA.toUpperCase(),
        columnText: row.COLUMN_TEXT?.trim() || undefined,
        dataType: row.DATA_TYPE,
        length: row.LENGTH,
        numericScale: row.NUMERIC_SCALE,
    };
}

function sqlLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}
