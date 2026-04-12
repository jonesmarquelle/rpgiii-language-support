/**
 * rpgDocument.ts
 *
 * RpgDocument cache: parse RPG files once and invalidate on change.
 */

import * as vscode from 'vscode';
import { RpgDocument } from '../types/rpgTypes';
import { parseDocument } from './rpgParser';

class DocumentCache {
    private cache = new Map<string, RpgDocument>();

    /**
     * Return the parsed RpgDocument for the given TextDocument.
     * Parses on first access or when the document version has changed.
     */
    get(textDoc: vscode.TextDocument): RpgDocument {
        const key = textDoc.uri.toString();
        const cached = this.cache.get(key);
        if (cached && cached.version === textDoc.version) {
            return cached;
        }
        const doc = parseDocument(textDoc);
        this.cache.set(key, doc);
        return doc;
    }

    invalidate(uri: string): void {
        this.cache.delete(uri);
    }

    clear(): void {
        this.cache.clear();
    }
}

export const documentCache = new DocumentCache();
