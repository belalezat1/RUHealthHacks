# Frontend branch review · October 11, 2026

Fetched the remote branches without switching the measured checkout. `origin/frontend` advanced from `67176cc` to **`b72a6d7c144ad815e8a0dde16fb723b9ffe4fdc0`**, “New Logo and Injection”: 23 changed files, 1,453 insertions and 439 deletions. An isolated export passed `tsc -b && vite build`; [build output](frontend-build.txt) records a 797.79 kB minified JS chunk (248.65 kB gzip) and its chunk-size warning. This was a build and source review, not an authenticated usability test of that branch.

Useful design changes: a new masked logo/favicon, hospital-specific intervention queue, candidate radio selection with keyboard navigation, clearer empty states, activity notifications, and overlays that stop intercepting clicks during exit animations. The latest branch is a useful visual source for a later port.

It is **not ready to replace the integrated app**:

- `frontend/src/main.tsx` still mounts `DemoProvider`, seeded by `buildDemoDashboard`; the displayed workflow is driven by client-side demo state.
- `demo/interventions.ts` has an explicit synthetic credentials matrix. Opt-in, 10-hour rest and 60-hour weekly-cap checks are unconditional `true`, rather than checks of official evidence.
- `demo/economics.ts` supplies synthetic compensation and experience. Its cost ranking conflicts with the project's requirement to avoid invented financial inputs.
- `demo/store.tsx` approves offers locally, updates coverage on acceptance, and uses a timer to mark the intervention filled. It does not enforce the integrated server's role, expiry or imported-online-evidence workflow.

The previously requested external `frontend-zaib` branch was checked with `git ls-remote` against `https://github.com/ZaibKaukab/RUHealthHacks.git`; it resolves to **`68bb2c524ed708aa6bfea12b1883912007997303`**. That commit is already an ancestor of the latest frontend branch. It also mounts `DemoProvider` and labels its workspace a synthetic demo, so it is an older design, not a new integrated alternative.

`origin/main`, `origin/backend`, `origin/ray`, `origin/yassin`, and `origin/henry` did not advance from the integration manifest's reviewed heads during this fetch. `origin/belal` added deployment/runtime documentation and fixes. Concurrent local commits renamed the desk branding; those and subsequent merges were preserved. Backend algorithm files were unchanged from the measured benchmark checkout.

Recommendation: keep the connected `belal` frontend for the demo and selectively port visual components. The follow-up readability change adds a five-step role guide, plain-language statuses, physician names, an explanation of doctor-minute deficits, and expandable technical evidence. It retains server approval and separates accepted commitments from confirmed online coverage.
