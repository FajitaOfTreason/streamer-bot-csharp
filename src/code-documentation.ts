import path from "path";
import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { glob } from "fs/promises";

interface DocFileData {
    description: string;
    example: string;
    mdBody: string;
}

interface GitHubContentData {
    download_url: string;
    name: string;
    sha: string;
    type: string;
}
interface GitHubTreeResponse {
    sha: string;
    url: string;
    tree: GitHubTreeItem[];
    truncated: boolean;
}

interface DirectoryCacheInfo {
    path: string;
    sha: string;
    files: FileCacheInfo[];
}

interface FileCacheInfo {
    path: string;
    sha: string;
}

interface GitHubTreeItem {
    path: string;
    type: string;
    sha: string;
    url: string;
}

const csharpDocsApiUrl = 'https://api.github.com/repos/Streamerbot/docs/contents/streamerbot/3.api/3.csharp';
const csharpDocsDownloadUrl = 'https://raw.githubusercontent.com/Streamerbot/docs/main/streamerbot/3.api/3.csharp';
const streamerBotDocsTreeApiUrl = 'https://api.github.com/repos/Streamerbot/docs/git/trees';
const sbDocsBaseUri = vscode.Uri.parse('https://docs.streamer.bot');
const sbCsharpDocsUrlPathPrefix = 'api/csharp/methods';
const csharpSbMethodsDir = '3.methods';
const csharpSbParametersDir = '.parameters';
const csharpSbSubdirectories = [csharpSbMethodsDir, csharpSbParametersDir];

const convertToSbDocCasing = (text:string) => text.replaceAll(/\s*([A-Z])/g, (_, upperLetter) => '-' + upperLetter.toLowerCase()).replaceAll(/(?<=^|\/)-/g, '');

