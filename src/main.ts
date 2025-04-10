import * as vscode from 'vscode';
import * as path from 'path';
import { Group } from "./group";
import {
    ExtensionContext,
    FileDeleteEvent, FileRenameEvent,
    OverviewRulerLane,
    Range, Selection,
    StatusBarItem,
    TextDocument, TextDocumentChangeEvent, TextEditor, TextEditorDecorationType,
    QuickPickItem,
    Uri,
    MessageItem
} from 'vscode';
import { DecorationFactory } from './decoration_factory';
import { GroupPickItem } from './group_pick_item';
import { BookmarkPickItem } from './bookmark_pick_item';
import { ShapePickItem } from './shape_pick_item';
import { ColorPickItem } from './color_pick_item';
import { QuickPickSeparator } from './quick_pick_separator';
import { Bookmark } from "./bookmark";
import { SerializableGroup } from "./storage/serializable_group";
import { SerializableBookmark } from "./storage/serializable_bookmark";
import { BookmarkDataProvider } from './interface/bookmark_data_provider';
import { BookmarkManager } from './interface/bookmark_manager';
import { BookmarkDataStorage } from './interface/bookmark_data_storage';
import { BookmarkStorageDummy } from './storage/bookmark_storage_dummy';
import { ActiveGroupProvider } from './interface/active_group_provider';
import { BookmarkStorageInWorkspaceState } from './storage/bookmark_storage_in_workspace_state';
import { BookmarkStorageInFile } from './storage/bookmark_storage_in_file';
import { StringPayloadPickItem } from './string_payload_pick_item';
import { RateLimiter } from './rate_limiter/rate_limiter';
import { FolderMappingStats } from './storage/folder_mapping_stats';
import { FolderMatchStats as FolderMatchStats } from './storage/folder_match_stats';
import { BookmarkWebview } from './webview/bookmark_webview';
import { StorageManager } from './interface/storage_manager';
import { StorageActionResult } from './storage/storage_action_result';
import { getAbsolutePath, getRelativePath } from "./tools/fs";

export class Main implements BookmarkDataProvider, BookmarkManager, ActiveGroupProvider, StorageManager {
    public ctx: ExtensionContext;
    private treeViewRefreshCallback = () => { };

    public readonly savedActiveGroupKey = "vscLabeledBookmarks.activeGroup";
    public readonly savedHideInactiveGroupsKey = "vscLabeledBookmarks.hideInactiveGroups";
    public readonly savedHideAllKey = "vscLabeledBookmarks.hideAll";
    public readonly savedPersistentStorageTypeKey = "persistentStorageType";
    public readonly savedPersistToFilePathKey = "persistToFilePath";

    public readonly configRoot = "labeledBookmarks";
    public readonly configKeyColors = "colors";
    public readonly configKeyUnicodeMarkers = "unicodeMarkers";
    public readonly configKeyDefaultShape = "defaultShape";
    public readonly configKeyOverviewRulerLane = "overviewRulerLane";
    public readonly configKeyLineEndLabelType = "lineEndLabelType";
    public readonly configKeyHomingMarginTop = "homingMarginTop";
    public readonly configKeyHomingMarginBottom = "homingMarginBottom";
    public readonly configKeyHomingSteps = "homingSteps";
    public readonly configKeySaveBookmarksInProject = "saveBookmarksInProject";
    public readonly configKeyPersistenceDelay = "persistenceDelay";
    public readonly configKeyPersistenceIntervalForWorkspaceState = "persistenceIntervalForWorkspaceState";
    public readonly configKeyPersistenceIntervalForFiles = "persistenceIntervalForFiles";

    private readonly storageActionOptions: Map<string, {
        label: string,
        description: string
        writeToTarget: boolean,
        writeToTargetSelectively: boolean,
        eraseCurrent: boolean,
        switchToTarget: boolean,
        loadFromTarget: boolean,
        loadFromTargetSelectively: boolean,
        transformFolderPaths: boolean,
        allowOutOfFolderFiles: boolean,
    }> = new Map([
        ["moveTo",
            {
                label: "move to another storage location",
                description: "and wipe the current location",
                writeToTarget: true,
                writeToTargetSelectively: false,
                eraseCurrent: true,
                switchToTarget: true,
                loadFromTarget: false,
                loadFromTargetSelectively: false,
                transformFolderPaths: false,
                allowOutOfFolderFiles: true
            }
        ],
        ["switchTo",
            {
                label: "switch to using another storage location",
                description: "and leave the current storage alone",
                writeToTarget: false,
                writeToTargetSelectively: false,
                eraseCurrent: false,
                switchToTarget: true,
                loadFromTarget: false,
                loadFromTargetSelectively: false,
                transformFolderPaths: false,
                allowOutOfFolderFiles: true
            }
        ],
        ["exportTo",
            {
                label: "export to another storage location",
                description: "selected bookmark groups",
                writeToTarget: true,
                writeToTargetSelectively: true,
                eraseCurrent: false,
                switchToTarget: false,
                loadFromTarget: false,
                loadFromTargetSelectively: false,
                transformFolderPaths: true,
                allowOutOfFolderFiles: false
            }
        ],
        ["importFrom",
            {
                label: "import from another storage location",
                description: "selected bookmark groups",
                writeToTarget: false,
                writeToTargetSelectively: false,
                eraseCurrent: false,
                switchToTarget: false,
                loadFromTarget: true,
                loadFromTargetSelectively: true,
                transformFolderPaths: true,
                allowOutOfFolderFiles: false
            }
        ]
    ]);

    public readonly persistentStorageTypeOptions = ["workspaceState", "file"];
    public readonly defaultPersistentStorageType = "workspaceState";

    public readonly defaultPersistToFilePath = "./.vscode/labeled_bookmarks.json";
    public persistentStorageType: string;
    public persistToFilePath: string;

    private persistentStorage: BookmarkDataStorage;
    private persistentStorageRateLimiter: RateLimiter;

    public readonly maxGroupNameLength = 40;

    public readonly defaultGroupName: string;

    public groups: Array<Group>;
    private bookmarks: Array<Bookmark>;
    private bookmarkTimestamp: number;

    public activeGroup: Group;
    public fallbackColor: string = "00ddddff";
    public fallbackColorName: string = "teal";

    public colors: Map<string, string>;
    public unicodeMarkers: Map<string, string>;
    public readonly shapes: Map<string, string>;
    public defaultShape = "bookmark";
    public homingMarginTop = 6;
    public homingMarginBottom = 30;
    public homingSteps = 0;
    public persistenceDelay = 500;
    public persistenceIntervalForWorkspaceState = 500;
    public persistenceIntervalForFiles = 1500;

    public hideInactiveGroups: boolean;
    public hideAll: boolean;

    private statusBarItem: StatusBarItem;

    private removedDecorations: Map<TextEditorDecorationType, boolean>;

    private tempDocumentBookmarks: Map<string, Array<Bookmark>>;
    private tempGroupBookmarks: Map<Group, Array<Bookmark>>;
    private tempDocumentDecorations: Map<string, Map<TextEditorDecorationType, Array<Range>>>;

    private decorationFactory: DecorationFactory;

    private webview: BookmarkWebview;

    constructor(ctx: ExtensionContext, treeviewRefreshCallback: () => void) {
        this.ctx = ctx;
        this.treeViewRefreshCallback = treeviewRefreshCallback;

        let gutterIconDirUri = vscode.Uri.joinPath(this.ctx.extensionUri, 'resources', 'gutter_icons');
        this.decorationFactory = new DecorationFactory(gutterIconDirUri, OverviewRulerLane.Center, "bordered");

        this.persistentStorage = new BookmarkStorageDummy();
        this.persistentStorageRateLimiter = new RateLimiter(() => { }, 500, 500);

        this.bookmarks = new Array<Bookmark>();
        this.groups = new Array<Group>();
        this.bookmarkTimestamp = 0;

        this.defaultGroupName = "default";
        this.activeGroup = new Group(this.defaultGroupName, this.fallbackColor, this.defaultShape, "", this.decorationFactory);

        this.colors = new Map<string, string>();
        this.unicodeMarkers = new Map<string, string>();
        this.shapes = new Map<string, string>([
            ["bookmark", "bookmark"],
            ["circle", "circle"],
            ["heart", "heart"],
            ["label", "label"],
            ["star", "star"],
            ["triangle", "triangle"],
            ["diamond", "diamond"],
            ["hexagon", "hexagon"],
            ["flag", "flag"],
            ["arrow", "arrow"],
            ["pentagon", "pentagon"],
            ["octagon", "octagon"], // octagon is a valid shape in the decoration
            ["plus", "plus"],
            ["checkmark","checkmark"],
            ["ring", "ring"],
            ["lightning", "lightning"], // lightning is a valid shape in the
            ["cloud", "cloud"], // cloud is a valid shape in the decoration
            ["light", "light"],
            ["pin", "pin"],
            ["zoom", "zoom"],
            ["share", "share"]
        ]);

        this.removedDecorations = new Map<TextEditorDecorationType, boolean>();

        this.tempDocumentBookmarks = new Map<string, Array<Bookmark>>();
        this.tempGroupBookmarks = new Map<Group, Array<Bookmark>>();
        this.tempDocumentDecorations = new Map<string, Map<TextEditorDecorationType, Array<Range>>>();

        this.persistentStorageType = this.defaultPersistentStorageType;
        this.persistToFilePath = this.defaultPersistToFilePath;

        this.readSettings();

        if (this.colors.size < 1) {
            this.colors.set(this.fallbackColorName, this.decorationFactory.normalizeColorFormatV2(this.fallbackColor));
        }

        this.hideInactiveGroups = false;
        this.hideAll = false;

        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
        this.statusBarItem.command = 'vsc-labeled-bookmarks.selectGroup';
        this.statusBarItem.show();

        // webview init
        let actionOptions: Map<string, string> = new Map();
        this.storageActionOptions.forEach((action, key) => {
            actionOptions.set(key, action.label);
        });

        let storageTypeOptions: Map<string, string> = new Map();
        storageTypeOptions.set("workspaceState", "workspace state");
        storageTypeOptions.set("file", "file");

        this.webview = new BookmarkWebview(
            this.ctx,
            this,
            this,
            actionOptions,
            storageTypeOptions,
            this.decorationFactory
        );
    }

