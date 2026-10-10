import { useState } from "react";
import { ApiError, describeError, get, mutate, rememberState } from "../api";
import { dateTime, hhmm } from "../format";
import { useLive } from "../live";
import type { LiveState, PhysicianOffer, User } from "../types";

interface MyOffers {
  physician_id: string;
  as_of: string;
  offers: PhysicianOffer[];
}

const STATUS_TEXT: Record<string, string> = {
  sent: "Awaiting your answer",
  accepted: "Accepted — you're on the schedule",
  declined: "Declined",
  expired: "Expired (not answered within 10 minutes)",
  cancelled: "No longer needed",
};

export default function PhysicianView({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const live = useLive<MyOffers>("/api/v1/me/offers");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const respond = async (offerId: string, action: "accept" | "decline") => {
    setBusy(offerId);
    setMessage(null);
    try {
      try {
        await mutate(`/api/v1/offers/${offerId}/${action}`);
      } catch (e) {
        // An unrelated change moved the revision. The server re-checks everything, so
        // refreshing and resubmitting the same decision once is safe.
        if (e instanceof ApiError && e.code === "stale_revision") {
          rememberState(await get<LiveState>("/api/v1/state"));
          await mutate(`/api/v1/offers/${offerId}/${action}`);
        } else throw e;
      }
      setMessage({ kind: "ok", text: action === "accept" ? "Accepted. Thank you — the operations team can see it now." : "Declined." });
    } catch (e) {
      const text = e instanceof ApiError && e.code === "gap_filled"
        ? "Another physician already filled this shift. No action is needed."
        : describeError(e);
      setMessage({ kind: "error", text });
    } finally {
      setBusy(null);
      live.refresh();
    }
  };

  const offers = live.data?.offers ?? [];
  const open = offers.filter((o) => o.status === "sent");
  const past = offers.filter((o) => o.status !== "sent");

  return (
    <>
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden>S</span> Split-shift offers</div>
        <span className="spacer" />
        <button className="btn small" onClick={onSignOut}>Sign out</button>
      </header>
      <div className="phone stack">
        <div className="row small muted">
          <span className={`dot ${live.error ? "error" : live.stale ? "stale" : ""}`} aria-hidden />
          {live.error ? "Connection problem — retrying" : live.stale ? "Reconnecting…" : "Up to date"}
          <span>· {user.display_name}</span>
          {live.state && <span>· scenario {hhmm(live.state.as_of)} ET</span>}
        </div>
        {message && <div className={`notice ${message.kind}`} role="status">{message.text}</div>}
        {live.loading && <div className="muted">Loading offers…</div>}
        {!live.loading && open.length === 0 && (
          <div className="card">
            <h2>No open offers</h2>
            <p className="muted" style={{ marginBottom: 0 }}>When the clinical lead approves a shift for you, it appears here.</p>
          </div>
        )}
        {open.map((o) => (
          <div key={o.offer_id} className="card offer-card" aria-live="polite">
            <div className="small muted">Split-shift offer</div>
            <div className="hosp">{o.hospital_names.join(", ")}</div>
            <div className="when">
              {hhmm(o.start)}–{hhmm(o.end)} ET · {o.hours} hours<br />
              <span className="small muted">Starts {dateTime(o.start)}</span>
            </div>
            <div className="small">
              {o.seconds_left_scenario !== null
                ? <>Answer within <b>{Math.ceil(o.seconds_left_scenario / 60)} min</b> (scenario clock; expires {hhmm(o.expires_at)} ET)</>
                : null}
            </div>
            <div className="offer-actions">
              <button className="btn" disabled={busy !== null} onClick={() => respond(o.offer_id, "decline")}>Decline</button>
              <button className="btn primary" disabled={busy !== null} onClick={() => respond(o.offer_id, "accept")}>
                {busy === o.offer_id ? "Sending…" : "Accept"}
              </button>
            </div>
          </div>
        ))}
        {past.length > 0 && (
          <div className="card">
            <h3 style={{ marginBottom: 6 }}>Earlier offers</h3>
            {past.map((o) => (
              <div key={o.offer_id} className="audit-item">
                <b>{o.hospital_names.join(", ")}</b> {hhmm(o.start)}–{hhmm(o.end)} ET
                <div className={`status-${o.status}`}>{STATUS_TEXT[o.status] ?? o.status}</div>
                {o.status === "accepted" && o.online_at && <div className="muted">Expected online {hhmm(o.online_at)} ET</div>}
              </div>
            ))}
          </div>
        )}
        <p className="small muted">Offers show only hospital names, hours and start time. This is a simulation; no real shift is scheduled.</p>
      </div>
    </>
  );
}
