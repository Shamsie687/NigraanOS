# Current synchronization note — 17 October 2026

The MIT license and creator credits were approved and merged separately; LICENSE and third-party notices are not drafts. The historical 67-file inventory below retains its original proposal boundaries. The current 29-file judge-renewal synchronization uses [judge-renewal-release-manifest.json](judge-renewal-release-manifest.json), canonical LF hashes, and the same secret/path guards. Migration 020 and compatible MCP, notification worker and frontend are already deployed; source publication must not replay migrations/deployments. Immediate twelve-hour judge acceptance passed, with private-browser observations attributed to the user; genuine expiry and November Gmail readiness remain pending.

Current reproduction: [SOURCE_RELEASE_SETUP.md](SOURCE_RELEASE_SETUP.md). Preserve the `[skip netlify]` marker in pushed commits, PR title and final merge/squash message so source synchronization does not replace the verified manual frontend release. Private recovery packages, real account identities and incident records are never source inputs. All text below is historical evidence, including the former unapproved license and old open gates.

---

# Source-release reconciliation — 15 October 2026

Review-only branch: `codex/hackathon-source-release`, based on fetched main `b8c7c4bed089138c38e4d2a285cf2d5ff0f0edba`. Both previous frontend PRs are included in that base. Creating the branch preserved the entire prior working diff and untracked files; the separate main worktree was not modified. Nothing is staged or committed.

## Exact proposal

The authoritative allowlist is [source-release-manifest.json](source-release-manifest.json). It enumerates each proposed changed/new file, excluding LICENSE pending owner approval. Files already on main but unchanged (all existing frontend, shared projections, core MCP/state adapters, infra, historical migrations and legacy functions) remain part of the release without being duplicated in this proposal.

| Gap on main | Proposed reconciliation |
| --- | --- |
| Current MCP session deadline enforcement missing | Existing local oauth.ts/supabaseAdapter.ts changes, their adapter/helper updates and both judge expiry test files. No new backend capability was invented. |
| Judge DB/RPC source missing | Exact prepared 015–019 files, untouched during this task; original 018 is retained for provenance and existing-project hardening only. |
| Judge Edge Functions missing | Existing evidence proxy and Gmail worker source; explicit internal-auth configuration added to config.toml, matching documented deployed `--no-verify-jwt` behavior. This does not redeploy anything. |
| Private administrator setup undocumented in repo | UUID-placeholder bootstrap/verification templates, plus the already tracked guarded permanent-approval script. No email-specific approval script or real UUID included. |
| Gmail sender authorization/setup missing | Existing send-only, DPAPI local authorization helper and setup documentation. No credential/token files. |
| Fresh DB setup incomplete | Existing guarded 000–013 foundation, plus documented 015/016/017/019 suffix. Fresh baseline now adds an invoker-only pinned timestamp helper for timestamp behavior. 018 is intentionally not run on this distinct fresh helper. This is a new fresh-project adapter, not a claimed clone of original live DDL. |
| SQL tests relied on ignored folders | Pinned PGlite 0.5.8 root dev dependency and lockfile; test imports resolve normally after npm ci. No cleanup folder, node_modules or private schema capture is needed for default validation. Rollup WASM override preserved. |
| Setup/judge docs outdated | Current fresh-clone checklist, judge self-activation/expiry instructions and current-status notices distinguishing historical engineering/deployment instructions. |
| Public license missing | MIT LICENSE prepared as an unapproved local draft. Owner chose pending review; excluded from allowlist and no commitment of rights is inferred. |

## Safety and provenance

No original or M4E hosted access, SQL replay, AWS changes, emails, secret transfer, webhooks, GitHub writes, deploys or commits occurred. Production statements are owner-reported; local code was not compared against downloaded hosted artifacts in this phase. Original migration 015–019 checksums are unchanged from the start of this phase. Fresh baseline support changes do not affect an existing production project because that file is outside migrations and requires empty managed Auth/Storage/public state.

Excluded: docs/cleanup-prep, all private backups/manifests/schema captures, acceptance scratch files, review artifacts, .env and credentials, node_modules, dist, .aws-sam, owner-email-specific approval SQL and unrelated documentation. The manifest is an allowlist, not instructions to stage everything in the worktree. `.env.example` contains placeholders only.

The original-project historical preflight/postchecks must not be blindly run as a new deployment plan after 019. Use current 019 postcheck for that contract and require separately authorized live inspection. New clone setup does not create users, seed incidents, contact hosted services or execute any remote action automatically.

## Validation and outstanding review