    public async initPhase2() {
        this.loadLocalState();

        await this.executeStorageAction(
            "switchTo",
            this.persistentStorageType,
            (this.persistentStorageType === "file") ? this.persistToFilePath : "",
            []
        );
    }

    private async initBookmarkDataUsingStorage() {
        this.loadBookmarkData();

        let actualGroupToActivate = this.getExistingGroupNameOrDefault(this.activeGroup.name);
        this.activateGroup(actualGroupToActivate, this.activeGroup.name !== actualGroupToActivate);

        this.saveLocalState();

        this.updateStatusBar();
        this.updateDecorations();
    }

    public saveBookmarkData() {
        this.persistentStorageRateLimiter.fire();
    }

    public async saveBookmarkDataImmediately() {
        this.persistentStorage.setTimestamp(this.bookmarkTimestamp);

        let serializedGroups = this.groups.map(group => SerializableGroup.fromGroup(group));
        this.persistentStorage.setGroups(serializedGroups);

        let serializedBookmarks = this.bookmarks.map(bookmark => SerializableBookmark.fromBookmark(bookmark));
        this.persistentStorage.setBookmarks(serializedBookmarks);

        let folders = vscode.workspace.workspaceFolders ?? [];
        this.persistentStorage.setWorkspaceFolders(folders.map(f => f.uri.fsPath));

        await this.persistentStorage.persist();

        this.updateStatusBar();
    }

    public saveLocalState() {
        this.ctx.workspaceState.update(this.savedActiveGroupKey, this.activeGroup.name);
        this.ctx.workspaceState.update(this.savedHideInactiveGroupsKey, this.hideInactiveGroups);
        this.ctx.workspaceState.update(this.savedHideAllKey, this.hideAll);
        this.ctx.workspaceState.update(this.savedPersistentStorageTypeKey, this.persistentStorageType);
        // this.ctx.workspaceState.update(this.savedPersistToFilePathKey, this.persistToFilePath);

        this.updateStatusBar();
    }

    public handleDecorationRemoved(decoration: TextEditorDecorationType) {
        this.removedDecorations.set(decoration, true);
    }

    public handleGroupDecorationUpdated(group: Group) {
        this.tempDocumentDecorations.clear();
        this.tempGroupBookmarks.get(group)?.forEach(bookmark => {
            bookmark.initDecoration();
        });
        this.updateDecorations();
        this.treeViewRefreshCallback();
    }

    public handleGroupDecorationSwitched(group: Group) {
        this.tempDocumentDecorations.clear();
        this.tempGroupBookmarks.get(group)?.forEach(bookmark => {
            bookmark.switchDecoration();
        });
        this.updateDecorations();
        this.treeViewRefreshCallback();
    }

    public handleBookmarkDecorationUpdated(bookmark: Bookmark) {
        this.tempDocumentDecorations.delete(bookmark.fsPath);
        this.updateDecorations();
    }

    public getGroups(): Array<Group> {
        return this.groups;
    }

    public getBookmarks(): Array<Bookmark> {
        return this.bookmarks;
    }

    public getActiveGroup(): Group {
        return this.activeGroup;
    }

    public getTimestamp(): number {
        return this.bookmarkTimestamp;
    }

    private purgeAllDecorations() {
        this.bookmarks.map(b => b.getDecoration())
            .forEach(d => {
                if (d !== null) {
                    this.removedDecorations.set(d, true);
                }
            });

        this.groups.map(g => g.getActiveDecoration())
            .forEach(d => {
                if (d !== null) {
                    this.removedDecorations.set(d, true);
                }
            });
    }

    private updateDecorations() {
        for (let editor of vscode.window.visibleTextEditors) {
            this.updateEditorDecorations(editor);
        }

        this.removedDecorations.clear();
    }

    private getGroupByName(groupName: string): Group {
        for (let g of this.groups) {
            if (g.name === groupName) {
                return g;
            }
        }

        return this.activeGroup;
    }

    // render and add decorations in vscode editor like git message in right of code line   
    public updateEditorDecorations(textEditor: TextEditor | undefined) {
        if (typeof textEditor === "undefined") {
            return;
        }

        let relativeFsPath = getRelativePath(textEditor.document.uri.fsPath);
        let editorDecorations = this.getTempDocumentDecorationsList(relativeFsPath);

        for (let [removedDecoration, b] of this.removedDecorations) {
            if (editorDecorations.has(removedDecoration)) {
                continue;
            }

            editorDecorations.set(removedDecoration, []);
        }

        for (let [decoration, ranges] of editorDecorations) {
            textEditor.setDecorations(decoration, ranges);
        }
    }

    // insertions, deletions, or replacements
    public onEditorDocumentChanged(event: TextDocumentChangeEvent) {
        let relativePath =
            getRelativePath(event.document.uri.fsPath);
        let fileBookmarkList = this.getTempDocumentBookmarkList(relativePath);

        if (fileBookmarkList.length === 0) {
            return;
        }

        let bookmarksChanged = false;

        for (let change of event.contentChanges) {
            let newLineCount = this.getNlCount(change.text);

            let oldFirstLine = change.range.start.line;
            let oldLastLine = change.range.end.line;
            let oldLineCount = oldLastLine - oldFirstLine;

            if (newLineCount === oldLineCount) {
                let updateCount = this.updateBookmarkLineTextInRange(
                    event.document,
                    fileBookmarkList,
                    oldFirstLine,
                    oldLastLine
                );
                if (updateCount > 0) {
                    this.treeViewRefreshCallback();
                }
                continue;
            }


            if (newLineCount > oldLineCount) {
                let shiftDownBy = newLineCount - oldLineCount;
                let newLastLine = oldFirstLine + newLineCount;

                let firstLinePrefix = event.document.getText(
                    new Range(oldFirstLine, 0, oldFirstLine, change.range.start.character)
                );
                let isFirstLinePrefixEmpty = firstLinePrefix.trim() === "";

                let shiftDownFromLine = (isFirstLinePrefixEmpty ? oldFirstLine : oldFirstLine + 1);

                for (let bookmark of fileBookmarkList) {
                    if (bookmark.lineNumber >= shiftDownFromLine) {
                        bookmark.lineNumber += shiftDownBy;
                        bookmarksChanged = true;
                    }

                    if (bookmark.lineNumber >= oldFirstLine && bookmark.lineNumber <= newLastLine) {
                        this.updateBookmarkLineText(event.document, bookmark);
                        this.treeViewRefreshCallback();
                    }
                }
                continue;
            }


            if (newLineCount < oldLineCount) {
                let shiftUpBy = oldLineCount - newLineCount;
                let newLastLine = oldFirstLine + newLineCount;

                let firstLinePrefix = event.document.getText(
                    new Range(oldFirstLine, 0, oldFirstLine, change.range.start.character)
                );
                let isFirstLineBookkmarkDeletable = firstLinePrefix.trim() === "";

                if (!isFirstLineBookkmarkDeletable) {
                    let firstLineBookmark = fileBookmarkList.find(bookmark => bookmark.lineNumber === oldFirstLine);
                    if (typeof firstLineBookmark === "undefined") {
                        isFirstLineBookkmarkDeletable = true;
                    }
                }

                let deleteFromLine = (isFirstLineBookkmarkDeletable ? oldFirstLine : oldFirstLine + 1);
                let shiftFromLine = deleteFromLine + shiftUpBy;

                for (let bookmark of fileBookmarkList) {
                    if (bookmark.lineNumber < oldFirstLine) {
                        continue;
                    }

                    if (bookmark.lineNumber >= deleteFromLine && bookmark.lineNumber < shiftFromLine) {
                        this.deleteBookmark(bookmark);
                        bookmarksChanged = true;
                        continue;
                    }

                    if (bookmark.lineNumber >= shiftFromLine) {
                        bookmark.lineNumber -= shiftUpBy;
                        bookmarksChanged = true;
                    }

                    if (bookmark.lineNumber >= oldFirstLine && bookmark.lineNumber <= newLastLine) {
                        this.updateBookmarkLineText(event.document, bookmark);
                        this.treeViewRefreshCallback();
                    }
                }
                continue;
            }
        }

        if (bookmarksChanged) {
            this.tempDocumentDecorations.delete(relativePath);
            this.updateBookmarkTimestamp();
            this.saveBookmarkData();
            this.updateDecorations();
            this.treeViewRefreshCallback();
        }
    }

    private getTempDocumentBookmarkList(realtivePath: string): Array<Bookmark> {
        let list = this.tempDocumentBookmarks.get(realtivePath);

        if (typeof list !== "undefined") {
            return list;
        }

        list = this.bookmarks.filter((bookmark) => { return bookmark.fsPath === realtivePath; });
        this.tempDocumentBookmarks.set(realtivePath, list);

        return list;
    }

