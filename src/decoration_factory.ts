import * as path from 'path';
import * as vscode from 'vscode';
import { DecorationRangeBehavior, OverviewRulerLane, Uri } from "vscode";
import { TextEditorDecorationType } from "vscode";

const svgBookmark = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<path d="M7 30 L7 5 Q7 2 10 2 L22 2 Q25 2 25 5 L25 30 L16 23 Z" fill="color" />
</svg>`;

const svgBookmarkWithText = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<mask id="x">
    <rect width="32" height="32" fill="white" x="0" y="0" />
    <text x="16" y="18" text-anchor="middle" fill="black"
        style="font-size: 16; font-family: sans-serif; alignment-baseline: bottom; font-weight:bold;">Q</text>
</mask>
<path mask="url(#x)" d="M7 30 L7 5 Q7 2 10 2 L22 2 Q25 2 25 5 L25 30 L16 23 Z" fill="color" />
</svg>`;

const svgCircle = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<circle cx="16" cy="16" r="12" fill="color" />
</svg>`;

const svgCircleWithText = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<mask id="x">
    <rect width="32" height="32" fill="white" x="0" y="0" />
    <text x="16" y="21.5" text-anchor="middle" fill="black"
        style="font-size: 16; font-family: sans-serif; alignment-baseline: bottom; font-weight:bold;">Q</text>
</mask>
<circle mask="url(#x)" cx="16" cy="16" r="12" fill="color" />
</svg>`;

const svgHeart = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<path fill="color"
    d="M16 8 C16 8 16 4 21 4 C24 4 28 5 28 10 C28 18 17 27 16 28 C15 27 4 18 4 10C4 5 8 4 11 4 C16 4  16 8 16 8" />
</svg>`;

const svgHeartWithText = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<mask id="x">
    <rect width="32" height="32" fill="white" x="0" y="0" />
    <text x="16" y="20" text-anchor="middle" fill="black"
        style="font-size: 14; font-family: sans-serif; alignment-baseline:bottom; font-weight:bold;">Q</text>
</mask>
<path mask="url(#x)" fill="color"
    d="M16 8 C16 8 16 4 21 4 C24 4 28 5 28 10 C28 18 17 27 16 28 C15 27 4 18 4 10C4 5 8 4 11 4 C16 4  16 8 16 8" />
</svg>`;

const svgLabel = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<path fill="color"
    d="M4 7 L24 7 L28 16 L24 25 L4 25 Z" />
</svg>`;

const svgLabelWithText = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<mask id="x">
    <rect width="32" height="32" fill="white" x="0" y="0" />
    <text x="15" y="21.5" text-anchor="middle" fill="black"
        style="font-size: 16; font-family: sans-serif; alignment-baseline: bottom; font-weight:bold;">Q</text>
</mask>
<path mask="url(#x)" fill="color" d="M4 7 L24 7 L28 16 L24 25 L4 25 Z" />
</svg>`;

const svgStar = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<path fill="color"
    d="M16 2 L20.70 9.52 L29.31 11.67 L23.60 18.47 L24.22 27.32 L16 24 L7.77 27.32 L8.39 18.47 L2.68 11.67 L11.29 9.52 Z" />
</svg>`;

const svgStarWithText = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<mask id="x">
    <rect width="32" height="32" fill="white" x="0" y="0" />
    <text x="16" y="21" text-anchor="middle" fill="black"
        style="font-size: 14; font-family: sans-serif; alignment-baseline:bottom; font-weight:bold;">Q</text>
</mask>
<path mask="url(#x)" fill="color"
    d="M16 2 L20.70 9.52 L29.31 11.67 L23.60 18.47 L24.22 27.32 L16 24 L7.77 27.32 L8.39 18.47 L2.68 11.67 L11.29 9.52 Z" />
</svg>`;

const svgUnicodeChar = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<text x="16" y="18" text-anchor="middle" fill="color"
    style="font-size: 26; alignment-baseline:middle;">Q</text>
</svg>`;

const svgTriangle = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<path fill="color"
    d="M16 4 L28 28 H4 Z" />
</svg>`;

const svgDiamond = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<path fill="color"
    d="M16 2 L30 16 L16 30 L2 16 Z" />
</svg>`;

const svgHexagon = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<path fill="color"
    d="M16 4 L26 10 V22 L16 28 L6 22 V10 Z" />
</svg>`;

const svgFlag = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<path fill="color"
    d="M6 2 V30 M6 2 H22 L18 6 L22 10 H6 Z" />
