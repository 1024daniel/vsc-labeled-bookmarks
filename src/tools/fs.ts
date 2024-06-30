import * as vscode from 'vscode';
import * as path from 'path';
export function getAbsolutePath(relativePath: string): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceFolder) {
        throw new Error('No workspace folder is open');
    }
    return path.resolve(workspaceFolder, relativePath);
}
export function getRelativePath(absPath: string): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceFolder) {
        throw new Error('No workspace folder is open');
    }
    return path.relative(workspaceFolder, absPath);
}