# Full frontend replacement

The complete tracked `frontend/` tree on `belal` is restored from `origin/frontend` commit `b72a6d7c144ad815e8a0dde16fb723b9ffe4fdc0`, **New Logo and Injection**, at the user's explicit request. The prior connected frontend is preserved in Git history at `6addd17`.

This includes the branch's landing page, coverage desk, scenario lab, demo store, styles, package files and assets. It replaces the connected v1 UI. Displayed operations, injection, eligibility and compensation in this frontend are the branch's client-side synthetic demo behavior; they are not measurements of the official dataset or confirmations of backend actions. The backend API and its persisted data are retained.

The Docker build adds directory indexes for `/app` and `/app/lab` so direct navigation and refresh work with the existing static server. No frontend source adaptations were made.

Validation: exact frontend tree comparison against the source commit; clean TypeScript/Vite production build; 3/3 existing Vitest tests; 3/3 compiled static-route checks. The source branch omits jsdom and jest-dom from its test dependencies; these were installed locally without changing package files to execute the tests. npm reported three high-severity advisories in the branch's retained dependency versions. The local scenario-lab route rendered successfully. Its synthetic injection button was not exercised because automatic approval review rejected that optional test under the earlier supplied-data-only constraint.

Historical benchmark results in `output/benchmarks/` apply to the previously measured integrated application checkout `c54c2e9`, not this replacement frontend's displayed demo outcomes.
