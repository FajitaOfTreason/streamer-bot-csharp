// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { error } from "console";
import * as path from "path";
import * as vscode from "vscode";


const getProjectFileName = () => vscode.workspace.getConfiguration('streamer-bot-csharp').get('projectFileName', "StreamerBot.csproj");
const getNewFileDir = () => vscode.workspace.getConfiguration('streamer-bot-csharp').get('newFileDir', 'src');
let newFileDir: string;

export function activate(context: vscode.ExtensionContext) {

    console.log('"streamer-bot-csharp" is now active!');
    getRootPath();

    context.subscriptions.push(vscode.commands.registerCommand("streamer-bot-csharp.openWalkthrough", async () => {
        vscode.commands.executeCommand("workbench.action.openWalkthrough", 'fajita-of-treason.streamer-bot-csharp#sb.welcome', false);
    }));

    let resumeProjectCreationDirectoryUri: vscode.Uri | undefined = undefined;
    context.subscriptions.push(vscode.commands.registerCommand("streamer-bot-csharp.newStreamerbotProject", async () => {
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
        let sbDirQuickpickOptions : vscode.QuickPickItem[] = [];
        if (sbDirectory){
            sbDirectory = path.dirname(sbDirectory).replaceAll(path.sep, path.posix.sep);
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
            await vscode.workspace.fs.writeFile(vscode.Uri.file(path.join(newProjectDirectoryUri.fsPath, getProjectFileName())), Buffer.from(replacementText));

            vscode.commands.executeCommand('vscode.openFolder', newProjectDirectoryUri, {forceNewWindow: newWindow});
            if (fromWorkspace){
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        }
        catch(e: any){
            vscode.window.showErrorMessage(e.toString());
        }

    }));

    context.subscriptions.push(vscode.commands.registerCommand("streamer-bot-csharp.setStreamerbotPath", async () => {
        const rootPath = await getRootPath();
        if (!rootPath) {
            vscode.window.showErrorMessage("No workspace folder open.", {modal: true});
            return false;
        }
        const projFileUri = getUriFromRelativePath(rootPath, getProjectFileName());

        let contents = await vscode.workspace.openTextDocument(projFileUri);
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

    async function promptUserForSbLocation(): Promise<string | undefined>{
        const fileHandle = await vscode.window.showOpenDialog({ title: 'Select Streamer.bot location', filters: { 'Streamer.bot': ['exe'] }, canSelectMany: false });
        if (fileHandle) {
            const sbExePath = fileHandle[0].fsPath;
            if (sbExePath.toLowerCase().endsWith('streamer.bot.exe')){
                const sbDirectory = path.dirname(sbExePath).replaceAll(path.sep, path.posix.sep);
                return sbDirectory;
            }
            else{
                console.log("user selected non stremer.bot.exe executable");
                vscode.window.showErrorMessage("Selected executable was not 'Streamer.bot.exe'", {modal: true});
                return undefined;
            }
        }
        return undefined;
    }

    context.subscriptions.push(vscode.commands.registerCommand("streamer-bot-csharp.newFile", async () => {
        const rootPath = await getRootPath();
        if (!rootPath) {
            vscode.window.showErrorMessage("No workspace folder open.");
            return;
        }
        newFileDir = getNewFileDir();
        let fileName = await vscode.window.showInputBox({
            title: "Enter New CS File Name",
            placeHolder: "MyNewAction.cs",
            validateInput: validateNewFile,
        });
        if (fileName) {
            console.log(fileName);
            const newFileUri = getUriFromRelativePath(rootPath, getNewCsFileRelativePath(fileName));
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

async function validateNewFile(value: string): Promise<vscode.InputBoxValidationMessage | undefined> {
    if (value) {
        if (value.indexOf(' ') > 0) {
            return {
                message: "$(error) C# filenames can not contain spaces",
                severity: vscode.InputBoxValidationSeverity.Error,
            };
        }
        const newFileName = value.toLowerCase().endsWith('.cs') ? value : value + '.cs';
        let foundFiles = await vscode.workspace.findFiles('**/' + newFileName,);
        if (foundFiles.length > 0) {
            return {
                message: '$(error)' + vscode.workspace.asRelativePath(foundFiles[0]) + ' already exists.',
                severity: vscode.InputBoxValidationSeverity.Error
            };
        }
        if (value.match(/^([\w\.-]*[\/\\])*[A-Z][A-z]*(\.cs)?$/)) {
            return {
                message: "Will create " + getNewCsFileRelativePath(value),
                severity: vscode.InputBoxValidationSeverity.Info,
            };
        }
        else if (value.indexOf('.', value.replaceAll('\\', '/').lastIndexOf('/')) > 0 && !value.endsWith('.cs')){
            return {
                message: "$(error) C# files must use the .cs extension",
                severity: vscode.InputBoxValidationSeverity.Error,
            }; 
        }
        else {
            return {
                message: "$(warning) C# filenames should start with a capital letter",
                severity: vscode.InputBoxValidationSeverity.Warning,
            };
        }
    }
}

function getNewCsFileRelativePath(value: string) {
    let relativePath = value.replaceAll(path.win32.sep, path.posix.sep);
    if (!relativePath.startsWith(path.posix.sep)){
        relativePath = path.posix.join(newFileDir, relativePath);
    }
    if (!relativePath.endsWith('.cs')) {
        relativePath += '.cs';
    }
    return relativePath;
}

async function fillWithSnippet() {
    await vscode.commands.executeCommand("editor.action.insertSnippet", { name: "Execute C# Sub-Action Template" });
    if (vscode.workspace.getConfiguration('streamer-bot-csharp').get('autoFold')) {
        await vscode.commands.executeCommand("editor.foldAllMarkerRegions");
    }
    await vscode.commands.executeCommand("workbench.action.files.save");
}

async function getRootPath(): Promise<string | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
    }
    const projfilePaths = await vscode.workspace.findFiles(getProjectFileName());
    if (!projfilePaths || projfilePaths.length === 0){
        return;
    }
    for (const folder of workspaceFolders){
        if (projfilePaths[0].fsPath.startsWith(folder.uri.fsPath)){
            vscode.commands.executeCommand('setContext', 'streamer-bot-csharp.inStreamerBotProject', true);
            return folder.uri.fsPath;
        }
    }
    return undefined;
}

function getUriFromRelativePath(rootPath: string, relativePath: string): vscode.Uri {
    const filePath = path.join(rootPath, relativePath);
    const newFile = vscode.Uri.file(filePath);
    return newFile;
}

// This method is called when your extension is deactivated
export function deactivate() { }
