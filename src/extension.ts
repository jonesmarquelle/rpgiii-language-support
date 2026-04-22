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
import { RpgSemanticTokenProvider } from './providers/semanticTokenProvider';
import { CodeForIbmiAdapter } from './services/codeForIbmi';
import { ExternalFieldIndexService } from './services/externalFieldIndex';

const RPG_LANG = 'rpg';

export function activate(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = { language: RPG_LANG };

    // ── External field resolution (Code for IBM i, optional) ─────────
    const ibmiAdapter = new CodeForIbmiAdapter(context);
    const externalFields = new ExternalFieldIndexService(ibmiAdapter);
    context.subscriptions.push(ibmiAdapter, externalFields);

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
        vscode.languages.registerDefinitionProvider(
            selector, new RpgDefinitionProvider(externalFields),
        ),
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
    const externalInvalidators = new Map<string, NodeJS.Timeout>();
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.languageId !== RPG_LANG) { return; }
            const uri = e.document.uri.toString();
            documentCache.invalidate(uri);
            // Debounce external-field invalidation: only blow away the index
            // when edits have quieted for 750ms, so typing doesn't thrash it.
            const existing = externalInvalidators.get(uri);
            if (existing) { clearTimeout(existing); }
            externalInvalidators.set(uri, setTimeout(() => {
                externalFields.invalidate(uri);
                externalInvalidators.delete(uri);
            }, 750));
        }),
        vscode.workspace.onDidCloseTextDocument(doc => {
            const uri = doc.uri.toString();
            documentCache.invalidate(uri);
            externalFields.invalidate(uri);
            const pending = externalInvalidators.get(uri);
            if (pending) { clearTimeout(pending); externalInvalidators.delete(uri); }
        }),
    );

    // ── Prefetch external fields on open ─────────────────────────────
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (doc.languageId === RPG_LANG) { externalFields.prefetch(doc); }
        }),
    );
    vscode.workspace.textDocuments
        .filter(d => d.languageId === RPG_LANG)
        .forEach(d => externalFields.prefetch(d));

    // ── Commands ─────────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('rpg-iii.refreshExternalFields', () => {
            externalFields.invalidate();
            vscode.window.showInformationMessage('RPG-III: External field cache cleared.');
        }),
    );
}

export function deactivate(): void {
    documentCache.clear();
}