    private getTempGroupBookmarkList(group: Group): Array<Bookmark> {
        let list = this.tempGroupBookmarks.get(group);

        if (typeof list !== "undefined") {
            return list;
        }

        list = this.bookmarks.filter((bookmark) => { return bookmark.group === group; });
        this.tempGroupBookmarks.set(group, list);

        return list;
    }

    private getTempDocumentDecorationsList(fsPath: string): Map<TextEditorDecorationType, Array<Range>> {
        let editorDecorations = this.tempDocumentDecorations.get(fsPath);

        if (typeof editorDecorations !== "undefined") {
            return editorDecorations;
        }

        let lineDecorations = new Map<number, TextEditorDecorationType>();
        let fileBookmarks = this.bookmarks
            .filter((bookmark) => {
                return bookmark.fsPath === fsPath && bookmark.getDecoration !== null;
            });

        fileBookmarks.filter(bookmark => bookmark.group === this.activeGroup)
            .forEach(bookmark => {
                let decoration = bookmark.getDecoration();
                if (decoration !== null) {
                    lineDecorations.set(bookmark.lineNumber, decoration);
                }
            });

        fileBookmarks.filter(bookmark => bookmark.group !== this.activeGroup)
            .forEach((bookmark) => {
                let decoration = bookmark.getDecoration();
                if (decoration !== null) {
                    if (!lineDecorations.has(bookmark.lineNumber)) {
                        lineDecorations.set(bookmark.lineNumber, decoration);
                    } else {
                        this.handleDecorationRemoved(decoration);
                    }
                }
            });

        // pair the decoration with ranges
        editorDecorations = new Map<TextEditorDecorationType, Range[]>();
        for (let [lineNumber, decoration] of lineDecorations) {
            let ranges = editorDecorations.get(decoration);
            if (typeof ranges === "undefined") {
                ranges = new Array<Range>();
                editorDecorations.set(decoration, ranges);
            }

            ranges.push(new Range(lineNumber, 0, lineNumber, 0));
        }

        this.tempDocumentDecorations.set(fsPath, editorDecorations);

        return editorDecorations;
    }

    private resetTempLists() {
        this.tempDocumentBookmarks.clear();
        this.tempGroupBookmarks.clear();
        this.tempDocumentDecorations.clear();
    }

    private updateBookmarkLineTextInRange(
        document: TextDocument,
        bookmarks: Array<Bookmark>,
        firstLine: number,
        lastLine: number
    ): number {
        let updateCount = 0;
        bookmarks.filter(bookmark => {
            return bookmark.lineNumber >= firstLine && bookmark.lineNumber <= lastLine;
        }).forEach(bookmark => {
            this.updateBookmarkLineText(document, bookmark);
            updateCount++;
        });
        return updateCount;
    }

    private updateBookmarkLineText(document: TextDocument, bookmark: Bookmark) {
        let line = document.lineAt(bookmark.lineNumber);
        bookmark.characterNumber = Math.min(bookmark.characterNumber, line.range.end.character);
        bookmark.lineText = line.text.trim();
    }

    public actionDeleteOneBookmark(bookmark: Bookmark) {
        this.deleteBookmark(bookmark);
        this.updateBookmarkTimestamp();
        this.saveBookmarkData();
        this.updateDecorations();
        this.treeViewRefreshCallback();
    }

    public deleteBookmarksOfFile(fsPath: string, group: Group | null) {
        this.bookmarks
            .filter(b => (b.fsPath === fsPath && (group === null || group === b.group)))
            .forEach(b => this.deleteBookmark(b));
        this.updateBookmarkTimestamp();
        this.saveBookmarkData();
        this.updateDecorations();
        this.treeViewRefreshCallback();
    }

    private deleteBookmark(bookmark: Bookmark) {
        let index = this.bookmarks.indexOf(bookmark);
        if (index < 0) {
            return;
        }

        this.bookmarks.splice(index, 1);

        this.tempDocumentBookmarks.delete(bookmark.fsPath);
        this.tempDocumentDecorations.delete(bookmark.fsPath);
        this.tempGroupBookmarks.delete(bookmark.group);
        let bookmarkDecoration = bookmark.getDecoration();
        if (bookmarkDecoration !== null) {
            this.handleDecorationRemoved(bookmarkDecoration);
            this.handleDecorationRemoved(bookmark.group.decoration);
        }
    }

    public relabelBookmark(bookmark: Bookmark) {
        let defaultQuickInputText = bookmark.label ?? '';

        vscode.window.showInputBox({
            placeHolder: "new bookmark label",
            prompt: "Enter new bookmark label",
            value: defaultQuickInputText,
            valueSelection: [0, defaultQuickInputText.length],
        }).then((input: string | undefined) => {
            if (typeof input === "undefined") {
                return;
            }

            let newLabel: string | undefined = input.trim();

            if (newLabel === defaultQuickInputText) {
                return;
            }

            if (newLabel.length === 1) {
                let existingBookmark = this.getTempDocumentBookmarkList(bookmark.fsPath)
                    .find((bm) => {
                        return bm.group === bookmark.group
                            && typeof bm.label !== "undefined"
                            && bm.label === newLabel;
                    });

                if (typeof existingBookmark !== "undefined") {
                    this.deleteBookmark(existingBookmark);
                }
            }

            if (newLabel.length === 0) {
                newLabel = undefined;
            }

            let newBookmark = new Bookmark(
                bookmark.fsPath,
                bookmark.lineNumber,
                bookmark.characterNumber,
                newLabel,
                bookmark.lineText,
                bookmark.group,
                this.decorationFactory
            );

            this.deleteBookmark(bookmark);

            this.addNewDecoratedBookmark(newBookmark);
            this.bookmarks.sort(Bookmark.sortByLocation);

            this.tempDocumentDecorations.delete(bookmark.fsPath);
            this.tempDocumentBookmarks.delete(bookmark.fsPath);
            this.tempGroupBookmarks.delete(this.activeGroup);
            this.updateBookmarkTimestamp();
            this.saveBookmarkData();
            this.updateDecorations();
            this.treeViewRefreshCallback();
        });
    }

    public renameGroup(group: Group) {
        let defaultQuickInputText = group.name;

        vscode.window.showInputBox({
            placeHolder: "new group name",
            prompt: "Enter new group name",
            value: defaultQuickInputText,
            valueSelection: [0, defaultQuickInputText.length],
        }).then((input: string | undefined) => {
            if (typeof input === "undefined") {
                return;
            }

            let newName = input.trim();

            if (newName.length === 0) {
                return;
            }

            if (newName === defaultQuickInputText) {
                return;
            }

            if (newName.length > this.maxGroupNameLength) {
                vscode.window.showErrorMessage(
                    "Choose a maximum " +
                    this.maxGroupNameLength +
                    " character long group name."
                );
                return;
            }

            if (typeof this.groups.find(g => {
                return g !== group && g.name === newName;
            }) !== "undefined") {
                vscode.window.showErrorMessage("The entered bookmark group name is already in use");
                return;
            }

            group.name = newName;

            this.updateBookmarkTimestamp();
            this.saveBookmarkData();

            if (group === this.activeGroup) {
                this.saveLocalState();
            }

            this.treeViewRefreshCallback();
            this.updateStatusBar();
        });
    }

    public editorActionRunDevAction(textEditor: TextEditor) {
        let bm = new SerializableBookmark(
            "path",
            1,
            2,
            "label",
            "line text",
            "default"
        );

        let bm2 = SerializableBookmark.copyOne(bm);

        let bmList = [bm, bm2];
        let bmList2 = SerializableBookmark.copyList(bmList);

        vscode.window.showInformationMessage(JSON.stringify(bmList2));

        let g = new SerializableGroup(
            "name",
            "color",
            "shape",
            "icon text"
        );

        let g2 = SerializableGroup.copyOne(g);

        let gList = [g, g2];
        let gList2 = SerializableGroup.copyList(gList);

        vscode.window.showInformationMessage(JSON.stringify(gList2));
    }

    public editorActionToggleBookmark(textEditor: TextEditor) {
        if (textEditor.selections.length === 0) {
            return;
        }

        let documentRelativeFsPath = getRelativePath(textEditor.document.uri.fsPath);
        for (let selection of textEditor.selections) {
            let lineNumber = selection.start.line;
            let characterNumber = selection.start.character;
            let lineText = textEditor.document.lineAt(lineNumber).text.trim();
            this.toggleBookmark(
                documentRelativeFsPath,
                lineNumber,
                characterNumber,
                lineText,
                this.activeGroup
            );
        }

        this.updateDecorations();
        this.treeViewRefreshCallback();
    }

    private toggleBookmark(
        relativeFsPath: string,
        lineNumber: number,
        characterNumber: number,
        lineText: string,
        group: Group
    ) {
        let existingBookmark = this.getTempDocumentBookmarkList(relativeFsPath)
            .find((bookmark) => { return bookmark.lineNumber === lineNumber && bookmark.group === group; });

        if (typeof existingBookmark !== "undefined") {
            this.deleteBookmark(existingBookmark);
            this.updateBookmarkTimestamp();
            this.saveBookmarkData();
            return;
        }

        let bookmark = new Bookmark(relativeFsPath,
            lineNumber,
            characterNumber,
            undefined,
            lineText,
            group,
            this.decorationFactory
        );
        this.bookmarks.push(bookmark);
        this.bookmarks.sort(Bookmark.sortByLocation);

        this.tempDocumentBookmarks.delete(relativeFsPath);
        this.tempDocumentDecorations.delete(relativeFsPath);
        this.tempGroupBookmarks.delete(group);

        this.updateBookmarkTimestamp();
        this.saveBookmarkData();
    }