export class sbHoverProvider implements vscode.HoverProvider {
    context: vscode.ExtensionContext;
    docsDirectoryUri: vscode.Uri;
    docsCacheInfoFileUri: vscode.Uri;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.docsDirectoryUri = vscode.Uri.joinPath(this.context.globalStorageUri, 'csharp-docs');
        this.docsCacheInfoFileUri = vscode.Uri.joinPath(this.docsDirectoryUri, 'cacheInfo.json');
        this.updateSbDocs().then(update => update ? console.log('Docs on disk were updated') : console.log('Docs on disk are up to date'));
    }

    async provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
        const range = document.getWordRangeAtPosition(position);
        if (!range){
            return undefined;
        }

        const word = document.getText(range);
        const prevWordRange = document.getWordRangeAtPosition(range.start.translate(0, -1));
        if (!prevWordRange){
            return undefined;
        }
        const prevWord = document.getText(prevWordRange);
        if (prevWord !== 'CPH') {
            return undefined;
        }
        const definitionLocs = vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', document.uri, position);
        const sbDocLinkMdPromise = definitionLocs.then(defLocs => this.getSbDocLinkMarkdown(defLocs, expectedFileName));

        const docSearchDirectory = vscode.Uri.joinPath(this.docsDirectoryUri, csharpSbMethodsDir).fsPath;
        const expectedFileName = convertToSbDocCasing(word);
        const docSearchPattern = `**/${expectedFileName}.{yml,md}`;
        let matchingDocFile: string | undefined = undefined;
        for await (const entry of glob(docSearchPattern, {cwd: docSearchDirectory})){
            matchingDocFile = path.join(docSearchDirectory, entry);
            break;
        }

        if (matchingDocFile){
            const docFileData = await sbHoverProvider.getDocFileData(matchingDocFile);
            if (!docFileData){
                return;
            }
            const descriptionMarkdown = new vscode.MarkdownString(docFileData.description + '\n');
            descriptionMarkdown.baseUri = sbDocsBaseUri;
            descriptionMarkdown.supportHtml = true;
            if (docFileData.mdBody) {
                descriptionMarkdown.appendMarkdown(docFileData.mdBody);
            }
            descriptionMarkdown.value = descriptionMarkdown.value.replace(/(?:^|<br>)\s*Returns?\s+(\w)/im, (_, firstLetter:string) => '\n\nReturns:  \n&nbsp;&nbsp;'+firstLetter.toUpperCase());
            const hoverMdStrings = [descriptionMarkdown];

            const sbDocLinkMarkdown = await sbDocLinkMdPromise;
            if (sbDocLinkMarkdown){
                hoverMdStrings.push(sbDocLinkMarkdown);
            }

            const exampleMarkdown = new vscode.MarkdownString();
            if (docFileData.example){
                exampleMarkdown.appendMarkdown('Example:  ').appendCodeblock(docFileData.example, 'csharp');
            }
            hoverMdStrings.push(exampleMarkdown);

            return new vscode.Hover(hoverMdStrings, range);
        }
        else {
            const sbDocLinkMarkdown = await sbDocLinkMdPromise;
            if (sbDocLinkMarkdown){
                return new vscode.Hover(sbDocLinkMarkdown, range);
            }
        }
    }

    private async getSbDocLinkMarkdown(definitionLocations: vscode.Location[], expectedFileName: string) {
        for (const definitionLoc of definitionLocations) {
            const definitionDoc = await vscode.workspace.openTextDocument(definitionLoc.uri);
            const referenceAnnotation = definitionDoc.lineAt(definitionLoc.range.start.line - 1).text;
            // annotation contains `new string[] { "Core", "Arguments" }`
            const categoryList = referenceAnnotation.match(/(?<=new string\[\]\s*{)[^}]+(?=\})/)?.[0].matchAll(/(?<=")[\w\s]*?(?=")/g);
            if (!categoryList) {
                continue;
            }
            const referencePath = convertToSbDocCasing([...categoryList].join(path.posix.sep));
            const lastUrlDirectory = path.basename(referencePath);
            if (expectedFileName.startsWith(lastUrlDirectory)){
                console.log('path pattern is irregular for ' + expectedFileName + ' in path ' + referencePath);
                expectedFileName = expectedFileName.substring(lastUrlDirectory.length+1);
            }
            const sbDocLink = path.posix.join(sbCsharpDocsUrlPathPrefix, referencePath, expectedFileName);
            const sbDocLinkMarkdown = new vscode.MarkdownString(`\n\n[Open Documentation in Browser](${sbDocLink})`);
            sbDocLinkMarkdown.baseUri = sbDocsBaseUri;
            return sbDocLinkMarkdown;
        }
    }

    async updateSbDocs(): Promise<boolean> {
        const cacheInfo = await this.getDocsCacheInfo();
        const baseApiResponse = await fetch(csharpDocsApiUrl);
        if (!baseApiResponse.ok){
            throw new Error("Error accessing GitHub API: " + baseApiResponse.statusText);
        }

        const csharpDocsContentData = await baseApiResponse.json() as GitHubContentData[];
        const requiredSubDirectoriesInfo: DirectoryCacheInfo[] = csharpDocsContentData.filter(x => csharpSbSubdirectories.includes(x.name)).map(x => ({path: x.name, sha: x.sha, files: []}));
        const directoriesContainingUpdates = requiredSubDirectoriesInfo.filter(x => {
            const matchingCacheInfo = cacheInfo.find(c => c.path === x.path);
            if (matchingCacheInfo?.sha === x.sha) {
                console.log('Latest GitHub data matches cached sha for docs directory: [' + x.path + ']');
            } else {
                return true;
            }
        });
        const updatedDirectoryCaches: Promise<DirectoryCacheInfo>[] = [];
        let totalDeleted = 0;
        for (const subDirectoryInfo of directoriesContainingUpdates) {
            await this.getFileInfoForDirectory(subDirectoryInfo);
            const matchingCacheInfo = cacheInfo.find(x => x.path === subDirectoryInfo.path);
            updatedDirectoryCaches.push(this.downloadDocFilesInDirectory(subDirectoryInfo, matchingCacheInfo));
            totalDeleted += await this.deleteRemovedFiles(subDirectoryInfo, matchingCacheInfo);
        }

        const completedDownloadResults = await Promise.all(updatedDirectoryCaches);
        const totalFilesDownloaded = completedDownloadResults.reduce((current, x) => current + x.files.length, 0);
        if (totalDeleted > 0){
            console.log(totalDeleted + ' moved/deleted doc files were deleted locally');
        }
        if (totalFilesDownloaded > 0){
            console.log(totalFilesDownloaded + ' new/updated doc files were downloaded');
            await this.writeDocsCacheInfoFile(completedDownloadResults, cacheInfo);
            return true;
        }

        return false;
    }

    async deleteRemovedFiles(subDirectoryInfo: DirectoryCacheInfo, matchingCacheInfo: DirectoryCacheInfo | undefined) {
        if (!matchingCacheInfo){
            return 0;
        }
        const fetchedFilePaths = new Set(subDirectoryInfo.files.map(f => f.path));
        const cachedFilesToRemove = matchingCacheInfo.files.filter(c => !fetchedFilePaths.has(c.path));
        for (const fileToDelete of cachedFilesToRemove){
            const deletionUri = vscode.Uri.joinPath(this.docsDirectoryUri, matchingCacheInfo.path, fileToDelete.path);
            await vscode.workspace.fs.delete(deletionUri);
        }
        matchingCacheInfo.files = matchingCacheInfo.files.filter(c => fetchedFilePaths.has(c.path));
        return cachedFilesToRemove.length;
    }

    async getFileInfoForDirectory(directoryInfo: DirectoryCacheInfo) {
        const treeInfoUrl = path.posix.join(streamerBotDocsTreeApiUrl, directoryInfo.sha) + '?recursive=true';
        const streamerBotSubTreeResponse = await fetch(treeInfoUrl);
        if (!streamerBotSubTreeResponse.ok){
            throw new Error("Error reaching GitHub API: " + streamerBotSubTreeResponse.statusText);
        }
        console.log('Remaining Rate Limit: ' + streamerBotSubTreeResponse.headers.get('x-ratelimit-remaining'));
        const subTreeResponseData = await streamerBotSubTreeResponse.json() as GitHubTreeResponse;
        const subTreeFileList = subTreeResponseData.tree.filter(x => x.type === 'blob');
        directoryInfo.files = subTreeFileList.map(x => ({path: x.path, sha: x.sha}));
    }

    private async getDocsCacheInfo(): Promise<DirectoryCacheInfo[]> {
        try {
            const cacheInfoDocument = await vscode.workspace.openTextDocument(this.docsCacheInfoFileUri);
            const cacheInfo = JSON.parse(cacheInfoDocument.getText()) as DirectoryCacheInfo[];
            return cacheInfo;
        } catch {
            return [];
        }
    }

    private downloadDocFilesInDirectory(directoryInfo: DirectoryCacheInfo, cacheInfo: DirectoryCacheInfo | undefined): Promise<DirectoryCacheInfo> {
        const docFilesInDirectory = directoryInfo.files.filter(f => f.path.endsWith('.md') || f.path.endsWith('.yml'));
        let changedDocsInDirectory = docFilesInDirectory;
        if (cacheInfo){
            const cachePathShaMap = new Map<string, string>(cacheInfo.files.map(c => [c.path, c.sha]));
            changedDocsInDirectory = docFilesInDirectory.filter(f => f.sha !== cachePathShaMap.get(f.path));
        }
        const downloadedFileCacheInfos: Promise<FileCacheInfo | undefined>[] = [];
        for (const changedDocItem of changedDocsInDirectory) {
            const destinationFileUri = vscode.Uri.joinPath(this.docsDirectoryUri, directoryInfo.path, changedDocItem.path);
            const downloadUrl = path.posix.join(csharpDocsDownloadUrl, directoryInfo.path, changedDocItem.path);
            downloadedFileCacheInfos.push(fetch(downloadUrl).then(fileContents => {
                if (!fileContents.ok) {
                    console.log('error fetching ' + changedDocItem.path + ' from ' + downloadUrl);
                    return;
                }
                return fileContents.text().then(text =>
                    vscode.workspace.fs.writeFile(destinationFileUri, Buffer.from(text)).then(() => changedDocItem));
            }));
        }
        const successfulDownloadDirectoryCacheInfo = Promise.all(downloadedFileCacheInfos).then(info => {
            const successfulDownloads = info.filter(x => !!x);
            const directoryDownloadInfo: DirectoryCacheInfo = {path: directoryInfo.path, sha: directoryInfo.sha, files: successfulDownloads};
            return directoryDownloadInfo;
        });
        return successfulDownloadDirectoryCacheInfo;
    }

    private async writeDocsCacheInfoFile(newCacheInfo: DirectoryCacheInfo[], previousCacheInfo: DirectoryCacheInfo[]) {
        const allCachedDirectories = new Set([...newCacheInfo.map(c => c.path), ...previousCacheInfo.map(c => c.path)]);

        for (const directory of allCachedDirectories) {
            const newCacheDirectoryInfo = newCacheInfo.find(x => x.path === directory);
            const previousCacheDirectoryInfo = previousCacheInfo.find(x => x.path === directory);

            if (newCacheDirectoryInfo && previousCacheDirectoryInfo) {
                const newCacheInfoFilePathLookup = new Set(newCacheDirectoryInfo.files.map(x => x.path));
                const oldCacheInfoNotInNew = previousCacheDirectoryInfo.files.filter(x => !newCacheInfoFilePathLookup.has(x.path));
                newCacheDirectoryInfo.files = newCacheDirectoryInfo.files.concat(oldCacheInfoNotInNew);
            }
            else if (!newCacheDirectoryInfo && previousCacheDirectoryInfo){
                newCacheInfo.push(previousCacheDirectoryInfo);
            }
        }

        const cacheInfoString = JSON.stringify(newCacheInfo);
        await vscode.workspace.fs.writeFile(this.docsCacheInfoFileUri, Buffer.from(cacheInfoString));
    }

    private static async getDocFileData(docFilePath: string): Promise<DocFileData | undefined> {
        const docFile = await vscode.workspace.openTextDocument(docFilePath);
        if (docFile.languageId === 'markdown'){
            let yamlStart: vscode.Position | undefined = undefined;
            let yamlEnd: vscode.Position | undefined = undefined;

            for (let i = 0; i < docFile.lineCount; i++) {
                const line = docFile.lineAt(i);
                if (yamlStart === undefined){
                    if (line.text === '---'){
                        yamlStart = new vscode.Position(i+1,0);
                    }
                } else {
                    if (line.text === '---' || line.text === '...'){
                        yamlEnd = new vscode.Position(i, 0);
                    }
                }
            }

            if (yamlStart !== undefined && yamlEnd !== undefined){
                const yamlRange = new vscode.Range(yamlStart, yamlEnd);
                const mdDocFileData = yaml.load(docFile.getText(yamlRange), {json: true}) as DocFileData;
                const docsMdBodyRange = new vscode.Range(yamlEnd.translate(1,0), docFile.lineAt(docFile.lineCount - 1).range.end);
                if (docFile.validateRange(docsMdBodyRange)) {
                    mdDocFileData.mdBody = docFile.getText(docsMdBodyRange);
                }
                return mdDocFileData;
            }
        }
        else if (docFile.languageId === 'yaml'){
            return yaml.load(docFile.getText(), {json: true}) as DocFileData;
        }
    }
}