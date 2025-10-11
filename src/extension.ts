// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { error } from "console";
import * as path from "path";
import * as vscode from "vscode";
import { exec } from "child_process";
import * as os from "os";
import { promisify } from "util";

export const getNewFileDir = () => vscode.workspace.getConfiguration('streamer-bot-csharp').get('newFileDir', 'src').trim().replaceAll(/^\/|\/$/g, '');
let rootPath: string | undefined;
let sbProjUri: vscode.Uri | undefined;

export function activate(context: vscode.ExtensionContext) {

    console.log('"streamer-bot-csharp" is now active!');
    getSbProjectRootPath().then(path =>{
        if (path){
            rootPath = path;
            vscode.workspace.findFiles('**/*.cs', "**/{bin,obj}/**", 1).then(csFile => {
                if (!csFile || csFile.length === 0){
                    console.log('no csharp files in sb workspace, opening walkthrough');
                    vscode.commands.executeCommand("workbench.action.openWalkthrough",  { category: 'fajita-of-treason.streamer-bot-csharp#sb.welcome', step: 'createNewFile' }, false);
                }
            });
        }
    });
    
    context.subscriptions.push(vscode.commands.registerCommand("streamer-bot-csharp.openWalkthrough", async () => {
        vscode.commands.executeCommand("workbench.action.openWalkthrough", 'fajita-of-treason.streamer-bot-csharp#sb.welcome', false);
    }));

    let resumeProjectCreationDirectoryUri: vscode.Uri | undefined = undefined;
    context.subscriptions.push(vscode.commands.registerCommand("streamer-bot-csharp.newStreamerbotProject", async () => {
        const sbStartMenuPathPromise = getSbDirectoryFromStart();
        
        // Step 1: Get Project Directory Uri
        let newProjectDirectoryUri: vscode.Uri | undefined = undefined;
        let fromWorkspace = false;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders){
            interface WorkspaceQuickPick extends vscode.QuickPickItem
            {
                workspaceIndex: number;
            }
            const workspaceQuickPicks : WorkspaceQuickPick[] = workspaceFolders.map((x, i) => 
                ({
                    label: x.uri.fsPath,
                    description: "Workspace Folder",
                    workspaceIndex: i,
                }));
                let quickPickList: vscode.QuickPickItem[] = [];
                if(resumeProjectCreationDirectoryUri && !workspaceFolders.some(x => x.uri.fsPath === resumeProjectCreationDirectoryUri?.fsPath)){
                    quickPickList.push({
                        label: '$(timeline-open) ' + resumeProjectCreationDirectoryUri.fsPath,
                        description: "Previously Selected Folder"
                    });
                }
                quickPickList = quickPickList.concat([
                    ...workspaceQuickPicks,
                    {label: "$(folder) Browse for Folder", description: "Other Folder"}
                ]);

            const directoryPickChoice = await vscode.window.showQuickPick(
                quickPickList,
                {title: "Choose Directory for New Streamer.bot Project" }
            );
            if (!directoryPickChoice){
                console.log("project creation cancelled by user at quickpick project directory.");
                return;
            } else if (directoryPickChoice?.description === "Previously Selected Folder"){
                newProjectDirectoryUri = resumeProjectCreationDirectoryUri;
            } else if (directoryPickChoice?.description === "Workspace Folder"){
                newProjectDirectoryUri = workspaceFolders[(directoryPickChoice as WorkspaceQuickPick).workspaceIndex].uri;
                fromWorkspace = true;
            }
        }

        // if not set by quickpick, show browse prompt
        if (!newProjectDirectoryUri){
            const selectedFolder = await vscode.window.showOpenDialog(
                {
                    title: 'Choose Directory for New Streamer.bot Project',
                    canSelectFolders: true,
                    canSelectFiles: false,
                    openLabel:"Select",
                    canSelectMany: false
                });
            if (selectedFolder){
                newProjectDirectoryUri = selectedFolder[0];
            }
            else{
                console.log("project creation cancelled by user at browse for project directory.");
                return;
            }
        }

        resumeProjectCreationDirectoryUri = newProjectDirectoryUri;

        // Step 2: Get StreamerBot Directory Path
        let sbDirectory = process.env.STREAMERBOT_DIR;
        if (!sbDirectory){
            sbDirectory = await sbStartMenuPathPromise;
        }
        let sbDirQuickpickOptions : vscode.QuickPickItem[] = [];
        if (sbDirectory){
            sbDirQuickpickOptions.push(
                {label: '$(folder-active) ' + sbDirectory, description: "Current Streamer.bot Install Location"}
            );
        }
        const sbDirQuickPickSelection = await vscode.window.showQuickPick([
            ...sbDirQuickpickOptions,
            {label: "$(folder) Browse for Folder", description: "Other Folder"}
        ],{canPickMany: false, placeHolder: "Select Streamer.bot Location"});
        if (!sbDirQuickPickSelection){
            console.log("project creation cancelled by user at sb quickpick");
            return;
        }
        if (sbDirQuickPickSelection?.description === "Other Folder"){
            sbDirectory = undefined;
        }
        if (!sbDirectory){
            sbDirectory = await promptUserForSbLocation();
        }
        if (!sbDirectory){
            console.log("project creation cancelled by user at sb exe browse");
            return;
        }
        sbDirectory.replaceAll(path.sep, path.posix.sep);

        let newWindow = false;
        if(!fromWorkspace) {
            // Step 3: Prompt to open in new window or current
            const newWindowQuickPickSelection = await vscode.window.showQuickPick([
                {label: "$(window) Open in current window"},
                {label: "$(empty-window) Open in new window"}
            ],{canPickMany: false, placeHolder: "Open in current window?"});
            if (!newWindowQuickPickSelection){
                console.log("project creation cancelled by user at new window quickpick");
                return;
            }
            newWindow = newWindowQuickPickSelection.label === "$(empty-window) Open in new window";
        }
        
        // Create Project File In Chosen Directory
        console.log("ready to create new files in " + newProjectDirectoryUri.fsPath);
        const projectContent = (await vscode.workspace.openTextDocument(path.join(context.extensionPath, 'StreamerBot.csproj.xml')));
        const replacementText = getProjFileReplacementText(projectContent, sbDirectory);
        try{
            await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(newProjectDirectoryUri.fsPath, path.basename(newProjectDirectoryUri.fsPath) + '.csproj')), Buffer.from(replacementText));

            vscode.commands.executeCommand('vscode.openFolder', newProjectDirectoryUri, {forceNewWindow: newWindow});
            if (fromWorkspace){
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        }
        catch(e: any){
            vscode.window.showErrorMessage(e.toString());
        }

    }));

    context.subscriptions.push(vscode.commands.registerCommand("streamer-bot-csharp.setStreamerBotPath", async () => {
        if (!sbProjUri) {
            await getSbProjectRootPath();
        }
        if (!sbProjUri){
            vscode.window.showErrorMessage("No workspace folder open.", {modal: true});
            return false;
        }

        let contents = await vscode.workspace.openTextDocument(sbProjUri);
        if (contents.isDirty){
            vscode.window.showErrorMessage("Can not update project file while it has unsaved changes.", {modal: true});
            return false;
        }

        const sbDirFromUserPrompt = await promptUserForSbLocation();
        if (sbDirFromUserPrompt){
            const sbDirectory = sbDirFromUserPrompt;
            const replacementText = getProjFileReplacementText(contents, sbDirectory);
            await vscode.workspace.fs.writeFile(contents.uri, Buffer.from(replacementText));
            return true;
        }
        else{
            // user cancelled
            return false;
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand("streamer-bot-csharp.newFile", async (explorerPath?: vscode.Uri) => {
        if (!rootPath) {
            rootPath = await getSbProjectRootPath();
        }
        if (!rootPath) {
            vscode.window.showErrorMessage("No workspace folder open.");
            return;
        }
        const newFileDir = getNewFileDir();
        let fileName = await vscode.window.showInputBox({
            title: "Enter New CS File Name",
            placeHolder: "MyNewAction.cs",
            value: await getDirPathRelativeToNewFileDir(rootPath, newFileDir, explorerPath),
            validateInput: userText => {return validateNewFile(newFileDir, userText);},
        });
        if (fileName) {
            console.log(fileName);
            const newFileUri = vscode.Uri.file(path.posix.join(rootPath, getNewCsFileRelativePath(newFileDir, fileName)));
            try {
                const fileStats = await vscode.workspace.fs.stat(newFileUri);
                let existingDoc = await vscode.workspace.openTextDocument(newFileUri);
                vscode.window.showInformationMessage(
                    'File "' +
                    existingDoc.fileName +
                    '" already exists, opening it instead.'
                );
                await vscode.window.showTextDocument(newFileUri);
                if (existingDoc.getText().trim() === "") {
                    fillWithSnippet();
                }
            } catch (err: any) {
                if (err.code === "FileNotFound") {
                    await vscode.workspace.fs.writeFile(newFileUri, Buffer.from(""));
                    await vscode.window.showTextDocument(newFileUri);
                    await fillWithSnippet();
                } else {
                    console.error(err);
                    vscode.window.showErrorMessage(err);
                }
            }
        }
    }
    ));

    context.subscriptions.push(vscode.commands.registerCommand("streamer-bot-csharp.openSettings", async () => {
        vscode.commands.executeCommand('workbench.action.openSettings', '@ext:fajita-of-treason.streamer-bot-csharp'); 
    }));
}

function getProjFileReplacementText(contents: vscode.TextDocument, sbDirectory: string) {
    return contents.getText().replace(/(?<=\<StreamerBotPath[^\>]*\>)([^<]*)(?=\<\/StreamerBotPath\>)/, sbDirectory);
}

export async function validateNewFile(newFileDir: string, userText: string): Promise<vscode.InputBoxValidationMessage | undefined> {
    userText = userText.trim();
        if (!userText || userText.endsWith(path.win32.sep) || userText.endsWith(path.posix.sep)){
            return {
                message: 'Enter filename',
                severity: vscode.InputBoxValidationSeverity.Error
            };
        }
        const newFileName = getNewCsFileRelativePath(newFileDir, userText);
        let foundFiles = await vscode.workspace.findFiles('**/' + newFileName.substring(newFileName.lastIndexOf('/') + 1));
        if (foundFiles.length > 0) {
            return {
                message: '$(error)' + vscode.workspace.asRelativePath(foundFiles[0]) + ' already exists.',
                severity: vscode.InputBoxValidationSeverity.Error
            };
        }
        const disallowedFileCharsMatches = newFileName.match(/[^\/A-z](?!(.*\/|cs$))/g);
        if (disallowedFileCharsMatches) {
            return {
                message: "$(error) Disallowed Characters in filename: " + disallowedFileCharsMatches.map(m => "'" + m[0] + "'").join(', '),
                severity: vscode.InputBoxValidationSeverity.Error,
            }; 
        }
        const disallowedDirectoryCharMatches = newFileName.match(/[^\/\w\s\.-](?=.*\/)/g);
        if (disallowedDirectoryCharMatches) {
            return {
                message: "$(error) Disallowed Characters in directory path: " + disallowedDirectoryCharMatches.map(m => "'" + m[0] + "'").join(', '),
                severity: vscode.InputBoxValidationSeverity.Error,
            }; 
        }
        else{
            return {
                message: "Will create " + newFileName,
                severity: vscode.InputBoxValidationSeverity.Info,
            };
        }
}

export function getNewCsFileRelativePath(baseDir: string, relativeFilePath: string) {
    let relativePath = relativeFilePath.replaceAll(path.win32.sep, path.posix.sep);
    if (!relativePath.startsWith(path.posix.sep)){
        relativePath = path.posix.join(baseDir, relativePath);
    }
    if (!relativePath.endsWith('.cs')) {
        relativePath += '.cs';
    }
    // trim spaces around all '/' characters (directories can not start or end in spaces)
    relativePath = relativePath.replaceAll(/(\s*\/\s*)/g, '/');
    // capitalize first letter which has no '/' following it (Classes should start with capital letter)
    relativePath = relativePath.replace(/[A-z](?!.*\/)/, a => a.toUpperCase());
    // remove all spaces and capitalize following letter which have no '/' following them (convert spaces to camelCase)
    relativePath = relativePath.replaceAll(/\s+([A-z])(?!.*\/)/g, (text, a:string) => { return a.toUpperCase(); });

    return relativePath;
}

async function fillWithSnippet() {
    await vscode.commands.executeCommand("editor.action.insertSnippet", { name: "Execute C# Sub-Action Template" });
    if (vscode.workspace.getConfiguration('streamer-bot-csharp').get('autoFold')) {
        await vscode.commands.executeCommand("editor.foldAllMarkerRegions");
    }
    await vscode.commands.executeCommand("workbench.action.files.save");
}

export async function getDirPathRelativeToNewFileDir(rootPath: string, newFileDir: string, uri?: vscode.Uri): Promise<string | undefined> {
    if (uri){
        let fullPath = uri.fsPath.replaceAll(path.win32.sep, path.posix.sep);
        if (fullPath === rootPath){
            return '/';
        }
        try {
            if ((await vscode.workspace.fs.stat(uri)).type === vscode.FileType.File){
                fullPath = path.dirname(uri.fsPath);
            }
            const relativeExplorerPath = vscode.workspace.asRelativePath(fullPath) + '/';
            if (relativeExplorerPath.startsWith(newFileDir)){
                return relativeExplorerPath.substring(newFileDir.length + 1);
            }
            else{
                return relativeExplorerPath;
            }
        }
        catch { return; }
    }
}

export async function getSbProjectRootPath(projExt?: string): Promise<string | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
    }
    if (!projExt) { projExt = '*.csproj'; }
    const projfilePaths = await vscode.workspace.findFiles(projExt);
    if (!projfilePaths || projfilePaths.length === 0){
        return;
    }

    const projFileSearchPromises = projfilePaths.map(path => 
        vscode.workspace.openTextDocument(path).then(doc => {
            if (doc.getText().includes("</StreamerBotPath>")) { return path; }
        }));

    const foundSbProjUri = (await Promise.all(projFileSearchPromises)).find(x => !!x);
    if (!foundSbProjUri){
        return;
    }

    for (const folder of workspaceFolders){
        if (foundSbProjUri.fsPath.startsWith(folder.uri.fsPath)){
            vscode.commands.executeCommand('setContext', 'streamer-bot-csharp.inStreamerBotProject', true);
            vscode.commands.executeCommand('setContext', 'streamer-bot-csharp.streamerBotProjFilename', [ path.basename(foundSbProjUri.fsPath) ]);
            sbProjUri = foundSbProjUri;
            return folder.uri.fsPath.replaceAll(path.win32.sep, path.posix.sep);
        }
    }
    return undefined;
}

