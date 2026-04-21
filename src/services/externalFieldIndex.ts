/**
 * externalFieldIndex.ts
 *
 * Reverse index of DB field names to their owning F-spec files, sourced from
 * QSYS2.SYSCOLUMNS via Code for IBM i. Per-document cache with in-flight
 * promise coalescing; library-list cache shared per connection.
 *
 * Lookup is O(1): `fields.get(fieldName)` returns all files (in the current
 * document's F-specs) that contain a column with that name.
 */

import * as vscode from 'vscode';
import { documentCache } from '../parser/rpgDocument';
import { CodeForIbmiAdapter, IbmiConnectionInfo } from './codeForIbmi';
import {
    ExternalFieldHit, LibraryListRow, SysColumnsRow,
    buildLibraryListQuery, buildSysColumnsQuery, mapRowToHit, resolveFiles,
} from './sysColumnsQuery';

export interface ExternalFieldIndex {
    fields: Map<string, ExternalFieldHit[]>;
    resolvedFiles: Map<string, { schema: string; found: boolean }>;
    connectionId: string;
}

interface CacheEntry {
    connectionId: string;
    promise: Promise<ExternalFieldIndex | null>;
    settledAt?: number;         // ms epoch when the promise settled (for TTL on failures)
    succeeded?: boolean;
}

const FAILURE_TTL_MS = 30_000;

export class ExternalFieldIndexService implements vscode.Disposable {
    private readonly cache = new Map<string, CacheEntry>();               // uri → entry
    private libraryListCache: { connectionId: string; rows: LibraryListRow[] } | undefined;
    private hasWarnedAboutMissing = false;
    private hasWarnedAboutDisconnect = false;
    private hasWarnedAboutSqlFailure = new Set<string>();                 // per connection id
    private outputChannel: vscode.OutputChannel;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly _onDidChange = new vscode.EventEmitter<string | null>();
    readonly onDidChange = this._onDidChange.event;

    constructor(private readonly adapter: CodeForIbmiAdapter) {
        this.outputChannel = vscode.window.createOutputChannel('RPG-III');
        this.disposables.push(
            adapter.onDidChangeConnection(() => this.invalidate()),
        );
    }

    getIndex(doc: vscode.TextDocument): Promise<ExternalFieldIndex | null> {
        const uri = doc.uri.toString();
        const existing = this.cache.get(uri);
        if (existing) {
            if (existing.succeeded === false && existing.settledAt !== undefined
                && Date.now() - existing.settledAt > FAILURE_TTL_MS) {
                this.cache.delete(uri);
            } else {
                return existing.promise;
            }
        }
        return this.buildIndex(doc);
    }

    prefetch(doc: vscode.TextDocument): void {
        void this.getIndex(doc).catch(() => { /* swallow: prefetch errors non-fatal */ });
    }

    invalidate(uri?: string): void {
        if (uri) {
            this.cache.delete(uri);
            this._onDidChange.fire(uri);
        } else {
            this.cache.clear();
            this.libraryListCache = undefined;
            this.hasWarnedAboutSqlFailure.clear();
            this._onDidChange.fire(null);
        }
    }

    dispose(): void {
        this._onDidChange.dispose();
        this.disposables.forEach(d => d.dispose());
        this.outputChannel.dispose();
    }

    private buildIndex(doc: vscode.TextDocument): Promise<ExternalFieldIndex | null> {
        const uri = doc.uri.toString();
        const promise = this.buildIndexInner(doc);
        const entry: CacheEntry = { connectionId: '', promise };
        this.cache.set(uri, entry);
        promise.then(
            result => {
                entry.settledAt = Date.now();
                entry.succeeded = result !== null;
            },
            () => {
                entry.settledAt = Date.now();
                entry.succeeded = false;
            },
        );
        return promise;
    }

