---
name: iris_external_reg_index
description: Third-party appointment registration interface workflow boundaries for IRIS RegInterface work.
---

# IRIS External Registration Index

Use `skills/iris-external-reg/SKILL.md` when the task involves third-party appointment registration integrations, `DHCDoc.Interface.Outside.RegInterface`, `DHCExternalService.RegInterface`, provincial appointment platform requests, or the `/external-reg` shortcut.

Core boundaries:

- Source document parsing must use `extract-doc`; do not paste full converted documents into conversation context.
- Execution plans must be confirmed by the user before ObjectScript implementation starts.
- Unconfirmed Global slices, status codes, hospital mapping, data-source ownership, and multi-hospital filtering must stay as TODO items until confirmed.
- ObjectScript coding, upload, compile, deployment, and remote verification must use `coding-iris-plugin` rules and explicit user authorization.
- Do not write server addresses, accounts, passwords, tokens, namespace values, remote paths, or private connection facts into this plugin.