    public editorActionToggleLabeledBookmark(textEditor: TextEditor) {
        if (textEditor.selections.length === 0) {
            return;
        }

        let relativeFspath = getRelativePath(textEditor.document.uri.fsPath);
        let lineNumber = textEditor.selection.start.line;

        let existingBookmark = this.getTempDocumentBookmarkList(relativeFspath)
            .find((bookmark) => { return bookmark.lineNumber === lineNumber && bookmark.group === this.activeGroup; });

        if (typeof existingBookmark !== "undefined") {
            this.deleteBookmark(existingBookmark);
            this.updateBookmarkTimestamp();
            this.saveBookmarkData();
            this.updateDecorations();
            this.treeViewRefreshCallback();
            return;
        }

        let selectedText = textEditor.document.getText(textEditor.selection).trim();
        let firstNlPos = selectedText.indexOf("\n");
        if (firstNlPos >= 0) {
            selectedText = selectedText.substring(0, firstNlPos).trim();
        }
        selectedText = selectedText.replace(/[\s\t\r\n]+/g, " ").replace("/@/g", "@\u200b");

        vscode.window.showInputBox({
            placeHolder: "label or label@@group or @@group",
            prompt: "Enter label and/or group to be created",
            value: selectedText,
            valueSelection: [0, selectedText.length],
        }).then((input: string | undefined) => {
            if (typeof input === "undefined") {
                return;
            }

            input = input.trim();
            if (input === "") {
                return;
            }

            let label = "";
            let groupName = "";

            let separatorPos = input.indexOf('@@');
            if (separatorPos >= 0) {
                label = input.substring(0, separatorPos).trim();
                groupName = input.substring(separatorPos + 2).trim();
            } else {
                label = input.replace(/@\u200b/g, "@");
            }

            if (label === "" && groupName === "") {
                return;
            }

            if (groupName.length > this.maxGroupNameLength) {
                vscode.window.showErrorMessage(
                    "Choose a maximum " +
                    this.maxGroupNameLength +
                    " character long group name."
                );
                return;
            }

            if (groupName !== "") {
                this.activateGroup(groupName);
            }

            if (label.length === 1) {

                this.getTempGroupBookmarkList(this.activeGroup)
                    .filter((bookmark) => {
                        return typeof bookmark.label !== "undefined"
                            && bookmark.label === label;
                    }).forEach((bookmark) => {
                        this.deleteBookmark(bookmark);
                    });
            }


            if (label !== "") {
                let characterNumber = textEditor.selection.start.character;
                let lineText = textEditor.document.lineAt(lineNumber).text.trim();

                let bookmark = new Bookmark(
                    relativeFspath,
                    lineNumber,
                    characterNumber,
                    label,
                    lineText,
                    this.activeGroup,
                    this.decorationFactory
                );
                this.addNewDecoratedBookmark(bookmark);
                this.bookmarks.sort(Bookmark.sortByLocation);
            }

            this.tempDocumentDecorations.delete(relativeFspath);
            this.tempDocumentBookmarks.delete(relativeFspath);
            this.tempGroupBookmarks.delete(this.activeGroup);
            this.updateBookmarkTimestamp();
            this.saveBookmarkData();
            this.updateDecorations();
            this.treeViewRefreshCallback();
        });
    }

    public editorActionnavigateToNextBookmark(textEditor: TextEditor) {
        if (textEditor.selections.length === 0) {
            return;
        }

        let documentFsPath = textEditor.document.uri.fsPath;
        let lineNumber = textEditor.selection.start.line;

        let nextBookmark = this.nextBookmark(documentFsPath, lineNumber);
        if (typeof nextBookmark === "undefined") {
            return;
        }

        this.jumpToBookmark(nextBookmark);
    }

    public nextBookmark(fsPath: string, line: number): Bookmark | undefined {
        let brokenBookmarkCount = 0;

        let groupBookmarkList = this.getTempGroupBookmarkList(this.activeGroup);

        let firstCandidate = groupBookmarkList.find((bookmark, i) => {
            if (bookmark.failedJump) {
                brokenBookmarkCount++;
                return false;
            }

            let fileComparisonResult = bookmark.fsPath.localeCompare(fsPath);

            if (fileComparisonResult < 0) {
                return false;
            }
            if (fileComparisonResult > 0) {
                return true;
            }

            return line < bookmark.lineNumber;
        });

        if (typeof firstCandidate === "undefined" && groupBookmarkList.length > 0) {
            if (groupBookmarkList.length > brokenBookmarkCount) {
                for (let bookmark of groupBookmarkList) {
                    if (!bookmark.failedJump) {
                        return bookmark;
                    }
                }
            }
            vscode.window.showWarningMessage("All bookmarks are broken, time for some cleanup");
        }

        return firstCandidate;
    }

    public editorActionNavigateToPreviousBookmark(textEditor: TextEditor) {
        if (textEditor.selections.length === 0) {
            return;
        }

        let documentFsPath = textEditor.document.uri.fsPath;
        let lineNumber = textEditor.selection.start.line;

        let previousBookmark = this.previousBookmark(documentFsPath, lineNumber);
        if (typeof previousBookmark === "undefined") {
            return;
        }

        this.jumpToBookmark(previousBookmark);
    }

    public previousBookmark(fsPath: string, line: number): Bookmark | undefined {
        let brokenBookmarkCount = 0;

        let groupBookmarkList = this.getTempGroupBookmarkList(this.activeGroup);

        let firstCandidate: Bookmark | undefined;

        for (let i = groupBookmarkList.length - 1; i >= 0; i--) {
            let bookmark = groupBookmarkList[i];

            if (bookmark.failedJump) {
                brokenBookmarkCount++;
                continue;
            }

            let fileComparisonResult = bookmark.fsPath.localeCompare(fsPath);
            if (fileComparisonResult > 0) {
                continue;
            }

            if (fileComparisonResult < 0) {
                firstCandidate = bookmark;
                break;
            }

            if (bookmark.lineNumber < line) {
                firstCandidate = bookmark;
                break;
            }
        }

        if (typeof firstCandidate === "undefined" && groupBookmarkList.length > 0) {
            if (groupBookmarkList.length > brokenBookmarkCount) {
                for (let i = groupBookmarkList.length - 1; i >= 0; i--) {
                    if (!groupBookmarkList[i].failedJump) {
                        return groupBookmarkList[i];
                    }
                }
            }
            vscode.window.showWarningMessage("All bookmarks are broken, time for some cleanup");
        }

        return firstCandidate;
    }

    public actionExpandSelectionToNextBookmark(editor: TextEditor) {
        let bookmarks = this.getTempDocumentBookmarkList(getRelativePath(editor.document.uri.fsPath));
        if (typeof bookmarks === "undefined") {
            return;
        }

        let selection = editor.selection;

        let endLineRange = editor.document.lineAt(selection.end.line).range;
        let selectionEndsAtLineEnd = selection.end.character >= endLineRange.end.character;

        let searchFromLine = selection.end.line;
        if (selectionEndsAtLineEnd) {
            searchFromLine++;
        }

        let nextBookmark = bookmarks.find(
            bookmark => {
                return bookmark.group === this.activeGroup && bookmark.lineNumber >= searchFromLine;
            }
        );

        if (typeof nextBookmark === "undefined") {
            return;
        }

        let newSelectionEndCharacter: number;
        if (nextBookmark.lineNumber === selection.end.line) {
            newSelectionEndCharacter = endLineRange.end.character;
        } else {
            newSelectionEndCharacter = 0;
        }

        editor.selection = new Selection(
            selection.start.line,
            selection.start.character,
            nextBookmark.lineNumber,
            newSelectionEndCharacter
        );

        editor.revealRange(new Range(
            nextBookmark.lineNumber,
            newSelectionEndCharacter,
            nextBookmark.lineNumber,
            newSelectionEndCharacter
        ));
    }

    public actionExpandSelectionToPreviousBookmark(editor: TextEditor) {
        let bookmarks = this.getTempDocumentBookmarkList(getRelativePath(editor.document.uri.fsPath));
        if (typeof bookmarks === "undefined") {
            return;
        }

        let selection = editor.selection;

        let startLineRange = editor.document.lineAt(selection.start.line).range;
        let selectionStartsAtLineStart = selection.start.character === 0;

        let searchFromLine = selection.start.line;
        if (selectionStartsAtLineStart) {
            searchFromLine--;
        }

        let nextBookmark: Bookmark | undefined;
        for (let i = bookmarks.length - 1; i >= 0; i--) {
            if (bookmarks[i].group === this.activeGroup && bookmarks[i].lineNumber <= searchFromLine) {
                nextBookmark = bookmarks[i];
                break;
            }
        }

        if (typeof nextBookmark === "undefined") {
            return;
        }

        let newSelectionStartCharacter: number;
        if (nextBookmark.lineNumber === selection.start.line) {
            newSelectionStartCharacter = 0;
        } else {
            newSelectionStartCharacter = editor.document.lineAt(nextBookmark.lineNumber).range.end.character;
        }

        editor.selection = new Selection(
            nextBookmark.lineNumber,
            newSelectionStartCharacter,
            selection.end.line,
            selection.end.character
        );

        editor.revealRange(new Range(
            nextBookmark.lineNumber,
            newSelectionStartCharacter,
            nextBookmark.lineNumber,
            newSelectionStartCharacter
        ));
    }

