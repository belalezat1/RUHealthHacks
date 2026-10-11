import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { ReplayFrame, ReplaySession } from "../src/recordedReplay";
const accounts = JSON.parse(
  readFileSync(process.env.SEVARO_E2E_ACCOUNTS!, "utf8"),
) as { username: string; password: string; role: string }[];
const official = resolve("../data/original/event_stream.csv");
const judgeCsv = resolve("../backend/tests/fixtures/c2_new_events.csv");
async function signIn(page: import("@playwright/test").Page, role: string) {
  const account = accounts.find((a) => a.role === role)!;
  await page.goto("/app");
  await page.getByLabel("Username", { exact: true }).fill(account.username);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
}
async function freshRun(page: import("@playwright/test").Page, label: string) {
  const session = await (await page.request.get("/api/v1/session")).json();
  const state = await (await page.request.get("/api/v1/state")).json();
  const response = await page.request.post("/api/v1/runs", {
    data: { label },
    headers: {
      "X-CSRF-Token": session.csrf_token,
      "Idempotency-Key": crypto.randomUUID(),
      "X-Expected-Run": state.run_id,
      "X-Expected-Revision": String(state.revision),
    },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
}
test("official CSV replay, malformed headers, no mocks, reload and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "coordinator");
  await freshRun(page, "Isolated browser verification");
  await expect(page.getByText("208/208 snapshot fields match")).toBeVisible();
  const report = (await (await page.request.get("/api/v1/report")).json()).data;
  expect(report.physicians.length).toBe(14);
  await expect(page.getByText("1163 recorded events")).toBeVisible();
  await page
    .getByText("Source and financial evidence", { exact: true })
    .click();
  await expect(page.getByText("Cost estimates unavailable")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Coverage desk", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("link", { name: "Scenario lab", exact: true }),
  ).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(
    /Dr\. Reed|Riverfront|Harbor operations|Synthetic demo/,
  );
  await page.getByRole("link", { name: "Scenario lab", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Scenario lab", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByLabel("Event CSV file").setInputFiles(official);
  await expect(
    page.getByRole("button", { name: "Import validated CSV" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Validate CSV", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Validation result" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import validated CSV" }),
  ).toBeEnabled();
  const imported = page.waitForResponse(
    (r) =>
      r.url().includes("/events/import?") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Import validated CSV" }).click();
  const result = (await (await imported).json()).result;
  expect(result.accepted).toBe(0);
  expect(result.duplicates).toBe(1164);
  await expect(
    page.getByRole("heading", { name: "Import complete" }),
  ).toBeVisible();
  // Change only the real file's header, then prove validation blocks import.
  await page
    .getByLabel("CSV contents")
    .fill(
      readFileSync(official, "utf8").replace(
        "event_id,event_time",
        "bad_header,event_time",
      ),
    );
  await expect(
    page.getByRole("button", { name: "Import validated CSV" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Validate CSV", exact: true }).click();
  await expect(page.getByText("Rejected", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import validated CSV" }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Import history" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Import history" })
      .getByText("event_stream.csv", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Return to coverage desk" }).click();
  await expect(page.getByText("1163 recorded events")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("real backend proposal, role approval, sending and physician acceptance", async ({
  browser,
}) => {
  const contexts = await Promise.all(accounts.map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  for (let i = 0; i < pages.length; i++)
    await signIn(pages[i], accounts[i].role);
  const coordinator =
    pages[accounts.findIndex((a) => a.role === "coordinator")];
  const lead = pages[accounts.findIndex((a) => a.role === "clinical_lead")];
  const physician = pages[accounts.findIndex((a) => a.role === "physician")];
  await freshRun(coordinator, "Isolated browser offer verification");
  await expect(
    coordinator.getByRole("button", { name: "Approve offer", exact: true }),
  ).toHaveCount(0);
  await coordinator.getByRole("button", { name: "Review decision" }).click();
  await expect(
    coordinator.getByRole("button", { name: "Propose offer for approval" }),
  ).toBeEnabled();
  await coordinator
    .getByRole("button", { name: "Propose offer for approval" })
    .click();
  await expect(
    coordinator.getByText("Proposed", { exact: true }),
  ).toBeVisible();
  await lead.reload();
  await expect(
    lead.getByRole("button", { name: "Approve offer", exact: true }),
  ).toBeVisible();
  await lead
    .getByRole("button", { name: "Approve offer", exact: true })
    .click();
  await coordinator.getByRole("button", { name: "Refresh data" }).click();
  await expect(
    coordinator.getByRole("button", { name: "Send approved offer" }),
  ).toBeVisible();
  await coordinator
    .getByRole("button", { name: "Send approved offer" })
    .click();
  await physician.reload();
  await expect(
    physician.getByRole("button", { name: "Accept offer" }),
  ).toBeVisible();
  await physician.getByRole("button", { name: "Accept offer" }).click();
  await coordinator.reload();
  await expect(
    coordinator.getByText("Accepted", { exact: true }),
  ).toBeVisible();
  await expect(
    coordinator.getByText(
      "Accepted offers remain planned capacity until presence is observed.",
      { exact: false },
    ),
  ).toBeVisible();
  expect(await coordinator.locator("body").innerText()).not.toMatch(
    /Gap closed|Coverage restored/,
  );
  for (const context of contexts) await context.close();
});
test("new official rows import without restart and restore reference verification", async ({
  page,
}) => {
  test.skip(!process.env.SEVARO_E2E_DATABASE_URL, "Requires isolated database");
  await signIn(page, "coordinator");
  await freshRun(page, "Isolated browser CSV verification");
  const withheld = Number(
    execFileSync(
      "../.venv/bin/python",
      ["../scripts/withhold_browser_events.py"],
      { env: process.env, encoding: "utf8" },
    ).trim(),
  );
  expect(withheld).toBeGreaterThan(0);
  await page.goto("/app/lab");
  await page.getByLabel("Event CSV file").setInputFiles(official);
  await page.getByRole("button", { name: "Validate CSV", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Import validated CSV" }),
  ).toBeEnabled();
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/events/import?") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Import validated CSV" }).click();
  const result = (await (await response).json()).result;
  expect(result.accepted).toBe(withheld);
  expect(result.clock_advanced_to).toBeTruthy();
  // Official last ingestion precedes the reference snapshot; advance only the clock.
  const session = await (await page.request.get("/api/v1/session")).json();
  const state = await (await page.request.get("/api/v1/state")).json();
  const clock = await page.request.post("/api/v1/clock", {
    data: { to: "2026-03-17T18:20:00-04:00" },
    headers: {
      "X-CSRF-Token": session.csrf_token,
      "Idempotency-Key": crypto.randomUUID(),
      "X-Expected-Run": state.run_id,
      "X-Expected-Revision": String(state.revision),
    },
  });
  expect(clock.ok(), await clock.text()).toBe(true);
  await page.goto("/app");
  await expect(page.getByText("208/208 snapshot fields match")).toBeVisible();
  await expect(page.getByText("1163 recorded events")).toBeVisible();
});

test("latest judge CSV Play, Pause, Next, Restart and return preserve current run", async ({
  page,
}) => {
  const errors: string[] = [];
  const replayResponses: Promise<{ data: ReplayFrame | ReplaySession }>[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/v1/replays/") && response.ok())
      replayResponses.push(response.json());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "coordinator");
  await freshRun(page, "Isolated recorded playback verification");
  await page.getByRole("link", { name: "Scenario lab", exact: true }).click();
  await page.getByLabel("Event CSV file").setInputFiles(judgeCsv);
  await page.getByRole("button", { name: "Validate CSV", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Import validated CSV" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Import validated CSV" }).click();
  await expect(
    page.getByRole("heading", { name: "Import complete" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return to coverage desk" }).click();
  await expect(
    page.getByText("1171 recorded events", { exact: true }),
  ).toBeVisible();
  const before = (await (await page.request.get("/api/v1/report")).json()).data;
  await page.getByLabel("Playback routing hospital").selectOption("SYN-010");
  const progress = page.getByRole("progressbar", { name: "Replay progress" });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(progress).toHaveAttribute("value", "0");
  await expect(
    page.getByText("1163 recorded events", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Playback routing hospital")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Review decision", exact: true }),
  ).toBeDisabled();
  const nextPick = page.getByRole("region", {
    name: "Next consult physician",
    exact: true,
  });
  const backupPick = page.getByRole("region", {
    name: "Backup staffing physician",
    exact: true,
  });
  await expect(
    nextPick.getByRole("heading", { name: "No eligible physician" }),
  ).toBeVisible();
  await expect(
    backupPick.getByRole("heading", { name: "Dr. Grace Okafor" }),
  ).toBeVisible();
  await expect(backupPick.getByText(/Deterministic fallback/)).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(progress).toHaveAttribute("value", "1");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(progress).toHaveAttribute("value", "2");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.waitForTimeout(1200);
  await expect(progress).toHaveAttribute("value", "2");
  for (let value = 3; value <= 6; value++) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(progress).toHaveAttribute("value", String(value));
  }
  await expect(
    nextPick.getByRole("heading", { name: "Dr. Noah Williams" }),
  ).toBeVisible();
  await expect(
    nextPick.getByText("Selection changed", { exact: true }),
  ).toBeVisible();
  const output = resolve("../output/ui-review/playback");
  mkdirSync(output, { recursive: true });
  await page.locator("#recorded-playback").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, "01-physician-selected.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator("#recorded-playback")
    .screenshot({ path: resolve(output, "02-mobile-playback.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(progress).toHaveAttribute("value", "8");
  await expect(
    page.getByText("Replay complete", { exact: false }),
  ).toBeVisible();
  await expect(
    nextPick.getByRole("heading", { name: "No eligible physician" }),
  ).toBeVisible();
  await expect(
    nextPick.getByText("Selection changed", { exact: true }),
  ).toBeVisible();
  await expect(
    backupPick.getByText("Selection unchanged", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("1171 recorded events", { exact: true }),
  ).toBeVisible();
  await page.locator("#recorded-playback").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, "03-call-busy.png") });
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await expect(progress).toHaveAttribute("value", "0");
  await expect(
    nextPick.getByRole("heading", { name: "No eligible physician" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Return to current state", exact: true })
    .click();
  await expect(progress).toHaveCount(0);
  await expect(
    page.getByText("1171 recorded events", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Playback routing hospital")).toBeEnabled();
  const after = (await (await page.request.get("/api/v1/report")).json()).data;
  for (const key of ["run", "counts", "offers", "audit_tail", "imports"])
    expect(after[key]).toEqual(before[key]);
  expect(errors).toEqual([]);
  const responses = await Promise.all(replayResponses);
  const session = responses.find((r) => "baseline" in r.data)
    ?.data as ReplaySession;
  const frames = responses.map((r) =>
    "baseline" in r.data ? r.data.baseline : r.data,
  );
  writeFileSync(
    resolve(output, "results.json"),
    JSON.stringify(
      {
        source:
          "Actual application, disposable PostgreSQL, official reference data and unchanged supplied CSV",
        provider:
          "Disabled only in this isolated browser run; Jev success/failure paths tested separately with HTTP fault injection",
        filename: session.filename,
        input_sha256: session.input_sha256,
        summary: session.summary,
        operational_state_unchanged: true,
        browser_errors: errors,
        frames: frames.map((f) => ({
          index: f.index,
          as_of: f.as_of,
          counts: f.report.counts,
          next_consult: f.routing["SYN-010"].selected,
          decision: f.decision,
        })),
      },
      null,
      2,
    ) + "\n",
  );
});
