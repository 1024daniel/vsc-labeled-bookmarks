import * as vscode from 'vscode';
import * as path from 'path';


// vscode.workspace.getWorkspaceFolder(uri)
export function getAbsolutePath(relativePath: string): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceFolder) {
        throw new Error('No workspace folder is open');
    }
    return path.resolve(workspaceFolder, relativePath);
}

// vscode.workspace.asRelativePath(absFsPath)
export function getRelativePath(absPath: string): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceFolder) {
        throw new Error('No workspace folder is open');
    }
    return path.relative(workspaceFolder, absPath);
}