    public actionNavigateToBookmark() {
        this.navigateBookmarkList(
            "navigate to bookmark",
            this.getTempGroupBookmarkList(this.activeGroup),
            false
        );
    }


    public actionNavigateToBookmarkOfAnyGroup() {
        this.navigateBookmarkList(
            "navigate to bookmark of any bookmark group",
            this.bookmarks,
            true
        );
    }

    private navigateBookmarkList(placeholderText: string, bookmarks: Array<Bookmark>, withGroupNames: boolean) {
        let currentEditor = vscode.window.activeTextEditor;
        let currentDocument: TextDocument;
        let currentSelection: Selection;
        if (typeof currentEditor !== "undefined") {
            currentSelection = currentEditor.selection;
            currentDocument = currentEditor.document;
        }
        let didNavigateBeforeClosing = false;

        let pickItems = bookmarks.map(
            bookmark => BookmarkPickItem.fromBookmark(bookmark, withGroupNames)
        );

        vscode.window.showQuickPick(
            pickItems,
            {
                canPickMany: false,
                matchOnDescription: true,
                placeHolder: placeholderText,
                ignoreFocusOut: true,
                onDidSelectItem: (selected: BookmarkPickItem) => {
                    didNavigateBeforeClosing = true;
                    this.jumpToBookmark(selected.bookmark, true);
                }
            }
        ).then((selected: BookmarkPickItem | undefined) => {
            if (typeof selected !== "undefined") {
                this.jumpToBookmark(selected.bookmark);
                return;
            }

            if (!didNavigateBeforeClosing) {
                return;
            }

            if (
                typeof currentDocument === "undefined"
                || typeof currentSelection === "undefined"
                || currentDocument === null
                || currentSelection === null) {
                return;
            }

            vscode.window.showTextDocument(currentDocument, { preview: false }).then(
                textEditor => {
                    try {
                        textEditor.selection = currentSelection;
                        textEditor.revealRange(new Range(currentSelection.start, currentSelection.end));
                    } catch (e) {
                        vscode.window.showWarningMessage("Failed to navigate to origin (1): " + e);
                        return;
                    }
                },
                rejectReason => {
                    vscode.window.showWarningMessage("Failed to navigate to origin (4): " + rejectReason.message);
                }
            );
        });
    }

    public actionSetGroupIconShape() {
        let iconText = this.activeGroup.iconText;

        let shapePickItems = new Array<ShapePickItem | QuickPickSeparator>();

        shapePickItems.push(new QuickPickSeparator("vector"));
        for (let [label, id] of this.shapes) {
            label = (this.activeGroup.shape === id ? "● " : "◌ ") + label;
            shapePickItems.push(new ShapePickItem(id, iconText, label, "", ""));
        }

        shapePickItems.push(new QuickPickSeparator("unicode"));
        for (let [name, marker] of this.unicodeMarkers) {
            let label = (this.activeGroup.shape === "unicode" && this.activeGroup.iconText === marker ? "● " : "◌ ");
            label += marker + " " + name;
            shapePickItems.push(new ShapePickItem("unicode", marker, label, "", ""));
        }

        vscode.window.showQuickPick(
            shapePickItems,
            {
                canPickMany: false,
                matchOnDescription: false,
                placeHolder: "select bookmark group icon shape"
            }
        ).then((selected: ShapePickItem | QuickPickSeparator | undefined) => {
            if (typeof selected !== "undefined" && selected.kind === vscode.QuickPickItemKind.Default) {
                let shape = (selected as ShapePickItem).shape;
                let iconText = (selected as ShapePickItem).iconText;
                this.activeGroup.setShapeAndIconText(shape, iconText);
                this.updateBookmarkTimestamp();
                this.saveBookmarkData();
            }
        });
    }

    public actionSetCustomIconText() {
        let unicodeChar = this.activeGroup.iconText;
        let shape = this.activeGroup.shape;

        vscode.window.showInputBox({
            placeHolder: "character for bookmark icon",
            prompt: "Enter character for bookmark icon",
            value: unicodeChar,
        }).then((input: string | undefined) => {
            if (typeof input === "undefined" || input.trim() === "") {
                return;
            }

            unicodeChar = input.trim();
            this.activeGroup.setShapeAndIconText(shape, unicodeChar);
            this.updateBookmarkTimestamp();
            this.saveBookmarkData();
        });
    }

    public actionSetGroupIconColor() {
        let colorPickItems = new Array<ColorPickItem>();
        for (let [name, color] of this.colors) {
            // use filled circle to mark chosen color name
            let label = (this.activeGroup.color === color ? "● " : "◌ ") + name;

            colorPickItems.push(new ColorPickItem(color, label, "", ""));
        }

        vscode.window.showQuickPick(
            colorPickItems,
            {
                canPickMany: false,
                matchOnDescription: false,
                placeHolder: "select bookmark group icon color"
            }
        ).then((selected: ColorPickItem | undefined) => {
            if (typeof selected !== "undefined") {
                let color = (selected as ColorPickItem).color;
                this.activeGroup.setColor(color);
                this.updateBookmarkTimestamp();
                this.saveBookmarkData();
            }
        });
    }

    public actionSelectGroup() {
        let pickItems = this.groups.map(
            group => GroupPickItem.fromGroup(group, this.getTempGroupBookmarkList(group).length)
        );

        vscode.window.showQuickPick(
            pickItems,
            {
                canPickMany: false,
                matchOnDescription: false,
                placeHolder: "select bookmark group"
            }
        ).then((selected: GroupPickItem | undefined) => {
            if (typeof selected !== "undefined") {
                this.setActiveGroup((selected as GroupPickItem).group.name);
            }
        });
    }

    public setActiveGroup(groupName: string) {
        this.activateGroup(groupName);
        this.updateDecorations();
        this.saveBookmarkData();
    }

    public actionAddGroup() {
        vscode.window.showInputBox({
            placeHolder: "group name",
            prompt: "Enter group name to create or switch to"
        }).then((groupName: string | undefined) => {
            if (typeof groupName === "undefined") {
                return;
            }

            groupName = groupName.trim();
            if (groupName === "") {
                return;
            }

            if (groupName.length > this.maxGroupNameLength) {
                vscode.window.showErrorMessage(
                    "Choose a maximum " +
                    this.maxGroupNameLength +
                    " character long group name."
                );
                return;
            }

            this.activateGroup(groupName);
            this.updateDecorations();
            this.updateBookmarkTimestamp();
            this.saveBookmarkData();
            this.treeViewRefreshCallback();
        });
    }

    public actionDeleteGroup() {
        let pickItems = this.groups.map(
            group => GroupPickItem.fromGroup(group, this.getTempGroupBookmarkList(group).length)
        );

        vscode.window.showQuickPick(
            pickItems,
            {
                canPickMany: true,
                matchOnDescription: false,
                placeHolder: "select bookmark groups to be deleted"
            }
        ).then((selecteds: GroupPickItem[] | undefined) => {
            if (typeof selecteds !== "undefined") {
                this.deleteGroups(selecteds.map(pickItem => pickItem.group));
            }
        });
    }

    public actionDeleteOneGroup(group: Group) {
        this.deleteGroups([group]);
    }

    private deleteGroups(groups: Array<Group>) {
        let wasActiveGroupDeleted = false;

        for (let group of groups) {
            wasActiveGroupDeleted ||= (group === this.activeGroup);

            this.getTempGroupBookmarkList(group).forEach(bookmark => {
                this.deleteBookmark(bookmark);
            });

            let index = this.groups.indexOf(group);
            if (index >= 0) {
                this.groups.splice(index, 1);
            }

            group.removeDecorations();
            this.tempGroupBookmarks.delete(group);
        }

        if (this.groups.length === 0) {
            this.activateGroup(this.defaultGroupName);
        } else if (wasActiveGroupDeleted) {
            this.activateGroup(this.groups[0].name);
        }

        this.updateDecorations();
        this.updateBookmarkTimestamp();
        this.saveBookmarkData();
        this.treeViewRefreshCallback();
    }

    public actionDeleteBookmark() {
        let currentEditor = vscode.window.activeTextEditor;
        let currentDocument: TextDocument;
        let currentSelection: Selection;
        if (typeof currentEditor !== "undefined") {
            currentSelection = currentEditor.selection;
            currentDocument = currentEditor.document;
        }
        let didNavigateBeforeClosing = false;

        let pickItems = this.getTempGroupBookmarkList(this.activeGroup).map(
            bookmark => BookmarkPickItem.fromBookmark(bookmark, false)
        );

        vscode.window.showQuickPick(
            pickItems,
            {
                canPickMany: true,
                matchOnDescription: false,
                placeHolder: "select bookmarks to be deleted",
                ignoreFocusOut: true,
                onDidSelectItem: (selected: BookmarkPickItem) => {
                    didNavigateBeforeClosing = true;
                    this.jumpToBookmark(selected.bookmark, true);
                }
            }
        ).then((selecteds: BookmarkPickItem[] | undefined) => {
            if (typeof selecteds !== "undefined") {
                for (let selected of selecteds) {
                    this.deleteBookmark(selected.bookmark);
                }

                this.updateDecorations();
                this.updateBookmarkTimestamp();
                this.saveBookmarkData();
                this.treeViewRefreshCallback();
            }

            if (!didNavigateBeforeClosing) {
                return;
            }

            if (
                typeof currentDocument === "undefined"
                || typeof currentSelection === "undefined"
                || currentDocument === null
                || currentSelection === null) {
                return;
            }

            vscode.window.showTextDocument(currentDocument, { preview: false }).then(
                textEditor => {
                    try {
                        textEditor.selection = currentSelection;
                        textEditor.revealRange(new Range(currentSelection.start, currentSelection.end));
                    } catch (e) {
                        vscode.window.showWarningMessage("Failed to navigate to origin (1): " + e);
                        return;
                    }
                },
                (rejectReason: any) => {
                    vscode.window.showWarningMessage("Failed to navigate to origin (2): " + rejectReason.message);
                }
            );
        });
    }