Final validation completed 16 October 2026:

- Fresh source export made from main plus exactly the proposal, with no .env, private folders, cleanup runtime or generated artifacts; clean root and MCP `npm ci` succeeded. Git provenance assertions read original Git history, which a normal full clone supplies. This was an allowlisted export check, not a GitHub clone of an unpublished commit.
- Export application suite: **297/297 PASS**; MCP suite: **72/72 PASS**; MCP typecheck and frontend production build: **PASS**. Structural infrastructure validation also passed locally; this is not an AWS deployment.
- Eleven synthetic migration suites passed. Historical judge suite: **44** assertions; activated-session suite: **38**; fresh-baseline full sequence: **24**. Thirteen render suites passed. Reviewer self-test: **16** assertions; original 018 compatibility suite: **13**, using only the existing locally reviewed private timestamp snapshot as input, never copying it into the release.
- Exact allowlist, high-confidence secret-pattern scan, local Markdown links, ignored-runtime dependency checks and whitespace checks passed. No backend credentials or generated build outputs are in the proposal.
- Two initial test failures were corrected without weakening authorization: the baseline's old blanket no-trigger assertion now allows exactly its two public timestamp triggers and still forbids Auth/Storage triggers; an MCP expiry test now advances its injected clock to the actual stored OAuth-code deadline, eliminating a wall-clock/injected-clock timing assumption.
- The export launcher initially caused synthetic DPAPI failure through case-duplicated inherited PowerShell module-path variables. A focused comparison isolated that launcher issue; removing only its inherited module-path override resolved it. The shipped OAuth helper and real credentials were not changed. Final complete export checks passed.

Synthetic SQL validates application DDL/RLS/RPC behavior on managed-service stubs; it cannot prove hosted Auth/Storage internals, provider delivery, AWS provisioning, Realtime or independent concurrent connections. Docker/native concurrency was not repeated. Original 018 targets a legacy definition/ACL; its dedicated synthetic test accepts an optional private reviewed snapshot, not a distributable backup. Do not infer complete fresh hosted parity from fixture tests. Existing Vite bundle-size/annotation warnings remain non-blocking.

Open gates: owner license approval; fresh hosted acceptance under separate approval; November reviewer-access arrangement; durable Gmail authorization beyond Testing's seven days; credentials and deployment permissions supplied privately. These gates do not justify publishing secrets, relaxing RLS or inventing an Alexa+ connection.

## Commit/PR plan — not executed

1. Review the exact manifest and diffs; retain unrelated working changes. LICENSE stays excluded until separately approved.
2. Confirm current remote main again before the eventual commit. Stop on unexpected divergence; never reset/stash/clean or overwrite local work.
3. Stage only manifest files, inspect staged names/diff/whitespace and secret scan. Create the source-release commit only after owner approval of this phase. Do not use `git add .`.
4. A subsequent separately authorized push/PR targets main. Describe deployed-source reconciliation, the fresh baseline's explicit differences and validation limits. A merge can trigger Netlify automatically; review its env/build/rollback state first. No migration or backend deployment is required simply to publish already deployed source.
5. Verify the public clone contains every manifest file and can run the documented local checks, without private folders. Commit a separately approved license before claiming the public repository is open source/submission-ready.

## LF integrity correction — 16 October 2026

The original proposal hashed raw Windows checkout bytes, so 47 staged Git blobs differed after Git CRLF normalization. Both verifiers now share byte-preserving CRLF-to-LF hashing, require exact hash inventories, and reject unsupported normalization. Regenerated manifests must match the staged blobs directly. Regression checks cover both checkout endings, corruption, missing hashes, BOMs, lone CR and non-UTF-8 bytes. The final validation uses an export of index blobs, replacing the earlier working-file-overlay export as portability evidence. Release scope remains 67 files; LICENSE remains excluded. No commit or deployment is authorized by this correction.

Canonical Git-index export validation: 299/299 application tests, 72/72 MCP tests, 11 synthetic SQL suites, 13 render suites, MCP typecheck, infrastructure structural checks, frontend build and schema-reviewer self-test passed. Eight verifier scenarios additionally accepted LF/CRLF copies and rejected corruption, missing/extra/wrong hashes and unknown normalization. All 66 source digests and all 26 foundation digests matched staged Git blobs directly. Clean dependency installation used npm ci --ignore-scripts; root npm reported one moderate and one high dependency advisory (not remediated in this integrity-only change), while MCP reported none. Existing Vite size/annotation warnings remain. No hosted acceptance or production modification was performed.
