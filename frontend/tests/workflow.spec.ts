import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Run only against a disposable local database with explicitly provisioned accounts.
// Passwords are read from an ignored file; never commit them or include them in reports.
const accountsFile = process.env.SEVARO_E2E_ACCOUNTS || resolve("../.local/browser-accounts.json");
const accounts: { username: string; password: string; role: string }[] = JSON.parse(readFileSync(accountsFile, "utf8"));

test("official data, role approval, physician response, reload and CSV replay", async ({ browser }) => {
  const contexts = await Promise.all(accounts.map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const errors: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    pages[i].on("pageerror", error => errors.push(error.message));
    await pages[i].goto("/");
    await pages[i].getByRole("textbox", { name: "Username" }).fill(accounts[i].username);
    await pages[i].getByLabel("Password", { exact: true }).fill(accounts[i].password);
    await pages[i].getByRole("button", { name: "Sign in", exact: true }).click();
  }
  const coordinator = pages[accounts.findIndex(a => a.role === "coordinator")];
  const lead = pages[accounts.findIndex(a => a.role === "clinical_lead")];
  const physician = pages[accounts.findIndex(a => a.role === "physician")];
  await expect(coordinator.getByText("208/208 reference fields matched", { exact: false })).toBeVisible();
  await expect(coordinator.getByText("Dr. Grace Wu", { exact: true })).toBeVisible();
  await expect(coordinator.getByRole("button", { name: "Approve offer", exact: true })).toHaveCount(0);

  const selected = coordinator.waitForResponse(r => r.url().includes("/decisions/preview") && r.request().method() === "POST");
  await coordinator.getByRole("button", { name: "Review recommendation", exact: true }).click();
  const decision = (await (await selected).json()).result;
  expect(["jev", "deterministic_fallback"]).toContain(decision.source);
  expect(decision.requires_clinical_lead_approval).toBe(true);
  await expect(coordinator.getByRole("button", { name: "Propose selected offer", exact: true })).toBeEnabled();
  await coordinator.getByRole("button", { name: "Propose selected offer", exact: true }).click();
  await expect(coordinator.getByText("Awaiting lead approval", { exact: true })).toBeVisible();
  await lead.getByRole("button", { name: "Offers", exact: true }).click();
  await lead.getByRole("button", { name: "Approve offer", exact: true }).click();
  await expect(coordinator.getByRole("button", { name: "Send simulated offer", exact: true })).toBeVisible();
  await coordinator.getByRole("button", { name: "Send simulated offer", exact: true }).click();
  await expect(physician.getByRole("button", { name: "Accept offer", exact: true })).toBeVisible();
  await physician.getByRole("button", { name: "Accept offer", exact: true }).click();
  await expect(physician.getByText("Imported evidence is required", { exact: false })).toHaveCount(0);
  await expect(physician.getByText("This is not confirmation that you are online.", { exact: false })).toBeVisible();
  await coordinator.reload();
  await coordinator.getByRole("button", { name: "Offers", exact: true }).click();
  await expect(coordinator.getByText("accepted", { exact: true })).toBeVisible();
  await expect(coordinator.getByText("Imported evidence is required for confirmed capacity.", { exact: false })).toBeVisible();
  await expect(coordinator.getByText("Coverage restored", { exact: false })).toHaveCount(0);

  await coordinator.getByRole("button", { name: "Data & ActionLab", exact: true }).click();
  // Re-upload authentic organizer records to prove live, idempotent ingestion.
  // Distinct judge-like late records are tested in isolated backend regressions.
  await coordinator.getByLabel("Event CSV", { exact: true }).setInputFiles(resolve("../data/original/event_stream.csv"));
  const imported = coordinator.waitForResponse(r => r.url().includes("/events/import") && r.request().method() === "POST");
  await coordinator.getByRole("button", { name: "Import CSV", exact: true }).click();
  const result = (await (await imported).json()).result;
  expect(result.accepted).toBe(0); expect(result.duplicates).toBeGreaterThan(1000);
  await coordinator.getByRole("button", { name: "Compare recorded policies", exact: true }).click();
  await expect(coordinator.getByTestId("actionlab-result")).toContainText('"generated_event_count": 0');
  expect(errors).toEqual([]);
  await coordinator.setViewportSize({ width: 390, height: 844 });
  expect(await coordinator.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await coordinator.screenshot({ path: "../docs/evidence/integrated-mobile.png", fullPage: true });
  await coordinator.setViewportSize({ width: 1440, height: 1000 });
  await coordinator.getByRole("button", { name: "Coverage desk", exact: true }).click();
  await coordinator.screenshot({ path: "../docs/evidence/integrated-desk.png", fullPage: true });
  for (const context of contexts) await context.close();
});
