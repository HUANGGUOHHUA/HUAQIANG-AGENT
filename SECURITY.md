# Security

## Reporting

If you find a security issue, do not open a public issue with exploit details. Contact the project maintainer privately and include:

- affected version
- reproduction steps
- expected and actual behavior
- any relevant logs with secrets removed

## Local data

- API keys are encrypted with Electron `safeStorage` (Windows DPAPI).
- MCP environment variables and headers are stored in local `settings.json` in plain text.
- Session files may contain source code, command output and file paths. Do not commit `.dev-profile/` or installed `profile/` directories.
- The portable `runtime/` directory is generated and ignored by Git.

## Distribution

Public releases should be signed with an OV/EV code-signing certificate. The development certificate used during local builds is self-signed and is not trusted by default on other computers.
