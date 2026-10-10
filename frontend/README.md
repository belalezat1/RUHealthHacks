# Sevaro frontend

React + TypeScript + Vite, with React Router, TanStack Query, Recharts, and Tailwind CSS. The six views consume the FastAPI API; no cards or scenario buttons use disconnected demo values.

## Local development

Start PostgreSQL, run the backend migrations, and start FastAPI on port 8000 using the repository README. Then:

```sh
npm ci
npm run dev
```

The browser uses `http://localhost:5173`. Vite proxies `/v1` and `/health` to `http://127.0.0.1:8000`. `VITE_PROXY_TARGET` changes that server target (Compose uses `http://backend:8000`). `VITE_API_BASE_URL` is an optional complete API prefix, including `/v1`; the default is `/v1`.

This UI uses explicit local synthetic actors: dispatcher for operations, admin for dataset imports, evaluator for injected events and simulation, and the selected synthetic physician ID for a physician response. It is a local demonstration client, not a public Cognito login implementation. Keep secrets out of all `VITE_*` variables.

## Checks

```sh
npm run typecheck
npm run build
npm run format:check
npm run generate:api
```

API generation reads `../docs/openapi.json` exported from FastAPI. Domain object overlays in `src/api/types.ts` narrow JSON dictionaries where the backend contract has flexible evidence fields.

## Browser acceptance test

With the backend and frontend running, use an installed Chrome:

```sh
E2E_BROWSER_CHANNEL=chrome npm run test:e2e
```

Or install the pinned Playwright Chromium browser for CI and run the default browser:

```sh
npx playwright install --with-deps chromium
npm run test:e2e
```

`E2E_BASE_URL` selects a different local frontend URL. The test activates uniquely named synthetic datasets, and therefore changes the active local dataset. It covers UI validation/import, a real consultation event, measured event-to-queue latency, approval, explicit synthetic physician consent, final assignment, stored activation evidence, verification, audit, isolated simulation, JSON export, and a second dataset. It captures a verified-intervention screenshot and attaches the latency measurement. Test availability is not evidence of a completed browser run; see the root verification report for observed results.

## Main files

- `src/api/client.ts`: one HTTP client, role context, mutation idempotency keys, and server errors.
- `src/api/hooks.ts`: three-second polling and immediate query refresh after mutations.
- `src/pages/`: all six product views.
- `src/components/`: shared evidence, forecast chart, tables, status, and loading/empty/error states.
- `e2e/workflow.spec.ts`: the complete browser acceptance flow.

Selections stay in React state while polling refreshes data. Recommendation IDs and direct physician/consultation links also use URL parameters. Each loaded example is a fresh uniquely named copy, so rebased timestamps cannot conflict with an earlier imported fixture ID.
