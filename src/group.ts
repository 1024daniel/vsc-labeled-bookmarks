import * as vscode from 'vscode';
import { TextEditorDecorationType, Uri } from 'vscode';
import { File } from "./file";

export class Group {
    static svgDir: Uri;

    label: string;
    color: string;
    modifiedAt: Date;
    files: Array<File>;
    decoration?: TextEditorDecorationType;

    private constructor(label: string, color: string, modifiedAt: Date) {
        this.label = label;
        this.color = color;
        this.ensureUsableColor();
        this.modifiedAt = modifiedAt;
        this.files = [];
    }

    public async new(label: string, color: string, modifiedAt: Date): Promise<Group> {
        let result = new Group(label, color, modifiedAt);
        await result.initDecoration();
        return result;
    }

    private ensureUsableColor() {
        if (this.color.match(/^[0-9a-f]+$/i) === null) {
            throw new Error("Illegal color definition: " + this.color);
        }

        this.color = this.color.toLowerCase();
        switch (this.color.length) {
            case 3:
                this.color = this.color.charAt(0) + "0" + this.color.charAt(1) + "0" + this.color.charAt(2) + "0ff";
                break;
            case 8:
                break;
            default:
                if (this.color.length < 8) {
                    this.color.padEnd(8, "f");
                } else {
                    this.color = this.color.substr(0, 8);
                }
        }
    }

    private async initDecoration() {
        let svgUri = Uri.joinPath(Group.svgDir, "bm_" + this.color + ".svg");

        let stat = await vscode.workspace.fs.stat(svgUri);
        if (stat.size < 1) {
            await this.createSvg(svgUri, this.color);
        }

        this.decoration = vscode.window.createTextEditorDecorationType(
            {
                gutterIconPath: svgUri,
                gutterIconSize: 'contain',
            }
        );
    }

    private async createSvg(svgUri: Uri, color: string) {
        let svgSource = new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x20, 0x78, 0x6d, 0x6c, 0x6e, 0x73, 0x3d, 0x22, 0x68,
            0x74, 0x74, 0x70, 0x3a, 0x2f, 0x2f, 0x77, 0x77, 0x77, 0x2e, 0x77, 0x33, 0x2e, 0x6f, 0x72, 0x67, 0x2f, 0x32,
            0x30, 0x30, 0x30, 0x2f, 0x73, 0x76, 0x67, 0x22, 0x20, 0x77, 0x69, 0x64, 0x74, 0x68, 0x3d, 0x22, 0x33, 0x32,
            0x22, 0x20, 0x68, 0x65, 0x69, 0x67, 0x68, 0x74, 0x3d, 0x22, 0x33, 0x32, 0x22, 0x3e, 0x3c, 0x70, 0x61, 0x74,
            0x68, 0x20, 0x64, 0x3d, 0x22, 0x4d, 0x37, 0x20, 0x33, 0x30, 0x20, 0x4c, 0x37, 0x20, 0x38, 0x20, 0x51, 0x37,
            0x20, 0x32, 0x20, 0x31, 0x33, 0x20, 0x32, 0x20, 0x4c, 0x31, 0x39, 0x20, 0x32, 0x20, 0x51, 0x32, 0x35, 0x20,
            0x32, 0x20, 0x32, 0x35, 0x20, 0x38, 0x20, 0x4c, 0x32, 0x35, 0x20, 0x33, 0x30, 0x20, 0x4c, 0x31, 0x36, 0x20,
            0x32, 0x33, 0x20, 0x5a, 0x22, 0x20, 0x66, 0x69, 0x6c, 0x6c, 0x3d, 0x22, 0x23, 0x66, 0x66, 0x66, 0x66, 0x66,
            0x66, 0x66, 0x66, 0x22, 0x20, 0x2f, 0x3e, 0x3c, 0x2f, 0x73, 0x76, 0x67, 0x3e]);
        let colorOffset = 134;

        for (let i = 0; i < 8; i++) {
            svgSource[i + colorOffset] = color.charCodeAt(i);
        }

        await vscode.workspace.fs.writeFile(svgUri, svgSource);
    }
}