    public actionToggleHideAll() {
        this.setHideAll(!this.hideAll);
        this.updateDecorations();
        this.saveLocalState();
    }

    public actionToggleHideInactiveGroups() {
        this.setHideInactiveGroups(!this.hideInactiveGroups);
        this.updateDecorations();
        this.saveLocalState();
    }

    public actionClearFailedJumpFlags() {
        let clearedFlagCount = 0;

        for (let bookmark of this.bookmarks) {
            if (bookmark.failedJump) {
                bookmark.failedJump = false;
                clearedFlagCount++;
            }
        }

        vscode.window.showInformationMessage("Cleared broken bookmark flags: " + clearedFlagCount);
        this.saveBookmarkData();
    }

    public actionMoveBookmarksFromActiveGroup() {
        let pickItems = this.groups.filter(
            g => g !== this.activeGroup
        ).map(
            group => GroupPickItem.fromGroup(group, this.getTempGroupBookmarkList(group).length)
        );

        if (pickItems.length === 0) {
            vscode.window.showWarningMessage("There is no other group to move bookmarks into");
            return;
        }

        vscode.window.showQuickPick(
            pickItems,
            {
                canPickMany: false,
                matchOnDescription: false,
                placeHolder: "select destination group to move bookmarks into"
            }
        ).then(selected => {
            if (typeof selected !== "undefined") {
                this.moveBookmarksBetween(this.activeGroup, selected.group);
            }
        });
    }
    
    public actionshowStorageActionPanel() {
        this.webview.reveal();
    }

    public async executeStorageAction(
        action: string,
        targetType: string,
        target: string,
        selectedGroups: string[],
        pathMapping: Map<string, string> = new Map()
    ): Promise<StorageActionResult> {
        let successResult = StorageActionResult.simpleSuccess();

        let normalizedPathMapping: Map<string, string> = new Map();
        pathMapping.forEach((value, key) => {
            let normalizedKey = key.replace(/\\/g, "/");
            if (!normalizedKey.endsWith("/")) {
                normalizedKey += "/";
            }
            let normalizedValue = value.replace(/\\/g, "/");
            if (!normalizedValue.endsWith("/")) {
                normalizedValue += "/";
            }
            normalizedPathMapping.set(normalizedKey, normalizedValue);
        });
        pathMapping = normalizedPathMapping;

        let actionParameters = this.storageActionOptions.get(action);
        if (typeof actionParameters === "undefined") {
            return StorageActionResult.simpleError("unknown bookmark storage action: " + action);
        }

        let targetStorage: BookmarkDataStorage;
        if (targetType === "file") {
            let pesistFile = getAbsolutePath(target);
            targetStorage = new BookmarkStorageInFile(Uri.file(pesistFile));
        } else if (targetType === "workspaceState") {
            targetStorage = new BookmarkStorageInWorkspaceState(this.ctx.workspaceState, target);
        } else {
            return StorageActionResult.simpleError("unknown bookmark storage target type: " + targetType);
        }

        if (
            targetStorage.getStorageType() === this.persistentStorage.getStorageType()
            && targetStorage.getStoragePath() === this.persistentStorage.getStoragePath()
        ) {
            return StorageActionResult.simpleError(
                "The selected storage is the current one. Aborting " + actionParameters.label + "."
            );
        }

        if (actionParameters.writeToTarget) {
            if (this.persistentStorage.getStorageType() !== "dummy") {
                await this.persistentStorage.persist();
            }

            let tempWorkspaceFolders = this.persistentStorage.getWorkspaceFolders().map((f) => f);
            let tempBookmarks = SerializableBookmark.copyList(this.persistentStorage.getBookmarks());
            let tempGroups = SerializableGroup.copyList(this.persistentStorage.getGroups());

            if (!actionParameters.allowOutOfFolderFiles) {
                // let skippedFilePaths: Map<string, boolean> = new Map();
                // tempBookmarks = tempBookmarks.filter((bm) => {
                //     for (let f of tempWorkspaceFolders) {
                //         if (bm.fsPath.startsWith(f)) {
                //             return true;
                //         }
                //     };
                //     skippedFilePaths.set(bm.fsPath, true);
                //     return false;
                // });

                // skippedFilePaths.forEach((_value, key) => {
                //     successResult.warnings.push("File outside of workspace folder was skipped: " + key);
                // });
            }

            if (actionParameters.transformFolderPaths) {
                //let simpleFolderName = '@FOLDER';
                tempWorkspaceFolders.sort((a, b) => { return b.length - a.length; });
                tempBookmarks.forEach((bm) => {
                    tempWorkspaceFolders.forEach((f, fi) => {
                        if (bm.fsPath.startsWith(f)) {
                            bm.fsPath = bm.fsPath.substring(f.length + 1);
                            return;
                        }
                    });
                });

                //tempWorkspaceFolders = tempWorkspaceFolders.map((_f, fi) => { return simpleFolderName + (fi + 1); });
            }

            if (actionParameters.writeToTargetSelectively) {
                tempGroups = tempGroups
                    .filter(g => selectedGroups.includes(g.name));
                targetStorage.setGroups(tempGroups);

                tempBookmarks = tempBookmarks
                    .filter(b => selectedGroups.includes(b.groupName));
                targetStorage.setBookmarks(tempBookmarks);
            } else {
                targetStorage.setBookmarks(tempBookmarks);
                targetStorage.setGroups(tempGroups);
            }
            targetStorage.setWorkspaceFolders(tempWorkspaceFolders);
            targetStorage.setTimestamp(this.persistentStorage.getTimestamp());
            await targetStorage.persist();
        }

        let originalStorage = this.persistentStorage;

        if (actionParameters.switchToTarget) {
            await targetStorage.readStorage();
            this.purgeAllDecorations();
            this.persistentStorage = targetStorage;
            this.setStorageRateLimiter();
        }

        if (actionParameters.eraseCurrent) {
            originalStorage.setBookmarks([]);
            originalStorage.setGroups([]);
            originalStorage.setWorkspaceFolders([]);
            originalStorage.setTimestamp(0);

            await originalStorage.persist();
        }

        if (actionParameters.loadFromTarget) { //import only
            await targetStorage.readStorage();

            let filteredBookmarks = targetStorage.getBookmarks()
                .filter(bm => { return selectedGroups.includes(bm.groupName); });

            let mappedBookmarks: SerializableBookmark[] = [];

            if (actionParameters.transformFolderPaths) {
                let bookmarkedFiles: Map<string, string> = new Map();
                filteredBookmarks.forEach((bm) => {
                    let normalizedPath = bm.fsPath.replace(/\\/g, "/");
                    bookmarkedFiles.set(normalizedPath, normalizedPath);
                });

                try {
                    filteredBookmarks.forEach(bm => {
                        let bookmarkLabel = bm.label ? `"${bm.label}"` : "without label";
                        let origPath = bm.fsPath.replace(/\\/g, "/");
                        let newPath = bookmarkedFiles.get(origPath);
                        // if (typeof newPath === "undefined") {
                        //     successResult.warnings.push(`skipped bookmark ${bookmarkLabel} for line ${bm.lineNumber} of ${origPath}`);
                        //     return;
                        // }

                        // bm.fsPath = this.getRealPath(newPath??'');
                        mappedBookmarks.push(bm);
                        successResult.infos.push(`imported bookmark ${bookmarkLabel} for line ${bm.lineNumber} of ${origPath}`);
                    });
                } catch (e) {
                    return StorageActionResult.simpleError('Bookmark data import aborted: ' + e);
                }

                targetStorage.setBookmarks(mappedBookmarks);
            }

            let currentGroups = this.persistentStorage.getGroups();
            let incomingGroups = targetStorage.getGroups();

            targetStorage.getBookmarks().forEach(bm => {
                if (currentGroups.find(g => g.name === bm.groupName)) {
                    return;
                }
                let missingGroup = incomingGroups.find(g => g.name === bm.groupName);
                if (typeof missingGroup === "undefined") {
                    return StorageActionResult.simpleError('Failed to copy group info: ' + bm.groupName);
                }
                currentGroups.push(missingGroup);
            });
            this.persistentStorage.setGroups(currentGroups);
            this.persistentStorage.setBookmarks([...this.persistentStorage.getBookmarks(), ...targetStorage.getBookmarks()]);
            this.saveBookmarkData();
            this.purgeAllDecorations();
        }

        if (actionParameters.switchToTarget || actionParameters.loadFromTarget) {
            await this.initBookmarkDataUsingStorage();
        }

        return successResult;
    }

    public getActiveStorage(): BookmarkDataStorage {
        return this.persistentStorage;
    }

