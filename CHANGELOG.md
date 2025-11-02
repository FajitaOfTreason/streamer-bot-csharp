# Changelog

All notable changes to the "streamer-bot-csharp" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

### [unreleased]

### Added

- Provides hover info for CPH methods from markdown files in csharp section of Streamer.bot's docs repository
- Adds link in hover to Streamer.bot docs web page for CPH method whether or not markdown file exists
- Fetches shas from Streamer.bot's docs repository on GitHub via content and trees apis, and downloads missing or out of date documentation
  - Only gets shas for files if the directory sha has changed, therefore only one API call will be done if no changes have occured.

### Changed

- Removed comments surrounding preprocessor directives in new file snippet
- Switched folding ranges from `language-configuration` regex to `vscode.FoldingRangeProvider` to allow folding based on surrounding line content
  - Remove `defaultFoldingRangeProvider` if set to this extension, as the setting prevents merging folding ranges when `FoldingRangeProvider` is used

## [1.0.0] - 2025-10-19

### Added

- Initial extension version to be released on Visual Studio Marketplace

[unreleased]: https://github.com/FajitaOfTreason/streamer-bot-csharp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/FajitaOfTreason/streamer-bot-csharp/releases/tag/v1.0.0