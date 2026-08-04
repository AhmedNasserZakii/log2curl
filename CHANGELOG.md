# Changelog

All notable changes to the "log2curl" extension will be documented in this file.

## [0.0.3] - 2026-08-04

- Added support for PrettyDioLogger's box-formatted request lines, including `Request ║ GET`.
- Added support for `╔ Headers` sections and `╟ Key: Value` header entries.
- Fixed wrapped `Authorization` bearer tokens and other multiline header values.
- Prevented headers from a following request from being merged into the current request.
- Added regression coverage for complete cURL generation from consecutive PrettyDioLogger requests.

## [0.0.2] - 2026-02-12

- Added the extension icon, repository metadata, license, and expanded documentation.
- Improved extension packaging and publishing configuration.

## [0.0.1] - 2026-02-11

- Initial release with URL, method, token, body, and custom-header extraction.
- Added log-style JSON normalization and cURL generation.