    private log(msg: string): void {
        this.outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);
    }

    private async buildIndexInner(doc: vscode.TextDocument): Promise<ExternalFieldIndex | null> {
        this.log(`buildIndex: ${doc.uri.fsPath}`);

        if (!this.adapter.isAvailable()) {
            this.log('Code for IBM i extension not found — external field resolution unavailable');
            this.warnMissingOnce();
            return null;
        }

        const conn = await this.adapter.getConnection();
        if (!conn) {
            this.log('Code for IBM i has no active connection');
            this.warnDisconnectedOnce();
            return null;
        }
        this.log(`Connected: ${conn.id}`);

        // Source filenames from the parsed symbol table — already deduplicated
        // and F-spec-continuation-aware.
        const rpgDoc = documentCache.get(doc);
        const fileNames = [...rpgDoc.symbols.files.keys()].map(k => k.toUpperCase());
        this.log(`F-spec files in document: ${fileNames.join(', ') || '(none)'}`);
        if (fileNames.length === 0) {
            return emptyIndex(conn.id);
        }

        const promise = this.fetchFields(conn, fileNames);
        vscode.window.setStatusBarMessage('RPG-III: resolving external field definitions…', promise);

        try {
            const result = await promise;
            return result;
        } catch (err) {
            this.logSqlFailure(conn.id, err);
            return null;
        }
    }

    private async fetchFields(
        conn: IbmiConnectionInfo,
        fileNames: string[],
    ): Promise<ExternalFieldIndex> {
        const libraryList = await this.getLibraryList(conn);
        if (libraryList.length === 0) {
            this.log('Library list is empty — cannot resolve files');
            return emptyIndex(conn.id);
        }
        const schemas = [...new Set(libraryList.map(l => l.SYSTEM_SCHEMA_NAME.toUpperCase()))];
        this.log(`Library list (${libraryList.length} entries): ${schemas.slice(0, 10).join(', ')}${schemas.length > 10 ? '…' : ''}`);

        const sql = buildSysColumnsQuery(fileNames, schemas);
        this.log(`SYSCOLUMNS query: ${sql}`);
        const rawRows = await conn.runSQL(sql);
        const rows = rawRows as unknown as SysColumnsRow[];
        this.log(`SYSCOLUMNS returned ${rows.length} row(s)`);

        const resolved = resolveFiles(fileNames, rows, libraryList);

        const fields = new Map<string, ExternalFieldHit[]>();
        const resolvedFiles = new Map<string, { schema: string; found: boolean }>();
        for (const [file, info] of resolved) {
            resolvedFiles.set(file, { schema: info.schema, found: info.found });
            if (!info.found) {
                this.log(`  ${file}: not found in any library`);
                continue;
            }
            this.log(`  ${file}: resolved to ${info.schema} (${info.rows.length} column(s))`);
            for (const row of info.rows) {
                const hit = mapRowToHit(row);
                const list = fields.get(hit.fieldName) ?? [];
                list.push(hit);
                fields.set(hit.fieldName, list);
            }
        }
        this.log(`Index built: ${fields.size} distinct field name(s) across ${resolvedFiles.size} file(s)`);
        return { fields, resolvedFiles, connectionId: conn.id };
    }

    private async getLibraryList(conn: IbmiConnectionInfo): Promise<LibraryListRow[]> {
        if (this.libraryListCache && this.libraryListCache.connectionId === conn.id) {
            this.log('Library list: using cached result');
            return this.libraryListCache.rows;
        }
        this.log(`Fetching library list for connection: ${conn.id}`);
        const raw = await conn.runSQL(buildLibraryListQuery());
        const rows = raw as unknown as LibraryListRow[];
        this.log(`Library list fetched: ${rows.length} libraries`);
        this.libraryListCache = { connectionId: conn.id, rows };
        return rows;
    }

    private warnMissingOnce(): void {
        if (this.hasWarnedAboutMissing) { return; }
        this.hasWarnedAboutMissing = true;
        vscode.window.showInformationMessage(
            'RPG-III: Install the "Code for IBM i" extension to resolve external file fields.',
            'Install',
        ).then(choice => {
            if (choice === 'Install') {
                void vscode.commands.executeCommand(
                    'workbench.extensions.installExtension', 'halcyontechltd.code-for-ibmi',
                );
            }
        });
    }

    private warnDisconnectedOnce(): void {
        if (this.hasWarnedAboutDisconnect) { return; }
        this.hasWarnedAboutDisconnect = true;
        vscode.window.showInformationMessage(
            'RPG-III: Connect to an IBM i in Code for IBM i to resolve external file fields.',
        );
    }

    private logSqlFailure(connectionId: string, err: unknown): void {
        const msg = err instanceof Error ? err.stack ?? err.message : String(err);
        this.outputChannel.appendLine(`[${new Date().toISOString()}] SYSCOLUMNS query failed: ${msg}`);
        if (!this.hasWarnedAboutSqlFailure.has(connectionId)) {
            this.hasWarnedAboutSqlFailure.add(connectionId);
            vscode.window.showWarningMessage(
                'RPG-III: Failed to fetch external field definitions. See the RPG-III output channel.',
            );
        }
    }
}

function emptyIndex(connectionId: string): ExternalFieldIndex {
    return { fields: new Map(), resolvedFiles: new Map(), connectionId };
}
