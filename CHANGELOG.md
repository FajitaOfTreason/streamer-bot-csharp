# Changelog

All notable changes to the "streamer-bot-csharp" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

### [unreleased]

### Changed

- Removed comments surrounding preprocessor directives in new file snippet
- Switched folding ranges from `language-configuration` regex to `vscode.FoldingRangeProvider` to allow folding based on surrounding line content
  - Remove `defaultFoldingRangeProvider` if set to this extension, as the setting prevents merging folding ranges when `FoldingRangeProvider` is used

## [1.0.0] - 2025-10-19

### Added

- Initial extension version to be released on Visual Studio Marketplace

[unreleased]: https://github.com/FajitaOfTreason/streamer-bot-csharp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/FajitaOfTreason/streamer-bot-csharp/releases/tag/v1.0.0