function getSbDirectoryPathFromExePath(sbExePath: string): string | undefined{
    if (sbExePath.trim().toLowerCase().endsWith('streamer.bot.exe')){
        const sbDirectory = path.dirname(sbExePath);
        return sbDirectory;
    }
    else{
        console.log("user selected non streamer.bot.exe executable");
        console.log(sbExePath);
        vscode.window.showErrorMessage("Selected executable was not 'Streamer.bot.exe'", {modal: true});
        return undefined;
    }
}

async function promptUserForSbLocation(): Promise<string | undefined>{
    const fileHandle = await vscode.window.showOpenDialog({ title: 'Select Streamer.bot location', filters: { 'Streamer.bot': ['exe'] }, canSelectMany: false });
    if (fileHandle) {
        const sbExePath = fileHandle[0].fsPath;
        return getSbDirectoryPathFromExePath(sbExePath);
    }
    return undefined;
}

const execAsync = promisify(exec);

async function getSbDirectoryFromStart(): Promise<string | undefined> {
    if (os.type() === 'Windows_NT'){
        const output = await execAsync('(Get-StartApps | Where-Object {$_.Name -eq "Streamer.bot"}).AppID', {'shell':'powershell.exe'});
        return getSbDirectoryPathFromExePath(output.stdout);
    }
}

// This method is called when your extension is deactivated
export function deactivate() { }