</svg>`;

const svgArrow = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<path fill="color"
    d="M6 14 H22 L16 8 L18 6 L26 14 L18 22 L16 20 L22 14 Z" />
</svg>`;

const svgPentagon = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<path fill="color"
    d="M16 4 L28 12 L24 26 L8 26 L4 12 Z" />
</svg>`;

const svgOctagon = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<path fill="color"
    d="M12 4 H20 L28 12 V20 L20 28 H12 L4 20 V12 Z" />
</svg>`;

const svgPlus = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<path fill="color"
    d="M14 6 H18 V14 H26 V18 H18 V26 H14 V18 H6 V14 H14 Z" />
</svg>`;

const svgCheckmark = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<path fill="color"
    d="M6 16 L12 22 L26 8 L22 4 L12 18 L10 16 Z" />
</svg>`;

const svgRing = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<path fill="color"
    d="M16 6 A10 10 0 1 1 16 26 A10 10 0 1 1 16 6 M16 10 A6 6 0 1 0 16 22 A6 6 0 1 0 16 10 Z" />
</svg>`;

const svgLightning = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<path fill="color"
    d="M18 4 H24 L14 16 H20 L12 28 L14 18 H8 Z" />
</svg>`;

const svgCloud = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
<path fill="color"
    d="M8 18 A6 6 0 0 1 14 12 H18 A8 8 0 0 1 26 20 A6 6 0 0 1 20 26 H12 A4 4 0 0 1 8 22 Z" />
