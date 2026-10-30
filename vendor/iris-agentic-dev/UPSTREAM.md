# Managed vendor build

- Upstream: https://github.com/intersystems-community/iris-agentic-dev
- Tag: `v1.5.0`
- Commit: `2b3e017b7fc73d6370fc1e89e7fa03f3de49a1a1`
- License: MIT, retained in [LICENSE](LICENSE).
- Local patch: [managed-sessions-v1.patch](patches/managed-sessions-v1.patch).
- Catalog snapshots: `tools-full.json` (81), `tools-no-skills.json` (70), captured from the pinned upstream executable without a hospital connection.

The patch only enables changed behavior when `IRIS_MANAGED_NO_RETRIES=1`: no automatic generator replay, startup 401/403/503 stops further probing, generator query HTTP errors remain errors, and shutdown emits a redacted `IMEDICAL_LOGOUT` receipt. A successful logout HTTP response does not establish server session disappearance or license release.

The Windows build and actual localhost request-count test passed. Its complete SHA-256 and build identity are recorded in `managed-build.json`. A read-only call issued zero PUT requests; a generator 503 issued one PUT, then one acknowledged logout. This does not replace real project/host and server resource acceptance.

The portable build used Rust 1.92.0 Windows GNU, LLVM MinGW 20261020 MSVCRT for C compilation and final linking, and Rust's self-contained CRT libraries. Keep all tools task-local. Apply the patch to the fixed commit, then run `cargo rustc --locked --release --target x86_64-pc-windows-gnu -p iris-agentic-dev --bin iris-agentic-dev -- -C linker=<llvm-bin>/x86_64-w64-mingw32-clang.exe -C link-self-contained=yes -L native=<rust-target-lib>/self-contained -L native=<llvm-root>/x86_64-w64-mingw32/lib`. Set `CC_x86_64_pc_windows_gnu` and `AR_x86_64_pc_windows_gnu` to that portable compiler and llvm-ar. Earlier GNU linking of mixed LLVM objects built successfully but crashed at startup; compilation success alone is not qualification.

Managed mode also disables upstream durable telemetry: upstream telemetry implicitly deploys an `IrisDevTel` class and writes `^IRISDEV` in USER even after a read-only tool call. Neither a remote nor local durable telemetry write is allowed in this managed path. In-memory tool history remains upstream behavior.

Verification entry: `node --test scripts/tests/iris-session-vendor.tests.js`. It binds only localhost and checks actual generator PUT and logout counts. `IRIS_TEST_VENDOR_BINARY` may select a task-local build for this test; it is not a production connection override.
