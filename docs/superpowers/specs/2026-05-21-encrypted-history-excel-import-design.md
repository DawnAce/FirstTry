# Encrypted History Excel Import Design

## Context

Users may upload password-protected Excel files when importing historical print reports. A recent sample file fails direct `openpyxl` loading with `BadZipFile: File is not a zip file`; its file signature is `D0 CF 11 E0 A1 B1 1A E1`, and `msoffcrypto` identifies it as an encrypted OOXML workbook. After decrypting in memory with the supplied password, `openpyxl` can read the workbook normally.

The first supported surface is the existing historical print report import page. Other Excel import surfaces remain unchanged until there is a concrete need to expand support.

## Goals

- Allow the historical print report import flow to accept ordinary `.xlsx` files and encrypted OOXML Excel files.
- Let the user enter a password at upload time when a workbook is protected.
- Keep passwords transient: never store them in code, database records, files, logs, templates, skills, or fixed mappings.
- Reuse the existing history import parser after decryption so ordinary and encrypted files follow the same validation and commit path.
- Return clear errors for missing or incorrect passwords.

## Non-goals

- Supporting every Excel-like format or legacy binary `.xls` parsing.
- Adding password support to all import/export flows in this change.
- Persisting user passwords for future imports.
- Changing the history import template format or the commit semantics.

## Proposed approach

Add a backend workbook-loading helper for the history import service:

1. Try `openpyxl.load_workbook()` directly for ordinary `.xlsx` uploads.
2. If loading fails because the file is not a zip/open workbook, inspect it with `msoffcrypto`.
3. If the file is encrypted and no password was supplied, return a validation error asking the user to enter a password.
4. If a password was supplied, decrypt the workbook into an in-memory `BytesIO` buffer.
5. Load the decrypted stream with `openpyxl` and continue through the existing parser.

The frontend adds an optional password input on the historical print report import page. The password is included only in the multipart preview request and is not stored in browser state beyond the current form interaction.

## Data flow

1. User selects the historical report Excel file.
2. User optionally enters the workbook password.
3. Frontend submits the file and password to the existing preview endpoint.
4. Backend loads the workbook through the new helper.
5. Existing parsing and validation produce the preview.
6. Existing commit behavior remains unchanged; no password is needed during commit because parsed preview data is cached by import session.

## Error handling

- Ordinary invalid Excel file: keep the existing "cannot parse .xlsx" style error.
- Encrypted workbook without a password: return a 422 validation error explaining that the file is password-protected and needs a password.
- Wrong password: return a 422 validation error explaining that the password is incorrect or the file cannot be decrypted.
- Unsupported encrypted/non-OOXML file: return a 422 validation error explaining that the file format is unsupported.

Errors must not include the supplied password.

## Dependencies

Add `msoffcrypto-tool` to backend requirements so encrypted OOXML workbooks can be decrypted before parsing.

## Testing

- Unit test ordinary unencrypted history import still parses.
- Unit test encrypted OOXML sample can be decrypted with the correct password and then parsed.
- Unit test encrypted workbook without a password returns the expected validation error.
- Unit test encrypted workbook with a wrong password returns the expected validation error.
- Run backend tests affected by history import and frontend type checking for the password field changes.

## Documentation

- Update user-facing documentation to mention that historical print report import supports password-protected Excel files by entering the password during upload.
- Update technical documentation to describe in-memory decryption and the no-password-persistence rule.