    private moveBookmarksBetween(src: Group, dst: Group) {
        let pickItems = this.getTempGroupBookmarkList(src).map(
            bookmark => BookmarkPickItem.fromBookmark(bookmark, false)
        );

        vscode.window.showQuickPick(
            pickItems,
            {
                canPickMany: true,
                matchOnDescription: false,
                placeHolder: "move bookmarks from " + src.name + " into " + dst.name,
                ignoreFocusOut: true,
            }
        ).then(selecteds => {
            if (typeof selecteds !== "undefined") {
                for (let selected of selecteds) {
                    let oldBookmark = selected.bookmark;

                    this.deleteBookmark(oldBookmark);

                    let newBookmark = new Bookmark(
                        oldBookmark.fsPath,
                        oldBookmark.lineNumber,
                        oldBookmark.characterNumber,
                        oldBookmark.label,
                        oldBookmark.lineText,
                        dst,
                        this.decorationFactory
                    );

                    this.addNewDecoratedBookmark(newBookmark);

                    this.tempDocumentDecorations.delete(newBookmark.fsPath);
                    this.tempDocumentBookmarks.delete(newBookmark.fsPath);
                    this.tempGroupBookmarks.delete(newBookmark.group);
                }

                this.bookmarks.sort(Bookmark.sortByLocation);

                this.updateBookmarkTimestamp();
                this.saveBookmarkData();
                this.updateDecorations();
                this.treeViewRefreshCallback();
            }
        });
    }

    public readSettings() {
        let defaultDefaultShape = "bookmark";

        let config = vscode.workspace.getConfiguration(this.configRoot);

        if (config.has(this.configKeyColors)) {
            try {
                let configColors = (config.get(this.configKeyColors) as Array<Array<string>>);
                this.colors = new Map<string, string>();
                for (let [index, value] of configColors) {
                    this.colors.set(index, this.decorationFactory.normalizeColorFormatV2(value));
                }
            } catch (e) {
                vscode.window.showWarningMessage("Error reading bookmark color setting");
            }
        }

        if (config.has(this.configKeyUnicodeMarkers)) {
            try {
                let configMarkers = (config.get(this.configKeyUnicodeMarkers) as Array<Array<string>>);
                this.unicodeMarkers = new Map<string, string>();
                for (let [index, value] of configMarkers) {
                    this.unicodeMarkers.set(index, value);
                }
            } catch (e) {
                vscode.window.showWarningMessage("Error reading bookmark unicode marker setting");
            }
        }

        if (config.has(this.configKeyDefaultShape)) {
            let configDefaultShape = (config.get(this.configKeyDefaultShape) as string) ?? "";
            if (this.shapes.has(configDefaultShape)) {
                this.defaultShape = configDefaultShape;
            } else {
                vscode.window.showWarningMessage("Error reading bookmark default shape setting, using default");
                this.defaultShape = defaultDefaultShape;
            }
        } else {
            this.defaultShape = defaultDefaultShape;
        }

        if (config.has(this.configKeySaveBookmarksInProject)) {
            let saveInFile = config.get(this.configKeySaveBookmarksInProject, false);
            if (saveInFile) {
                this.persistentStorageType = "file";
            }
        }

        if (config.has(this.configKeyHomingMarginTop)) {
            try {
                this.homingMarginTop = (config.get(this.configKeyHomingMarginTop) as number) ?? 0;
            } catch (e) {
                vscode.window.showWarningMessage("Error reading homing top margin setting");
            }
        }

        if (config.has(this.configKeyHomingMarginBottom)) {
            try {
                this.homingMarginBottom = (config.get(this.configKeyHomingMarginBottom) as number) ?? 0;
            } catch (e) {
                vscode.window.showWarningMessage("Error reading homing bottom margin setting");
            }
        }

        if (config.has(this.configKeyHomingSteps)) {
            try {
                this.homingSteps = (config.get(this.configKeyHomingSteps) as number) ?? 0;
            } catch (e) {
                vscode.window.showWarningMessage("Error reading homing steps setting");
            }
        }

        if (config.has(this.configKeyPersistenceDelay)) {
            try {
                this.persistenceDelay = (config.get(this.configKeyPersistenceDelay) as number) ?? 500;
            } catch (e) {
                vscode.window.showWarningMessage("Error reading persistence delay");
            }
        }

        if (config.has(this.configKeyPersistenceIntervalForWorkspaceState)) {
            try {
                this.persistenceIntervalForWorkspaceState = (config.get(this.configKeyPersistenceIntervalForWorkspaceState) as number) ?? 500;
            } catch (e) {
                vscode.window.showWarningMessage("Error reading persistence interval for workspace state");
            }
        }

        if (config.has(this.configKeyPersistenceIntervalForFiles)) {
            try {
                this.persistenceIntervalForFiles = (config.get(this.configKeyPersistenceIntervalForFiles) as number) ?? 1500;
            } catch (e) {
                vscode.window.showWarningMessage("Error reading persistence interval for files");
            }
        }
        this.setStorageRateLimiter();

        let configOverviewRulerLane = (config.get(this.configKeyOverviewRulerLane) as string) ?? "center";
        let previousOverviewRulerLane = this.decorationFactory.overviewRulerLane;
        let newOverviewRulerLane: OverviewRulerLane | undefined;
        switch (configOverviewRulerLane) {
            case "center": newOverviewRulerLane = OverviewRulerLane.Center; break;
            case "full": newOverviewRulerLane = OverviewRulerLane.Full; break;
            case "left": newOverviewRulerLane = OverviewRulerLane.Left; break;
            case "right": newOverviewRulerLane = OverviewRulerLane.Right; break;
            default:
                newOverviewRulerLane = undefined;
        }

        let newLineEndLabelType = (config.get(this.configKeyLineEndLabelType) as string) ?? "bordered";
        let previousLineEndLabelType = this.decorationFactory.lineEndLabelType;

        if (
            (typeof previousOverviewRulerLane === "undefined") !== (typeof newOverviewRulerLane === "undefined")
            || previousOverviewRulerLane !== newOverviewRulerLane
            || (typeof previousLineEndLabelType === "undefined") !== (typeof newLineEndLabelType === "undefined")
            || previousLineEndLabelType !== newLineEndLabelType
        ) {
            this.decorationFactory.overviewRulerLane = newOverviewRulerLane;
            this.decorationFactory.lineEndLabelType = newLineEndLabelType;
            this.groups.forEach(group => group.redoDecorations());
            this.bookmarks.forEach(bookmark => bookmark.initDecoration());
        }
    }

    public async onFilesRenamed(fileRenamedEvent: FileRenameEvent) {
        let changedFiles = new Map<string, boolean>();

        for (let rename of fileRenamedEvent.files) {
            let stat = await vscode.workspace.fs.stat(rename.newUri);
            let oldFsPath = rename.oldUri.fsPath;
            let newFsPath = rename.newUri.fsPath;

            if ((stat.type & vscode.FileType.Directory) > 0) {
                for (let bookmark of this.bookmarks) {
                    if (bookmark.fsPath.startsWith(oldFsPath)) {
                        let originalBookmarkFsPath = bookmark.fsPath;
                        bookmark.fsPath = newFsPath + bookmark.fsPath.substring(oldFsPath.length);
                        changedFiles.set(originalBookmarkFsPath, true);
                        changedFiles.set(bookmark.fsPath, true);
                    }
                }
            } else {
                for (let bookmark of this.bookmarks) {
                    if (bookmark.fsPath === oldFsPath) {
                        bookmark.fsPath = newFsPath;
                        changedFiles.set(oldFsPath, true);
                        changedFiles.set(newFsPath, true);
                    }
                }
            }
        }

        for (let [changedFile, b] of changedFiles) {
            this.tempDocumentBookmarks.delete(changedFile);
            this.tempDocumentDecorations.delete(changedFile);
        }

        if (changedFiles.size > 0) {
            this.updateBookmarkTimestamp();
            this.saveBookmarkData();
            this.updateDecorations();
            this.treeViewRefreshCallback();
        }
    }

    public async onFilesDeleted(fileDeleteEvent: FileDeleteEvent) {
        for (let uri of fileDeleteEvent.files) {
            let deletedFsPath = uri.fsPath;

            let changesWereMade = false;
            for (let bookmark of this.bookmarks) {
                if (bookmark.fsPath === deletedFsPath) {
                    this.deleteBookmark(bookmark);
                    changesWereMade = true;
                }
            }

            if (changesWereMade) {
                this.updateBookmarkTimestamp();
                this.saveBookmarkData();
                this.updateDecorations();
                this.treeViewRefreshCallback();
            }
        }
    }

    private updateStatusBar() {
        this.statusBarItem.text = "$(bookmark) "
            + this.activeGroup.name
            + ": "
            + this.getTempGroupBookmarkList(this.activeGroup).length
            + this.persistentStorage.getStatusBarText();

        let hideStatus = "";
        if (this.hideAll) {
            hideStatus = ", all hidden";
        } else if (this.hideInactiveGroups) {
            hideStatus = ", inactive groups hidden";
        } else {
            hideStatus = ", all visible";
        }
        this.statusBarItem.tooltip = this.groups.length + " group(s)" + hideStatus
            + "\n" + this.persistentStorage.getStatusBarTooltipText();
    }

    private loadLocalState() {
        // let savedPersistentStorageType = (this.ctx.workspaceState.get(this.savedPersistentStorageTypeKey) as string) ?? "";
        // if (this.persistentStorageTypeOptions.indexOf(savedPersistentStorageType) > -1) {
        //     this.persistentStorageType = savedPersistentStorageType;
        // } else {
        //     this.persistentStorageType = this.defaultPersistentStorageType;
        // }

        // let savedPersistToFilePath = (this.ctx.workspaceState.get(this.savedPersistToFilePathKey) as string) ?? "";
        // this.persistToFilePath = savedPersistToFilePath;

        this.hideInactiveGroups = this.ctx.workspaceState.get(this.savedHideInactiveGroupsKey) ?? false;

        this.hideAll = this.ctx.workspaceState.get(this.savedHideAllKey) ?? false;

        let savedGroupToActivate: string = this.ctx.workspaceState.get(this.savedActiveGroupKey) ?? this.defaultGroupName;
        this.activeGroup = new Group(savedGroupToActivate, this.fallbackColor, this.defaultShape, "", this.decorationFactory);

    }

