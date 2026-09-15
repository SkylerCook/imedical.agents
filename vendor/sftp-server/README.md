# SFTP runtime

Framework-maintained, AI-assisted Python runtime for `coding-iris-plugin`. Source provenance is recorded in [NOTICE.md](NOTICE.md). Retains `sync_directory`, `upload_file`, `read_remote_file`, `list_remote_directory`, and `execute_remote_command`. No credentials, interpreter binaries or project mappings are distributed.

## Install and check

Python >=3.10 is required only on the development machine. Direct dependencies are pinned in `requirements.txt`; the universal transitive `requirements.lock` includes package hashes. Install explicitly into a dedicated virtual environment; the framework updater does not run pip or download Python:

```text
python -m venv <runtime-env>
<runtime-python> -m pip install --require-hashes -r .agents/vendor/sftp-server/requirements.lock
<runtime-python> -B .agents/vendor/sftp-server/src/main.py --check
```

`--check` checks imports and reports versions without contacting a server. Set the project's SFTP `command` to that interpreter. Keep its virtual environment outside the capability checkout. For offline sites, prepare a wheelhouse for the target Python/OS using the lock file, then install with `--no-index --find-links <wheelhouse>`; wheelhouses are not bundled.

## Configuration

Private `.mcp.json` environment fields:

| Field | Meaning |
|---|---|
| `TARGET_HOST`, `TARGET_PORT`, `TARGET_USERNAME` | Existing SSH connection; port defaults to 22 |
| `TARGET_PASSWORD` / `TARGET_KEY_FILE` | Password or explicit private key; agent/key discovery is disabled |
| `TARGET_KNOWN_HOSTS` | Optional dedicated known_hosts file; when supplied it replaces system trust for this session |
| `LOCAL_PATH`, `REMOTE_PATH` | Required local source root and absolute POSIX remote root |
| `IGNORE_PATTERNS` | JSON string array; invalid values stop the operation |
| `ALLOW_REMOTE_COMMANDS` | Only literal `true` enables SSH commands; default disabled |

Without a dedicated trust file, system known_hosts is used. Unknown or changed keys are rejected. Verify fingerprints through a trusted channel; do not silently trust a key or rewrite global known_hosts. SSH commands require a POSIX shell and are not confined by the SFTP roots; normal upload, listing and reading do not require command execution.

## Transfer contract

- Windows ignore paths are normalized, ignored directories pruned, directory sync skips symlinks. Real local paths must remain within LOCAL_PATH; remote paths must remain within REMOTE_PATH. Remote symlink components are rejected. The remote tree must not be changed concurrently by an untrusted writer: SFTP path checks cannot eliminate server-side rename races.
- `upload_file` always transfers to an exclusively created sibling temporary file, reads it back for SHA-256 verification, then uses `posix-rename` for atomic replacement. Existing POSIX permission bits are retained; ownership/ACL/extended attributes are not copied. New files follow the server's creation policy. Environments requiring owner/ACL preservation need a separately validated deployment method.
- Servers without `posix-rename` fail explicitly. There is no delete-first or direct-overwrite fallback. A failed transfer removes only its own temporary file; cleanup failure is reported. Transport loss can leave outcome uncertain: read back before deciding what to do, never blindly retry a write.
- `sync_directory` defaults to `compare: sha256`; `mtime-size` compares size and whole-second timestamp; `always` uploads all selected files. `dry_run: true` performs remote reads only. It never deletes remote extras. A per-file error produces `partial-failure` and MCP `isError: true`; previously completed files are not rolled back.
- Reads support offset/limit (bytes), empty files, and a 16 MiB hard per-call limit. Output text is decoded with replacement; use raw byte digests for deployment integrity checks.
- SSH output is drained from both channels before collecting exit status, with an 8 MiB cap and a bounded deadline. Closing a timed-out channel does not prove the remote command stopped.
- Shared connections are serialized in a worker thread; disconnect/error cleanup is explicit. Cancellation waits for a started operation to finish before releasing its connection lock.

## Adoption and compatibility

New project templates default to SFTP **disabled**, with `sftp.runtime: vendor` ready for explicit configuration. `sync-env-config.js` resolves the vendor script from CapabilityRoot, including workspace overlays. Existing runtimes remain unchanged unless the project explicitly sets `sftp.enabled: true` and `sftp.runtime: vendor`.

After preparing dependencies and verified host keys, set that opt-in in private `project-env.json`, then run the normal updater's DryRun/Write cycle. Its `sftp-vendor-v1` migration changes only the known single `sftp-server/src/main.py` argument in `.mcp.json`; custom arguments require manual review. Interpreter, credentials, other environment fields, disabled state and other servers are preserved. The existing `scriptPath` is ignored when runtime is vendor; set `runtime: custom` to retain an external runtime. No business project is migrated merely by updating this source repository.

This runtime still requires SSH/SFTP. It does not implement an HTTP/Atelier upload fallback.

## Validation

```text
python -B -m unittest discover -s vendor/sftp-server/tests -v
node --test plugins/coding-iris-plugin/scripts/iris-tools/tests/sftp-config.test.js
```

Offline tests cover failed atomic writes, cleanup, path boundaries, Windows ignores, content comparison, schema/stdio errors, host trust precedence and configuration preservation. CI declares Windows/macOS/Linux and Python 3.10/3.13; a local Windows run does not prove that entire matrix passed. Real server success applies only to the tested environment, not every SFTP server or HIS business workflow.

## 固定部署工作进程

`src/upload-batch.py` 是插件 `deploy-frontend.js` 的私有 stdio 工作进程，复用同一连接，按清单比较/上传/回读，失败停止。调用方不应直接生成替代脚本。`TARGET_HOST_KEY_SHA256` 支持显式 SHA256 指纹校验，不持久化；与 `TARGET_KNOWN_HOSTS` 互斥。指纹模式不读取系统信任库，匹配失败在认证前拒绝连接。
