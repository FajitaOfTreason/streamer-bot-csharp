import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as myExtension from '../extension';
import * as path from "path";
import { memoryUsage } from 'process';

const newFileDir = 'src';
const workspacePath = vscode.workspace.workspaceFolders![0].uri.fsPath.replaceAll(path.win32.sep, path.posix.sep);
suite('Get CS Relative Path', () => {
	test('Add newFileDir to relative new cs filename', () => { assert.strictEqual(myExtension.getNewCsFileRelativePath(newFileDir, 'Action.cs'), 'src/Action.cs'); });
	test('Add extension to extensionless filename', () => { assert.strictEqual(myExtension.getNewCsFileRelativePath(newFileDir, 'Action'), 'src/Action.cs'); });
	test('Add specified subdir to relative new cs filename', () => { assert.strictEqual(myExtension.getNewCsFileRelativePath(newFileDir, 'subdir/Action.cs'), 'src/subdir/Action.cs'); });
	test('Respect absolute path override in new cs filename', () => { assert.strictEqual(myExtension.getNewCsFileRelativePath(newFileDir, '/Action.cs'), '/Action.cs'); });
	test('Capitalise new cs filename', () => { assert.strictEqual(myExtension.getNewCsFileRelativePath(newFileDir, 'action.cs'), 'src/Action.cs'); });
	test('Capitalise new cs filename with empty base path', () => { assert.strictEqual(myExtension.getNewCsFileRelativePath('', 'action.cs'), 'Action.cs'); });
	test('Capitalise new cs filename with absolute path', () => { assert.strictEqual(myExtension.getNewCsFileRelativePath(newFileDir, '/action.cs'), '/Action.cs'); });
	test('Convert spaces to CamelCase', () => { assert.strictEqual(myExtension.getNewCsFileRelativePath(newFileDir, 'action name'), 'src/ActionName.cs'); });
	test('Convert spaces to CamelCase with absolute path', () => { assert.strictEqual(myExtension.getNewCsFileRelativePath(newFileDir, '/action name'), '/ActionName.cs'); });
	test('Convert spaces to CamelCase in filename only, leaving spaces in relative path', () => { assert.strictEqual(myExtension.getNewCsFileRelativePath(newFileDir, 'path with spaces/action name'), 'src/path with spaces/ActionName.cs'); });
	test('Directory names can not start or end with a space', () => { assert.strictEqual(myExtension.getNewCsFileRelativePath(newFileDir, ' some/ part of / path /ActionName'), 'src/some/part of/path/ActionName.cs'); });
});
suite('New File Input Validation', () => {
	test('input with cs extension',async () => { assert.strictEqual((await myExtension.validateNewFile(newFileDir, 'action.cs'))?.severity, vscode.InputBoxValidationSeverity.Info); });
	test('input without extension',async () => { assert.strictEqual((await myExtension.validateNewFile(newFileDir, 'action'))?.severity, vscode.InputBoxValidationSeverity.Info); });
	test('input with slash at end should assume filename not yet entered',async () => { assert.strictEqual((await myExtension.validateNewFile(newFileDir, 'directory/'))?.message, "Enter filename"); });
	test('input with backslash at end should assume filename not yet entered',async () => { assert.strictEqual((await myExtension.validateNewFile(newFileDir, 'directory\\'))?.message, "Enter filename"); });
	test('input with non cs extension',async () => { assert.strictEqual((await myExtension.validateNewFile(newFileDir, 'action.c'))?.severity, vscode.InputBoxValidationSeverity.Error); });
	test('input spaces in filename',async () => { assert.strictEqual((await myExtension.validateNewFile(newFileDir, 'action name with spaces'))?.severity, vscode.InputBoxValidationSeverity.Info); });
	test('input spaces in directory and filename',async () => { assert.strictEqual((await myExtension.validateNewFile(newFileDir, 'directory with spaces/action name with spaces'))?.severity, vscode.InputBoxValidationSeverity.Info); });
});
suite('Get New File Dir Removes Slashes at Ends', () => {
	test('newfiledir with no slashes unchanged', async () => { await vscode.workspace.getConfiguration('streamer-bot-csharp').update('newFileDir', 'src'); assert.strictEqual(myExtension.getNewFileDir(), 'src'); });
	test('newfiledir gets spaces trimmed', async () => { await vscode.workspace.getConfiguration('streamer-bot-csharp').update('newFileDir', ' src '); assert.strictEqual(myExtension.getNewFileDir(), 'src'); });
	test('slash at end', async () => { await vscode.workspace.getConfiguration('streamer-bot-csharp').update('newFileDir', 'src/'); assert.strictEqual(myExtension.getNewFileDir(), 'src'); });
	test('slash at start', async () => { await vscode.workspace.getConfiguration('streamer-bot-csharp').update('newFileDir', '/src'); assert.strictEqual(myExtension.getNewFileDir(), 'src'); });
	test('slash in middle not removed', async () => { await vscode.workspace.getConfiguration('streamer-bot-csharp').update('newFileDir', '/src/dir/'); assert.strictEqual(myExtension.getNewFileDir(), 'src/dir'); });
	test('root path slash removed', async () => { await vscode.workspace.getConfiguration('streamer-bot-csharp').update('newFileDir', '/'); assert.strictEqual(myExtension.getNewFileDir(), ''); });
	() => vscode.workspace.getConfiguration('streamer-bot-csharp').update('newFileDir', undefined);
});
suite('Get Directory Relative to New File Dir', () => {
	test('no uri provided', async () => { assert.strictEqual(await myExtension.getDirPathRelativeToNewFileDir(workspacePath, 'src', undefined), undefined); });
	test('path same as new file dir', async () => { assert.strictEqual(await myExtension.getDirPathRelativeToNewFileDir(workspacePath, 'src', vscode.Uri.file(path.join(workspacePath, 'src'))), ''); });
	test('path inside new file dir', async () => { assert.strictEqual(await myExtension.getDirPathRelativeToNewFileDir(workspacePath, 'src', vscode.Uri.file(path.join(workspacePath, 'src', 'testDirectory'))), 'testDirectory/'); });
	test('file path in directory inside new file dir', async () => { assert.strictEqual(await myExtension.getDirPathRelativeToNewFileDir(workspacePath, 'src', vscode.Uri.file(path.join(workspacePath, 'src', 'testDirectory', 'testFile.txt'))), 'testDirectory/'); });
	test('file path inside new file dir', async () => { assert.strictEqual(await myExtension.getDirPathRelativeToNewFileDir(workspacePath, 'src', vscode.Uri.file(path.join(workspacePath, 'src', 'testFile.txt'))), ''); });
	test('base workspace path', async () => { assert.strictEqual(await myExtension.getDirPathRelativeToNewFileDir(workspacePath, 'src', vscode.workspace.workspaceFolders![0].uri), '/'); });
});
suite('Get Streamerbot Project File and Root Path', () => {
	test("Non-Streamerbot Project File Returns Undefined", async () => { assert.strictEqual(await myExtension.getSbProjectRootPath('*.csproj.notsb.xml'), undefined); });
	test("Streamerbot Project File", async () => { assert.strictEqual(await myExtension.getSbProjectRootPath('*.csproj.sb.xml'), workspacePath); });
	test("Streamerbot Project File with Conditioned StreamerBotPath", async () => { assert.strictEqual(await myExtension.getSbProjectRootPath('*.csproj.sbconditioned.xml'), workspacePath); });
});
