# Managed vendor build

- Upstream: https://github.com/intersystems-community/iris-agentic-dev
- Tag: v1.7.1
- Commit: 4e0b2d8a86f9e5ffa9e077f7a524b58cd219988a
- License: MIT, retained in [LICENSE](LICENSE).
- Active patch: [managed-sessions-v6.patch](patches/managed-sessions-v6.patch), applied directly to the fixed upstream commit. Earlier v1–v5 patches targeted 1.5.0 and are superseded.
- Binary and normalized-LF patch SHA-256: [managed-build.json](managed-build.json).
- Catalogs: tools-no-skills.json (70) and tools-full.json (81), captured without a business connection.

## Managed behavior

The local changes are active only with IRIS_MANAGED_NO_RETRIES=1. They disable generator replay and all durable telemetry, await startup discovery before snapshotting the connection, serialize guarded Atelier sends, reject missing/expired/out-of-scope cookies and authentication changes, accept normal same-name/domain/path cookie renewal, reuse cookies for WebSocket bootstrap without repeating Basic authentication, and emit redacted logout receipts plus monotonically increasing HTTP dispatch counts.

Upstream 1.7.1 already isolates primary account cookie jars and disables IRIS redirects. The patch reuses those stores, TLS policy and the upstream compile, trust and identity gates. Managed startup uses the primary store rather than a disposable probe store so the first authenticated session is the one subsequent calls use. A managed endpoint's authentication change stops sends instead of joining identities. Dedicated credential probes retain their private jars; their dispatches are counted, and a failed probe does not stop the primary session. No credential or cookie is embedded in a log or build file.

IMEDICAL_LOGOUT reports attempted requests, acknowledged replies and local completion. A successful reply or process exit does not prove that an IRIS session disappeared or a License count fell. These observations are not prerequisites for normal development.

## Rebuild

The distributed executable was built locally with Rust 1.92.0 Windows GNU and LLVM MinGW 20261020 MSVCRT (clang 23.1.4), using the fixed upstream Cargo.lock. The Rust rustc, cargo, rust-std and rust-mingw component archives were checked against the official channel-rust-1.92.0.toml SHA-256 entries. The LLVM archive SHA-256 is 52a3e3f584a74c3cde8ceb0c6960549683178e03b36818cb02b7ed109a68ff67. Public mirror downloads were accepted only after matching these official digests.

Keep tools, Cargo state and source under a task-specific temporary root. Apply v6 with core.autocrlf=false and normalize Rust source to LF. Set process-local CARGO_HOME and RUSTC; prepend the portable Rust and LLVM bin directories to this process's PATH. Set CC_x86_64_pc_windows_gnu to LLVM's x86_64-w64-mingw32-clang.exe and AR_x86_64_pc_windows_gnu to llvm-ar.exe. Set RUSTFLAGS to:

~~~text
-C linker=<llvm-bin>/x86_64-w64-mingw32-clang.exe -C link-self-contained=yes -L native=<rust-root>/lib/rustlib/x86_64-pc-windows-gnu/lib/self-contained -L native=<llvm-root>/x86_64-w64-mingw32/lib
~~~

Verify libgcc.a and libgcc_eh.a exist under the self-contained directory, then run cargo build --locked --release -p iris-agentic-dev --bin iris-agentic-dev. Do not add --target to this native GNU command: Cargo would then leave host build scripts without these RUSTFLAGS. The source repository's .github/workflows/iris-vendor-build.yml is the separate MSVC CI recipe; it is not the provenance of this local GNU executable.

## Verification

The candidate passed 16 actual localhost session tests, five additional upgrade tests, and nine migration/rollback tests including Windows PowerShell 5.1 and Overlay. Coverage includes rotating cookies across 100 reads, zero repeated authentication, failed generator request counts, stopped startup probes, slow discovery, expired-session pre-send rejection, WebSocket reuse, normal routine upload/compile, invalid namespace and compile-time execution refusal, untrusted write settings, and strict read-only behavior.

The v6 patch was separately applied to pristine v1.7.1 source; after explicit LF normalization all 22 changed files matched the build input byte for byte. Source compilation emitted an upstream unused-variable warning in server_manager.rs; no source change was made for it.

Run node --test scripts/tests/iris-session-vendor.tests.js scripts/tests/iris-vendor-upgrade.tests.js from the framework repository. IRIS_TEST_VENDOR_BINARY can select a task-local candidate. These tests bind only localhost. Real IRIS class/include/superclass behavior, hospital resources, business copies and non-Windows platforms require their own acceptance and are not claimed here.
