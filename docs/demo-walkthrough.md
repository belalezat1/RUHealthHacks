# A clear two-minute demo

Use the provisioned accounts for the coordinator, clinical lead, and the selected physician. Separate browser windows avoid repeated sign-in. No shared/default password is supplied by the app.

1. **Coordinator · Coverage desk:** explain that supplied events reveal clinical alerts and forecast staffing gaps over the next 90 minutes. Point to the hospital needing backup. A doctor-minute is one doctor missing for one minute; it is not a patient wait metric.
2. **Coordinator · Choose eligible backup:** click **Review recommendation**. Show the selected doctor by name and expand their credentials, rest, weekly-hour and overlap checks. Jev only selects among actions that passed the server's rules. Click **Propose selected offer**.
3. **Clinical lead · Offers:** review the proposed shift and click **Approve offer**. The coordinator cannot approve their own proposal.
4. **Coordinator · Offers:** click **Send simulated offer**. No real text or email is delivered. The physician has ten scenario minutes to respond.
5. **Named physician · Your shift offers:** click **Accept offer** or **Decline offer**. Return to the coordinator view to show the persisted result and audit history.

Acceptance reserves planned coverage; it does not prove the doctor is online or that a patient outcome improved. Only imported participation evidence confirms online capacity. For ingestion, use **Data & ActionLab**, validate and import the supplied eight-column CSV, then show the readable accepted/duplicate/error counts. Re-uploading existing rows correctly adds no new events.

The guide highlights the next stage using actual server state. It never performs an approval, send, or physician response automatically. No synthetic financial values or clinical events are added.