    private loadBookmarkData() {
        this.bookmarkTimestamp = this.persistentStorage.getTimestamp();

        this.groups = new Array<Group>();
        try {
            for (let sg of this.persistentStorage.getGroups()) {
                this.addNewGroup(Group.fromSerializableGroup(sg, this.decorationFactory));
            }

            this.groups.sort(Group.sortByName);
        } catch (e) {
            vscode.window.showErrorMessage("Restoring bookmark groups failed (" + e + ")");
        }

        this.bookmarks = new Array<Bookmark>();
        try {
            for (let sb of this.persistentStorage.getBookmarks()) {
                let bookmark = Bookmark.fromSerializableBookMark(sb, this.getGroupByName.bind(this), this.decorationFactory);
                this.addNewDecoratedBookmark(bookmark);
            }

            this.bookmarks.sort(Bookmark.sortByLocation);
        } catch (e) {
            vscode.window.showErrorMessage("Restoring bookmarks failed (" + e + ")");
        }

        this.persistentStorageType = this.persistentStorage.getStorageType();
        this.persistToFilePath = this.persistentStorage.getStoragePath();

        this.resetTempLists();
    }

    private addNewGroup(group: Group) {
        group.onGroupDecorationUpdated(this.handleGroupDecorationUpdated.bind(this));
        group.onGroupDecorationSwitched(this.handleGroupDecorationSwitched.bind(this));
        group.onDecorationRemoved(this.handleDecorationRemoved.bind(this));
        group.initDecorations();
        this.groups.push(group);
    }

    private addNewDecoratedBookmark(bookmark: Bookmark) {
        bookmark.onBookmarkDecorationUpdated(this.handleBookmarkDecorationUpdated.bind(this));
        bookmark.onDecorationRemoved(this.handleDecorationRemoved.bind(this));
        bookmark.initDecoration();
        this.bookmarks.push(bookmark);
    }

    private activateGroup(name: string, saveState: boolean = true) {
        let newActiveGroup = this.ensureGroup(name);
        if (newActiveGroup === this.activeGroup) {
            return;
        }

        this.activeGroup.setIsActive(false);
        this.activeGroup = newActiveGroup;
        newActiveGroup.setIsActive(true);

        this.setGroupVisibilities();
        this.tempDocumentDecorations.clear();

        if (saveState) {
            this.saveLocalState();
        }
    }

    private getExistingGroupNameOrDefault(preferredName: string): string {
        if (this.groups.length === 0) {
            return this.defaultGroupName;
        }

        let group = this.groups.find((g: Group) => { return g.name === preferredName; });
        if (typeof group !== "undefined") {
            return group.name;
        }

        return this.groups[0].name;
    }

    private setGroupVisibilities() {
        this.groups.forEach(group => {
            group.setIsVisible(!this.hideAll && (!this.hideInactiveGroups || group.isActive));
        });
    }

    private ensureGroup(name: string): Group {
        let group = this.groups.find(
            (group) => {
                return group.name === name;
            });

        if (typeof group !== "undefined") {
            return group;
        }

        group = new Group(name, this.getLeastUsedColor(), this.defaultShape, name, this.decorationFactory);
        this.addNewGroup(group);
        this.groups.sort(Group.sortByName);

        return group;
    }

    private getLeastUsedColor(): string {
        if (this.colors.size < 1) {
            return this.fallbackColor;
        }

        let usages = new Map<string, number>();

        for (let [index, color] of this.colors) {
            usages.set(color, 0);
        }

        for (let group of this.groups) {
            let groupColor = group.getColor();
            if (usages.has(groupColor)) {
                usages.set(groupColor, (usages.get(groupColor) ?? 0) + 1);
            }
        }

        let minUsage = Number.MAX_SAFE_INTEGER;
        let leastUsedColor = "";

        for (let [key, value] of usages) {
            if (minUsage > value) {
                minUsage = value;
                leastUsedColor = key;
            }
        }

        return leastUsedColor;
    }

    private setHideInactiveGroups(hideInactiveGroups: boolean) {
        if (this.hideInactiveGroups === hideInactiveGroups) {
            return;
        }

        this.hideInactiveGroups = hideInactiveGroups;

        this.setGroupVisibilities();

        this.tempDocumentDecorations.clear();
    }

    private setHideAll(hideAll: boolean) {
        if (this.hideAll === hideAll) {
            return;
        }

        this.hideAll = hideAll;

        this.setGroupVisibilities();

        this.tempDocumentDecorations.clear();
    }

    private getNlCount(text: string) {
        let nlCount: number = 0;
        for (let c of text) {
            nlCount += (c === "\n") ? 1 : 0;
        }
        return nlCount;
    }

    private getFirstLine(text: string): string {
        let firstNewLinePos = text.indexOf("\n");
        if (firstNewLinePos < 0) {
            return text;
        }

        return text.substring(0, firstNewLinePos + 1);
    }

    private getLastLine(text: string): string {
        let lastNewLinePos = text.lastIndexOf("\n");
        if (lastNewLinePos < 0) {
            return text;
        }

        return text.substring(lastNewLinePos + 1);
    }

    public jumpToBookmark(bookmark: Bookmark, preview: boolean = false) {
        let absPath = getAbsolutePath(bookmark.fsPath);
        vscode.window.showTextDocument(vscode.Uri.file(absPath), { preview: preview, preserveFocus: preview }).then(
            textEditor => {
                try {

                    let lineCount = textEditor.document.lineCount;
                    if (lineCount < bookmark.lineNumber) {
                        throw Error('bookmark is past EOF');
                    }

                    let homingSteps = this.homingSteps;

                    let marginTopStep = this.homingMarginTop / homingSteps;
                    let marginBottomStep = this.homingMarginBottom / homingSteps;

                    while (homingSteps > 0) {
                        let approximateRange = new Range(
                            Math.max(0, bookmark.lineNumber - Math.round(marginTopStep * homingSteps)),
                            0,
                            Math.min(lineCount, bookmark.lineNumber + Math.round(marginBottomStep * homingSteps)),
                            0
                        );
                        textEditor.selection = new vscode.Selection(approximateRange.start, approximateRange.start);
                        textEditor.revealRange(approximateRange);

                        homingSteps--;
                    }

                    let range = new Range(
                        bookmark.lineNumber,
                        bookmark.characterNumber,
                        bookmark.lineNumber,
                        bookmark.characterNumber
                    );
                    textEditor.selection = new vscode.Selection(range.start, range.start);
                    textEditor.revealRange(range);
                } catch (e) {
                    bookmark.failedJump = true;
                    vscode.window.showWarningMessage("Failed to navigate to bookmark (3): " + e);
                    return;
                }
                bookmark.failedJump = false;
            },
            rejectReason => {
                bookmark.failedJump = true;
                vscode.window.showWarningMessage("Failed to navigate to bookmark (2): " + rejectReason.message);
            }
        );
    }

    public getNearestActiveBookmarkInFile(textEditor: TextEditor, group: Group | null): Bookmark | null {
        if (textEditor.selections.length === 0) {
            return null;
        }

        let relativeFsPath = getRelativePath(textEditor.document.uri.fsPath);
        let lineNumber = textEditor.selection.start.line;

        let nearestBeforeLine = -1;
        let nearestBefore: Bookmark | null = null;
        let nearestAfterline = Number.MAX_SAFE_INTEGER;
        let nearestAfter: Bookmark | null = null;

        this.getTempDocumentBookmarkList(relativeFsPath)
            .filter(g => (group === null || g.group === group))
            .forEach(bookmark => {
                if (bookmark.lineNumber > nearestBeforeLine && bookmark.lineNumber <= lineNumber) {
                    nearestBeforeLine = bookmark.lineNumber;
                    nearestBefore = bookmark;
                }

                if (bookmark.lineNumber < nearestAfterline && bookmark.lineNumber >= lineNumber) {
                    nearestAfterline = bookmark.lineNumber;
                    nearestAfter = bookmark;
                }
            });

        if (nearestBefore === null && nearestAfter === null) {
            return null;
        }

        if (nearestBefore !== null && nearestAfter !== null) {
            if (lineNumber - nearestBeforeLine < nearestAfterline - lineNumber) {
                return nearestBefore;
            }

            return nearestAfter;
        }

        if (nearestBefore !== null) {
            return nearestBefore;
        }

        return nearestAfter;
    }

    private updateBookmarkTimestamp() {
        this.bookmarkTimestamp = Date.now();
    }

    private setStorageRateLimiter() {
        let repeatedWriteDelay = this.persistentStorage.getStorageType() === "file"
            ? this.persistenceIntervalForFiles
            : this.persistenceIntervalForWorkspaceState;

        this.persistentStorageRateLimiter = new RateLimiter(
            this.saveBookmarkDataImmediately.bind(this),
            this.persistenceDelay,
            repeatedWriteDelay
        );
    }

    private getRealPath(path: string): string {
        let tempUri = Uri.parse(path);
        let realPath = tempUri.fsPath;
        if (typeof tempUri.scheme !== "undefined" && tempUri.scheme !== '') {
            realPath = tempUri.scheme + ":" + realPath;
        }
        return realPath;
    }
}