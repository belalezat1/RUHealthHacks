import { expect, test } from "@playwright/test";

test("synthetic import, live event, consent, assignment, activation, audit, and replay", async ({
  page,
}, testInfo) => {
  const exceptions: string[] = [];
  page.on("pageerror", (error) => exceptions.push(error.message));
  await page.goto("/simulation");
  await expect(page.getByText("Synthetic demo", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Dataset import" }).click();
  const examples = page.getByLabel("Example dataset");
  await expect(examples.locator("option")).not.toHaveCount(1);
  const exampleIds = await examples
    .locator("option")
    .evaluateAll((options) =>
      options.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
  expect(exampleIds.length).toBeGreaterThanOrEqual(2);
  await examples.selectOption(exampleIds[0]);
  await page.getByRole("button", { name: "Load example" }).click();
  const datasetInput = page.getByLabel("Dataset JSON");
  await expect(datasetInput).not.toHaveValue("");
  const dataset = JSON.parse(await datasetInput.inputValue());
  dataset.dataset_id = `browser-e2e-${Date.now()}`;
  await datasetInput.fill(JSON.stringify(dataset));
  await page.getByRole("button", { name: "1. Validate dataset" }).click();
  await expect(page.getByText("Dataset validation passed")).toBeVisible();
  await page.getByRole("button", { name: "2. Import and activate" }).click();
  await expect(
    page.getByText("Dataset activated", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Command Center", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Coverage outlook" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Coverage Forecast", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Hospital coverage timeline" }),
  ).toBeVisible();

  // A real source event must reach the live queue within the stated 5-second target.
  await page.getByRole("link", { name: "Simulation Lab", exact: true }).click();
  await page.getByRole("tab", { name: "Live event injection" }).click();
  await page.getByLabel("Event type").selectOption("consultation.created");
  await page.getByLabel("Hospital / specialty").selectOption({ index: 1 });
  const eventStart = Date.now();
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/events") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Inject synthetic event" }).click();
  const response = await createdResponse;
  expect(response.ok()).toBeTruthy();
  const eventEnvelope = response.request().postDataJSON();
  await expect(page.getByText("Event applied", { exact: true })).toBeVisible();
  await page
    .getByRole("link", { name: "Consultation Queue", exact: true })
    .click();
  await expect(
    page.getByText(eventEnvelope.entity_id, { exact: true }),
  ).toBeVisible();
  const latency = Date.now() - eventStart;
  await testInfo.attach("event-to-queue-latency.json", {
    body: JSON.stringify({ milliseconds: latency, target_ms: 5000 }),
    contentType: "application/json",
  });
  expect(latency).toBeLessThan(5000);

  await page.getByRole("link", { name: "Interventions", exact: true }).click();
  const consultations = page.getByLabel("Waiting consultation");
  await expect(consultations.locator("option")).not.toHaveCount(1);
  await consultations.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Preview recommendation" }).click();
  await expect(
    page.getByRole("button", { name: "Approve for contact" }),
  ).toBeVisible();
  await page
    .getByLabel("Decision reason")
    .fill(
      "Browser acceptance: reviewed eligibility and downstream coverage evidence.",
    );
  await page.getByRole("button", { name: "Approve for contact" }).click();
  await expect(
    page.getByText("Synthetic physician actor", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Decision reason")
    .fill("Browser acceptance: explicit synthetic physician agreement.");
  await page
    .getByLabel("I am explicitly simulating this physician’s response.")
    .check();
  await page
    .getByRole("button", { name: "Accept as synthetic physician" })
    .click();
  await expect(
    page.getByRole("button", { name: "Revalidate and commit assignment" }),
  ).toBeVisible();
  await page
    .getByLabel("Decision reason")
    .fill(
      "Browser acceptance: commit with current evidence and stored consent.",
    );
  await page
    .getByRole("button", { name: "Revalidate and commit assignment" })
    .click();
  await expect(
    page.getByRole("button", { name: "Inject synthetic activation" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Inject synthetic activation" })
    .click();
  await expect(
    page.getByRole("button", { name: "Activation event recorded" }),
  ).toBeVisible();
  await page
    .getByLabel("Decision reason")
    .fill(
      "Browser acceptance: verify the independent stored activation event.",
    );
  await page
    .getByRole("button", { name: "Verify activation evidence" })
    .click();
  await expect(
    page.getByText(
      "The server confirmed stored activation evidence for this assignment.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Decision audit" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("verified-intervention.png"),
    fullPage: true,
  });

  await page.getByRole("link", { name: "Simulation Lab", exact: true }).click();
  const scenarios = page.getByLabel("Scenario", { exact: true });
  await expect(scenarios.locator("option")).not.toHaveCount(1);
  await scenarios.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Run isolated comparison" }).click();
  await expect(
    page.getByRole("heading", { name: "Baseline vs. optimized" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  expect((await download).suggestedFilename()).toMatch(
    /^sevaro-simulation-.*\.json$/,
  );

  // A second same-format dataset uses the exact same UI and implementation.
  await page.getByRole("tab", { name: "Dataset import" }).click();
  await page.getByLabel("Example dataset").selectOption(exampleIds[1]);
  await page.getByRole("button", { name: "Load example" }).click();
  await expect(page.getByLabel("Dataset JSON")).not.toHaveValue("");
  const second = JSON.parse(await page.getByLabel("Dataset JSON").inputValue());
  second.dataset_id = `browser-second-${Date.now()}`;
  await page.getByLabel("Dataset JSON").fill(JSON.stringify(second));
  await page.getByRole("button", { name: "1. Validate dataset" }).click();
  await expect(page.getByText("Dataset validation passed")).toBeVisible();
  await page.getByRole("button", { name: "2. Import and activate" }).click();
  await expect(
    page.getByText("Dataset activated", { exact: true }),
  ).toBeVisible();
  expect(exceptions).toEqual([]);
});
