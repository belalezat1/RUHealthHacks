# Audit evidence

The [engineering report](../engineering-audit.md) explains scope, findings, commands and limitations. All inputs and credentials used for verification were synthetic or server-side; the API key is not included here.

- `branches.json`: pinned commit inventory and tracked paths; Zaib is a separate requested repository/branch.
- `ray-tests-pg.xml`, `ray-tests-frozen.xml`: 70 tests passed on real isolated PostgreSQL; the latter uses the documented frozen uv environment.
- `yassin-tests.xml`: 29 local engine/API tests passed.
- `ray-probes.json`, `yassin-probes.json`: focused counterexamples and selected successful authorization/performance checks.
- `ray-probes.py`, `yassin-probes.py`: reproductions; require the temporary branch copies and dependencies described in report H.
- `frontend-browser.json`, `zaib-browser.json` and corresponding `.cjs` scripts: actual browser results, including no operational backend requests, local-only acceptance, reload loss, duplicate preset and keyboard issues.
- `frontend-source-comparison.json`: 31 shared source files byte-identical across current frontend and Zaib.
- `visual-compare.cjs` and PNGs: matched desktop/mobile captures. Animation frames can differ despite identical code.
- `ray-verified-intervention.png`: Ray's own connected browser workflow after separate activation verification.
- `jev-smoke.txt`: sanitized live native TypeSafe response; successful transport and typed answers with uncertainty, not production decision validation.
- `yassin-bench.json`: local small-fixture timings; release SHA must be read from branch inventory because the archive benchmark could not infer Git metadata.
- `*-npm-audit.json`: package-level dependency findings; assess applicability individually.
- `merge-conflicts.json`: read-only conflict preview, not an executed merge.

Temporary environment root was `/tmp/sevaro-audit-20261011`. API/frontends and PostgreSQL have been stopped after verification. Scripts preserve explicit temporary paths rather than claiming to be standalone repository tests. Recreate the isolated environment before rerunning them. No application implementation files were edited.