</svg>`;

// https://www.untitledui.com/free-icons/general

const svgLight = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
 <path fill="color" d="M12 2V6M12 18V22M6 12H2M22 12H18M19.0784 19.0784L16.25 16.25M19.0784 4.99994L16.25 7.82837M4.92157 19.0784L7.75 16.25M4.92157 4.99994L7.75 7.82837" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
 </svg>`;

 const svgPin = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
 <path fill="color" d="M8.3767 15.6163L2.71985 21.2732M11.6944 6.64181L10.1335 8.2027C10.0062 8.33003 9.94252 8.39369 9.86999 8.44427C9.80561 8.48917 9.73616 8.52634 9.66309 8.555C9.58077 8.58729 9.49249 8.60495 9.31592 8.64026L5.65145 9.37315C4.69915 9.56361 4.223 9.65884 4.00024 9.9099C3.80617 10.1286 3.71755 10.4213 3.75771 10.7109C3.8038 11.0434 4.14715 11.3867 4.83387 12.0735L11.9196 19.1592C12.6063 19.8459 12.9497 20.1893 13.2821 20.2354C13.5718 20.2755 13.8645 20.1869 14.0832 19.9928C14.3342 19.7701 14.4294 19.2939 14.6199 18.3416L15.3528 14.6771C15.3881 14.5006 15.4058 14.4123 15.4381 14.33C15.4667 14.2569 15.5039 14.1875 15.5488 14.1231C15.5994 14.0505 15.663 13.9869 15.7904 13.8596L17.3512 12.2987C17.4326 12.2173 17.4734 12.1766 17.5181 12.141C17.5578 12.1095 17.5999 12.081 17.644 12.0558C17.6936 12.0274 17.7465 12.0048 17.8523 11.9594L20.3467 10.8904C21.0744 10.5785 21.4383 10.4226 21.6035 10.1706C21.7481 9.95025 21.7998 9.68175 21.7474 9.42348C21.6875 9.12813 21.4076 8.84822 20.8478 8.28839L15.7047 3.14526C15.1448 2.58543 14.8649 2.30552 14.5696 2.24565C14.3113 2.19329 14.0428 2.245 13.8225 2.38953C13.5705 2.55481 13.4145 2.91866 13.1027 3.64636L12.0337 6.14071C11.9883 6.24653 11.9656 6.29944 11.9373 6.34905C11.9121 6.39313 11.8836 6.43522 11.852 6.47496C11.8165 6.51971 11.7758 6.56041 11.6944 6.64181Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
 </svg>`;
 
 const svgZoom = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
 <path fill="color" d="M21 21L16.65 16.65M11 6C13.7614 6 16 8.23858 16 11M19 11C19 15.4183 15.4183 19 11 19C6.58172 19 3 15.4183 3 11C3 6.58172 6.58172 3 11 3C15.4183 3 19 6.58172 19 11Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
 </svg>`;

 const svgShare = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
 <path fill="color" d="M8.59 13.51L15.42 17.49M15.41 6.51L8.59 10.49M21 5C21 6.65685 19.6569 8 18 8C16.3431 8 15 6.65685 15 5C15 3.34315 16.3431 2 18 2C19.6569 2 21 3.34315 21 5ZM9 12C9 13.6569 7.65685 15 6 15C4.34315 15 3 13.6569 3 12C3 10.3431 4.34315 9 6 9C7.65685 9 9 10.3431 9 12ZM21 19C21 20.6569 19.6569 22 18 22C16.3431 22 15 20.6569 15 19C15 17.3431 16.3431 16 18 16C19.6569 16 21 17.3431 21 19Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
 </svg>`;

// 获取字符串中的所有 Unicode 代码点（支持单个和多个代码点）
function getUnicodeCodePoints(str: string): number[] {
    let codePoints: number[] = [];

    for (let i = 0; i < str.length; i++) {
        let codePoint = str.codePointAt(i);
        if (codePoint !== undefined) {
            codePoints.push(codePoint);
        }

        // 如果是补充字符（高位代理对），跳过下一个字符
        if (codePoint !== undefined && codePoint > 0xFFFF) {
            i++;  // 跳过低位代理对
        }
    }

    return codePoints;
}

export class DecorationFactory {
    private readonly singleCharacterLabelPatern = /^[a-zA-Z0-9!?+-=\/\$%#]$/;

    public readonly placeholderDecorationUri = Uri.file(
        path.join(__dirname, "..", "resources", "gutter_icon_bm.svg")
    );

    public readonly placeholderDecoration = vscode.window.createTextEditorDecorationType(
        {
            gutterIconPath: this.placeholderDecorationUri.fsPath,
            gutterIconSize: 'contain',
        }
    );

    public svgDir: Uri;
    public overviewRulerLane: OverviewRulerLane | undefined;
    public lineEndLabelType: string;

    constructor(svgDir: Uri, overviewRulerLane: OverviewRulerLane | undefined, lineEndLabelType: string) {
        this.svgDir = svgDir;
        this.overviewRulerLane = overviewRulerLane;
        this.lineEndLabelType = lineEndLabelType;
    }

    
    public generateSvg(shape: string, color: string, iconText: string): [string, string] {
        iconText = iconText.normalize();

        if (shape !== "unicode") {
            if (!this.singleCharacterLabelPatern.test(iconText)) {
                iconText = "";
            } else {
                iconText = iconText.substring(0, 1).toUpperCase();
            }
        }

        let fileNamePostfix = '';
        let svg: string;

        if (iconText === "") {
            switch (shape) {
                case "circle": svg = svgCircle; break;
                case "heart": svg = svgHeart; break;
                case "label": svg = svgLabel; break;
                case "star": svg = svgStar; break;
                case "triangle": svg = svgTriangle; break; // 三角形
                case "diamond": svg = svgDiamond; break; // 菱形
                case "hexagon": svg = svgHexagon; break; // 六边形
                case "flag": svg = svgFlag; break; // 旗帜
                case "arrow": svg = svgArrow; break; // 箭头
                case "pentagon": svg = svgPentagon; break; // 五边形
                case "octagon": svg = svgOctagon; break; // 八边形
                case "plus": svg = svgPlus; break;
                case "checkmark": svg = svgCheckmark; break;
                case "ring": svg = svgRing; break;
                case "lightning": svg = svgLightning; break;
                case "cloud": svg = svgCloud; break;
                case "light": svg = svgLight; break;
                case "pin": svg = svgPin; break;
                case "zoom": svg = svgZoom; break;
                case "share": svg = svgShare; break;
                default:
                    svg = svgBookmark;
                    shape = "bookmark";
            }
        } else {
            switch (shape) {
                case "circle": svg = svgCircleWithText; break;
                case "heart": svg = svgHeartWithText; break;
                case "label": svg = svgLabelWithText; break;
                case "star": svg = svgStarWithText; break;
                case "unicode": svg = svgUnicodeChar; break;
                default:
                    svg = svgBookmarkWithText;
                    shape = "bookmark";
            }
            let codePoints: number[] = getUnicodeCodePoints(iconText);
            // 将所有代码点转化为 HTML 实体格式（例如 &#127473;）
            let codePointStr: string = codePoints.map(cp => `&#${cp};`).join("");
            svg = svg.replace(">Q<", `>${codePointStr}<`);

            fileNamePostfix = codePointStr;
        }

        color = this.normalizeColorFormatV2(color);
        svg = svg.replace("color", color);
        return [svg, fileNamePostfix];
    }

    async create(shape: string, color: string, iconText: string, lineLabel?: string): Promise<[TextEditorDecorationType, Uri]> {
        let [svg, fileNamePostfix] = this.generateSvg(shape, color, iconText);

        let fileName = shape + "_" + color + "_" + fileNamePostfix + ".svg";
        // let bytes = Uint8Array.from(svg.split("").map(c => { return c.charCodeAt(0); }));
        // use TextEncoder to encode the svg string to Uint8Array, this is more correct for UTF-8 encoding
        let encoder = new TextEncoder(); // 默认 UTF-8
        let bytes = encoder.encode(svg); // 正确编码为 Uint8Array
        let svgUri = Uri.joinPath(this.svgDir, fileName);

        try {
            let stat = await vscode.workspace.fs.stat(svgUri);
            if (stat.size < 1) {
                await vscode.workspace.fs.writeFile(svgUri, bytes);
            }
        } catch (e) {
            await vscode.workspace.fs.writeFile(svgUri, bytes);
        }

        let decorationOptions = {
            gutterIconPath: svgUri,
            gutterIconSize: 'contain',
            overviewRulerColor: (typeof this.overviewRulerLane !== "undefined")
                ? color
                : undefined,
            overviewRulerLane: this.overviewRulerLane,
            rangeBehavior: DecorationRangeBehavior.ClosedClosed,
            after: {},
            isWholeLine: true,
        };
        // options for line end label of bookmark
        if (typeof lineLabel !== "undefined") {
            switch (this.lineEndLabelType) {
                case "bordered":
                    decorationOptions.after = {
                        border: `1px solid ${color}`,
                        color: color,
                        contentText: "\u2002" + lineLabel + "\u2002",
                        margin: "0px 0px 0px 10px",
                    };
                    break;
                case "inverse":
                    decorationOptions.after = {
                        backgroundColor: color,
                        color: new vscode.ThemeColor("editor.background"),
                        contentText: "\u2002" + lineLabel + "\u2002",
                        margin: "0px 0px 0px 10px",
                    };
                    break;
            }
        }

        let result = vscode.window.createTextEditorDecorationType(decorationOptions);

        return [result, svgUri];
    }

    public normalizeColorFormat(color: string): string { 
        if (color.match(/^#?[0-9a-f]+$/i) === null) {
            return "888888ff";
        }

        if (color.charAt(0) === "#") {
            color = color.substr(1, 8);
        } else {
            color = color.substr(0, 8);
        }

        color = color.toLowerCase();

        if (color.length < 8) {
            color = color.padEnd(8, "f");
        }

        return color;
    }
    public normalizeColorFormatV2(color: string): string {
        if (typeof color !== "string") return "rgba(255, 0, 0, 0.4)"; // fallback
    
        color = color.trim().toLowerCase();
    
        // handle #rgb or #rgba
        if (/^#?[0-9a-f]{3,4}$/i.test(color)) {
            if (color.startsWith("#")) color = color.slice(1);
            const r = parseInt(color[0] + color[0], 16);
            const g = parseInt(color[1] + color[1], 16);
            const b = parseInt(color[2] + color[2], 16);
            const a = color.length === 4 ? parseInt(color[3] + color[3], 16) / 255 : 1;
            return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
        }
    
        // handle #rrggbb or #rrggbbaa or raw hex
        if (/^#?[0-9a-f]{6,8}$/i.test(color)) {
            if (color.startsWith("#")) color = color.slice(1);
            const r = parseInt(color.slice(0, 2), 16);
            const g = parseInt(color.slice(2, 4), 16);
            const b = parseInt(color.slice(4, 6), 16);
            const a = color.length === 8 ? parseInt(color.slice(6, 8), 16) / 255 : 1;
            return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
        }

        // Handle rgb or rgba (e.g., rgb(233, 255, 0), rgba(233, 255, 0, 0.5))
        const rgbRegex = /^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/i;
        const rgbaRegex = /^rgba\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3}),\s*(\d(\.\d+)?)\)$/i;

        // Check for rgb format
        if (rgbRegex.test(color)) {
            const matches = color.match(rgbRegex);
            if (matches) {
                const r = parseInt(matches[1]);
                const g = parseInt(matches[2]);
                const b = parseInt(matches[3]);
                return `rgba(${r}, ${g}, ${b}, 1)`;
            }
        }

        // Check for rgba format
        if (rgbaRegex.test(color)) {
            const matches = color.match(rgbaRegex);
            if (matches) {
                const r = parseInt(matches[1]);
                const g = parseInt(matches[2]);
                const b = parseInt(matches[3]);
                const a = parseFloat(matches[4]);
                return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
            }
        }
    
        // fallback to default
        return "rgba(255, 0, 0, 0.4)"; // red semi-transparent
    }
}