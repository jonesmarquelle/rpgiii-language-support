/**
 * extension.ts
 *
 * RPG-III Language Support — VSCode extension entry point.
 * Registers all language providers and wires up document cache invalidation.
 */

import * as vscode from 'vscode';
import { documentCache } from './parser/rpgDocument';
import { RpgFoldingProvider } from './providers/foldingProvider';
import { RpgDocumentSymbolProvider } from './providers/documentSymbolProvider';
import { RpgDefinitionProvider } from './providers/definitionProvider';
import { RpgHoverProvider } from './providers/hoverProvider';
import { RpgReferenceProvider } from './providers/referenceProvider';
import { RpgSemanticTokenProvider, TOKEN_TYPES, TOKEN_MODIFIERS } from './providers/semanticTokenProvider';

const RPG_LANG = 'rpg';

export function activate(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = { language: RPG_LANG };

    // ── Semantic tokens ──────────────────────────────────────────────
    const semanticProvider = new RpgSemanticTokenProvider();
    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider(
            selector,
            semanticProvider,
            semanticProvider.legend,
        ),
    );

    // ── Code folding ─────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider(selector, new RpgFoldingProvider()),
    );

    // ── Document symbols (Outline) ───────────────────────────────────
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(selector, new RpgDocumentSymbolProvider()),
    );

    // ── Go-to Definition ─────────────────────────────────────────────
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(selector, new RpgDefinitionProvider()),
    );

    // ── Find All References ──────────────────────────────────────────
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider(selector, new RpgReferenceProvider()),
    );

    // ── Hover ────────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(selector, new RpgHoverProvider()),
    );

    // ── Cache invalidation ───────────────────────────────────────────
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.languageId === RPG_LANG) {
                documentCache.invalidate(e.document.uri.toString());
            }
        }),
        vscode.workspace.onDidCloseTextDocument(doc => {
            documentCache.invalidate(doc.uri.toString());
        }),
    );
}

export function deactivate(): void {
    documentCache.clear();
}
