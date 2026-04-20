/**
 * Registers the vscode mock so that every `require('vscode')` issued by the
 * compiled production code resolves to test/mocks/vscode.js.
 */

import * as path from 'path';
import Module = require('module');

const mockPath = path.resolve(__dirname, 'mocks', 'vscode.js');

const originalResolve = (Module as any)._resolveFilename.bind(Module);
(Module as any)._resolveFilename = function (request: string, parent: NodeJS.Module, ...rest: unknown[]) {
    if (request === 'vscode') {
        return mockPath;
    }
    return originalResolve(request, parent, ...rest);
};
