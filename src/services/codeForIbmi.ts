/**
 * codeForIbmi.ts
 *
 * Runtime adapter for the Code for IBM i extension. Discovery is lazy and
 * defensive — the extension is an OPTIONAL companion, not a hard dependency.
 * If it isn't installed or the user isn't connected, callers get undefined
 * and fall back gracefully.
 */

import * as vscode from 'vscode';
import type { CodeForIBMi } from '@halcyontech/vscode-ibmi-types';
import type IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';

const CODE_FOR_IBMI_ID = 'halcyontechltd.code-for-ibmi';

export interface IbmiConnectionInfo {
    id: string;                                                         // host+user — cache key
    runSQL(sql: string): Promise<Record<string, string | number | null>[]>;
}

export class CodeForIbmiAdapter implements vscode.Disposable {
    private readonly _onDidChangeConnection =
        new vscode.EventEmitter<IbmiConnectionInfo | undefined>();
    readonly onDidChangeConnection = this._onDidChangeConnection.event;

    private activationPromise: Promise<CodeForIBMi | undefined> | undefined;
    private eventsWired = false;

    constructor(private readonly context: vscode.ExtensionContext) { }

    isAvailable(): boolean {
        return vscode.extensions.getExtension<CodeForIBMi>(CODE_FOR_IBMI_ID) !== undefined;
    }

    async ensureActivated(): Promise<CodeForIBMi | undefined> {
        const ext = vscode.extensions.getExtension<CodeForIBMi>(CODE_FOR_IBMI_ID);
        if (!ext) { return undefined; }
        if (!this.activationPromise) {
            this.activationPromise = ext.isActive
                ? Promise.resolve(ext.exports)
                : Promise.resolve(ext.activate());
        }
        const exports = await this.activationPromise;
        this.wireEvents(exports);
        return exports;
    }

    async getConnection(): Promise<IbmiConnectionInfo | undefined> {
        const exports = await this.ensureActivated();
        if (!exports) { return undefined; }
        const conn = safeGetConnection(exports);
        if (!conn || !conn.currentHost) { return undefined; }
        return wrapConnection(conn);
    }

    private wireEvents(exports: CodeForIBMi | undefined): void {
        if (this.eventsWired || !exports) { return; }
        this.eventsWired = true;
        const fire = async () => {
            const conn = safeGetConnection(exports);
            const info = conn && conn.currentHost ? wrapConnection(conn) : undefined;
            this._onDidChangeConnection.fire(info);
        };
        exports.instance.subscribe(this.context, 'connected', 'rpg-iii: connection changed', fire);
        exports.instance.subscribe(this.context, 'disconnected', 'rpg-iii: disconnected', fire);
    }

    dispose(): void {
        this._onDidChangeConnection.dispose();
    }
}

function safeGetConnection(exports: CodeForIBMi): IBMi | undefined {
    try {
        return exports.instance.getConnection();
    } catch {
        return undefined;
    }
}

function wrapConnection(conn: IBMi): IbmiConnectionInfo {
    return {
        id: `${conn.currentHost}:${conn.currentUser}`,
        runSQL: (sql: string) => conn.runSQL(sql),
    };
}
