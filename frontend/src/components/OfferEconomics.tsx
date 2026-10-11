import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { useDemo } from "../demo/store";
import {
  SPLIT_SHIFT_PREMIUM,
  duration,
  experienceOf,
  rankCandidates,
  seniority,
  usd,
  type RankBy,
} from "../demo/economics";
import { physicianName } from "../lib/format";
import { Avatar, EASE, Pill, Segmented } from "./ui";

const OPTIONS: { value: RankBy; label: string }[] = [
  { value: "cost", label: "Lowest cost" },
  { value: "fit", label: "Best clinical fit" },
];

function ExperienceMeter({ years }: { years: number }) {
  const filled = Math.min(5, Math.max(1, Math.ceil(years / 4)));
  return (
    <span className="rx-exp-meter" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} className={i < filled ? "on" : ""} />
      ))}
    </span>
  );
}

/**
 * Eligible physicians in offer order. Cost only reorders physicians who pass
 * every hard rule; excluded physicians are listed but never offered.
 */
export function OfferEconomics({ compact = false }: { compact?: boolean }) {
  const demo = useDemo();
  const reduce = useReducedMotion();
  const { ranked, rankBy, setRankBy, declinedIds, primary, gapMinutes, recommendation, dashboard } = demo;
  const locked = !["idle", "ready", "checking", "declined"].includes(demo.offerStep);

  const eligible = [recommendation.candidate, ...recommendation.alternatives];
  const cheapest = rankCandidates(eligible, "cost")[0];
  const bestFit = rankCandidates(eligible, "fit")[0];
  const delta = bestFit.cost - cheapest.cost;
  const acceptedId = demo.lastFill?.physicianId;
  const cheapestDeclined = declinedIds.includes(cheapest.candidate.physician_id);

  const verdict = acceptedId ? (
    <>Accepted by {physicianName(acceptedId, dashboard.physicians)}. Offers stopped.</>
  ) : rankBy === "cost" && cheapestDeclined ? (
    <>Lowest-cost physician declined. Offering the next eligible candidate.</>
  ) : cheapest.candidate.physician_id === bestFit.candidate.physician_id ? (
    <>Lowest cost and best clinical fit agree on the same physician.</>
  ) : rankBy === "cost" ? (
    <>
      Saves <b className="num">{usd(delta)}</b> versus the best clinical fit.
    </>
  ) : (
    <>
      Costs <b className="num">{usd(delta)}</b> more than the lowest-cost eligible option.
    </>
  );

  return (
    <div className={`rx-econ${compact ? " is-compact" : ""}`}>
      <div className="rx-econ-head">
        <Segmented<RankBy>
          idBase={compact ? "econ-c" : "econ"}
          label="Offer order"
          options={OPTIONS}
          value={rankBy}
          onChange={setRankBy}
          disabled={locked}
        />
        <p className="rx-econ-verdict" aria-live="polite">
          {verdict}
        </p>
      </div>

      <LayoutGroup id={compact ? "ladder-c" : "ladder"}>
        <ol className="rx-ladder">
          {ranked.map((c, i) => {
            const id = c.candidate.physician_id;
            const declined = declinedIds.includes(id);
            const isPrimary = primary?.candidate.physician_id === id && !acceptedId;
            const partial = c.minutesClosed < gapMinutes;
            const name = physicianName(id, dashboard.physicians);
            return (
              <motion.li
                key={id}
                layout={!reduce}
                transition={{ duration: 0.4, ease: EASE }}
                className={`rx-ladder-row${isPrimary || acceptedId === id ? " is-primary" : ""}${declined ? " is-declined" : ""}`}
              >
                <span className="rx-rank num">{i + 1}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  {!compact ? <Avatar name={name} seed={id} /> : null}
                  <div style={{ minWidth: 0 }}>
                    <div className="rx-ladder-name">
                      <strong>{name}</strong>
                      {acceptedId === id ? <Pill tone="ok">Accepted</Pill> : null}
                      {isPrimary ? <Pill tone="accent">Offer first</Pill> : null}
                      {declined ? <Pill>Declined</Pill> : null}
                    </div>
                    <div className="rx-ladder-exp num">
                      <ExperienceMeter years={c.years} />
                      {c.years} yrs · {seniority(c.years)}
                    </div>
                  </div>
                </div>
                <dl className="rx-figures">
                  <div>
                    <dt>Rate</dt>
                    <dd className="num">{usd(c.rate)}/h</dd>
                  </div>
                  {!compact ? (
                    <div>
                      <dt>Window</dt>
                      <dd className="num">{duration(c.hours)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Closes</dt>
                    <dd className={`num${partial ? " warn" : ""}`}>
                      {c.minutesClosed}/{gapMinutes} min
                    </dd>
                  </div>
                  <div className="cost">
                    <dt>Est. offer</dt>
                    <dd className="num">{usd(c.cost)}</dd>
                  </div>
                </dl>
              </motion.li>
            );
          })}
        </ol>
      </LayoutGroup>

      {!compact ? (
        <ul className="rx-excluded" aria-label="Excluded physicians">
          {recommendation.rejected.map((r) => {
            const id = String(r.physician_id);
            const econ = experienceOf(id);
            return (
              <li key={id}>
                <strong>{physicianName(id, dashboard.physicians)}</strong>
                <span className="num">
                  {econ ? `${econ.years} yrs · ${usd(econ.rate)}/h · ` : ""}
                  Excluded. Not offered at any price.
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <p className="rx-note">
        Synthetic rates, {Math.round((SPLIT_SHIFT_PREMIUM - 1) * 100)}% split-shift premium. Cost only reorders
        physicians who pass every hard rule; eligibility is never traded for price.
      </p>
    </div>
  );
}
