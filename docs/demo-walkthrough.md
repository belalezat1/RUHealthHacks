# A clear two-minute demo

Use provisioned coordinator, clinical-lead, and physician accounts. Separate browser windows avoid repeated sign-in. There is no shared/default password.

## Watch recorded data change the physician pick

1. Open **Scenario lab**, choose the supplied `c2_new_events.csv`, click **Validate CSV**, then **Import validated CSV**. Show eight imported events, one skipped duplicate, and zero errors.
2. Return to **Coverage desk**. In **Play imported data**, select **Oak Valley Medical** as the routing hospital and press **Play**.
3. Watch the scenario clock and progress. **Next consult physician** becomes **Dr. Noah Williams** at 18:26:01 ET, then returns to **No eligible physician** when his recorded hospital call starts at 18:26:57. Expand the routing evidence to show credentials, availability, cooldown, workload, and tie-break rules.
4. **Backup staffing physician** is a separate recommendation for the modeled coverage gap. It can remain **Dr. Grace Okafor**. The card labels Jev, deterministic fallback, or escalation and shows the provider reason and latency.
5. Use **Pause** and **Next** to explain a single point, **Restart** to revisit the beginning, and **Return to current state** before taking an operational action.

Playback uses the most recent CSV, deduplicates its event IDs, and advances at unique ingestion timestamps. The camera event occurred earlier but arrives at 18:25:40; it cannot influence decisions before arrival. Official and previously imported records supply historical context. No synthetic records are added, no assignments are made, and manual offer commitments are excluded from this preview. Operational time, revision, offers and audit history remain unchanged. Selections need not change at every point. Older receipts with incomplete membership require reimporting the same CSV; this does not duplicate events.

## Review and approve a staffing offer

1. **Coordinator · Coverage desk:** exit playback, examine coverage and eligibility, then click **Review decision**. Show the actual Jev/fallback source and the physician's rule evidence. Click **Propose offer for approval**.
2. **Clinical lead · Approval & offer tracking:** review the proposed shift and click **Approve offer**. The coordinator cannot approve it.
3. **Coordinator:** click **Send approved offer**. Sending is simulated; no real text or email is delivered. The physician has ten scenario minutes to respond.
4. **Named physician · Your shift offers:** click **Accept offer** or **Decline offer**, then show the persisted result and audit history.

Acceptance reserves planned coverage; it does not prove online presence or improved patient outcomes. Imported participation evidence confirms presence under the challenge rules. Forecast physician-minutes measure modeled coverage gaps, not patient waiting time. Financial results are unavailable because verified financial inputs were not supplied.
