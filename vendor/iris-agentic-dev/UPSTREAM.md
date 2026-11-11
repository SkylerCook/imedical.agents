# Managed vendor build

- Upstream: https://github.com/intersystems-community/iris-agentic-dev
- Tag: `v1.5.0`
- Commit: `2b3e017b7fc73d6370fc1e89e7fa03f3de49a1a1`
- License: MIT, retained in [LICENSE](LICENSE).
- Local patch chain: [managed-sessions-v1.patch](patches/managed-sessions-v1.patch), [session-identity-v2.patch](patches/session-identity-v2.patch), [cookie-renewal-v3.patch](patches/cookie-renewal-v3.patch), then [startup-readiness-v4.patch](patches/startup-readiness-v4.patch).
- Catalog snapshots: `tools-full.json` (81), `tools-no-skills.json` (70), captured from the pinned upstream executable without a hospital connection.

The patch only enables changed behavior when `IRIS_MANAGED_NO_RETRIES=1`: no automatic generator replay, startup 401/403/503 stops further probing, generator query HTTP errors remain errors, and shutdown emits a redacted `IMEDICAL_LOGOUT` receipt. A successful logout HTTP response does not establish server session disappearance or license release.

The Windows build and actual localhost request-count test passed. Its complete SHA-256 and build identity are recorded in `managed-build.json`. A read-only call issued zero PUT requests; a generator 503 issued one PUT, then one acknowledged logout. This does not replace real project/host and server resource acceptance.

The portable build used Rust 1.92.0 Windows GNU, LLVM MinGW 20261020 MSVCRT for C compilation and final linking, and Rust's self-contained CRT libraries. Keep all tools task-local. Apply the patch to the fixed commit, then run `cargo rustc --locked --release --target x86_64-pc-windows-gnu -p iris-agentic-dev --bin iris-agentic-dev -- -C linker=<llvm-bin>/x86_64-w64-mingw32-clang.exe -C link-self-contained=yes -L native=<rust-target-lib>/self-contained -L native=<llvm-root>/x86_64-w64-mingw32/lib`. Set `CC_x86_64_pc_windows_gnu` and `AR_x86_64_pc_windows_gnu` to that portable compiler and llvm-ar. Earlier GNU linking of mixed LLVM objects built successfully but crashed at startup; compilation success alone is not qualification.

Managed mode also disables upstream durable telemetry: upstream telemetry implicitly deploys an `IrisDevTel` class and writes `^IRISDEV` in USER even after a read-only tool call. Neither a remote nor local durable telemetry write is allowed in this managed path. In-memory tool history remains upstream behavior.

Verification entry: `node --test scripts/tests/iris-session-vendor.tests.js`. It binds only localhost and checks actual generator PUT and logout counts. `IRIS_TEST_VENDOR_BINARY` may select a task-local build for this test; it is not a production connection override.

## Lifecycle patch v2

The incremental v2 patch preserves the upstream tool interface. Managed Atelier sends share an admission lock, remove Basic authentication once a session exists, and stop after lost/replaced cookies, scope changes, or an authentication identity change. Managed clients do not follow redirects. Cookie identity is opaque by default; the explicit `csp50-v1` option is only suitable for a separately verified target layout. Uncertainty prevents further sends and leaves cleanup unverified, even when a best-effort logout receives a response. Cookies and authorization headers remain in memory.

The v2 candidate is built on Windows MSVC with Rust 1.92.0 using `cargo +1.92.0 build --locked --release -p iris-agentic-dev --bin iris-agentic-dev`. Apply both patches, in order, to the pinned upstream commit. The workflow `.github/workflows/iris-vendor-build.yml` records the binary digest and tests the actual executable against localhost before uploading it. Run `41217745429` at framework commit `9654cf6d1aac9e9174adfc61ed979f2f4e7340a4` passed all eleven binary tests, including cookie lifecycle, identity switching, generator 503, startup 503 with/without a cookie, redirect rejection, and WebSocket handshake cookie reuse without repeated Basic authentication. Managed WebSocket bootstrap uses the shared cookie store, including when the server does not refresh Set-Cookie. Build provenance and the distributed binary digest must agree with `managed-build.json`; the earlier GNU recipe above documents the superseded v1 build.

Neither these simulations nor successful process shutdown prove a hospital session has disappeared or a License count has fallen. Those observations are not prerequisites for ordinary development calls.

## Cookie renewal patch v3

The historical v3 binary applied v3 after v1 and v2. Same-name/domain/path Cookie value renewal is accepted without an instance format setting; subsequent requests use the latest Cookie without Basic authentication. Cookie values are opaque tokens, not proof of a server-side License identity. Missing, deleted, expired or out-of-scope session cookies, changed account/target, and authentication failures still stop the affected call. Automatic replay and durable telemetry remain disabled. This replaces v2's token-comparison and `csp50-v1` behavior.

The distributed v3 executable was built locally from the pinned upstream commit with Rust 1.92.0 Windows GNU and LLVM MinGW 20261020 MSVCRT (clang 23.1.4). Rust's official `rustc`, `cargo`, `rust-std` and `rust-mingw` component archives were checksum-verified. The LLVM archive SHA-256 is `52a3e3f584a74c3cde8ceb0c6960549683178e03b36818cb02b7ed109a68ff67`. Build identity, normalized-LF patch digests and executable digest are in `managed-build.json`; this local build does not claim the historical v2 CI run as provenance.

Use task-local tools and apply all three patches in order. Set process-local `CARGO_HOME`, `RUSTC`, `CC_x86_64_pc_windows_gnu` and `AR_x86_64_pc_windows_gnu`. Put the portable Rust and LLVM `bin` directories on that process's PATH. Set `RUSTFLAGS` to `-C linker=<llvm-bin>/x86_64-w64-mingw32-clang.exe -C link-self-contained=yes -L native=<rust-target-lib>/self-contained -L native=<llvm-root>/x86_64-w64-mingw32/lib`, including host build scripts. Verify that the Rust self-contained directory contains `libgcc.a` and `libgcc_eh.a`, then run `cargo build --locked --release -p iris-agentic-dev --bin iris-agentic-dev`. Do not install or change the user's global toolchain.

The executable starts successfully and passes all 14 localhost vendor tests, including 100 successive SQL reads with rotating Cookie values and only one authentication, normal renewal without configuration, cookie loss/scope change, account isolation, WebSocket reuse and failure request counts. These local tests do not establish the cause or resolution of any hospital-specific error; deployment and live business verification remain separate.

## Startup readiness patch v4

The incremental `patches/startup-readiness-v4.patch` joins the initial discovery task before constructing the tool service. Upstream v1.5.0 otherwise snapshots the connection after two seconds and never applies a later successful discovery to that service. The real executable test delays localhost discovery beyond two seconds and requires a connected first `check_config` response. The distributed Windows MSVC build passed all 15 vendor tests in CI run 42963817212 at framework commit a064dc43d6a0781260156a86df1a0e56ba933c98. Its digest and fixed upstream/patch identity are recorded in `managed-build.json`.


The build retains all v1/v2/v3 protections and tool schemas. The deployment requires matching runtime and metadata. No project connection fields are embedded in the executable.
