import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { useDemo } from "../demo/store";
import {
  duration,
  experienceOf,
  rankCandidates,
  seniority,
  SPLIT_SHIFT_PREMIUM,
  usd,
  type RankBy,
} from "../demo/economics";
import { physicianName } from "../lib/format";

const OPTIONS: { value: RankBy; label: string }[] = [
  { value: "cost", label: "Lowest cost" },
  { value: "fit", label: "Best clinical fit" },
];

function ExperienceMeter({ years }: { years: number }) {
  const filled = Math.min(5, Math.max(1, Math.ceil(years / 4)));
  return (
    <span className="exp-meter" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} className={i < filled ? "on" : ""} />
      ))}
    </span>
  );
}

export function OfferEconomics({ compact = false }: { compact?: boolean }) {
  const demo = useDemo();
  const reduce = useReducedMotion();
  const { ranked, rankBy, setRankBy, declinedIds, primary, gapMinutes, recommendation, dashboard } =
    demo;
  const locked = !["idle", "ready", "checking", "declined"].includes(demo.offerStep);

  const eligible = [recommendation.candidate, ...recommendation.alternatives];
  const cheapest = rankCandidates(eligible, "cost")[0];
  const bestFit = rankCandidates(eligible, "fit")[0];
  const delta = bestFit.cost - cheapest.cost;
  const acceptedId = demo.lastFill?.physicianId;
  const cheapestDeclined = declinedIds.includes(cheapest.candidate.physician_id);
  const verdict = acceptedId
    ? `Accepted by ${physicianName(acceptedId, dashboard.physicians)}. Offers stopped.`
    : rankBy === "cost" && cheapestDeclined
      ? "Lowest-cost physician declined. Offering the next eligible candidate."
      : cheapest.candidate.physician_id === bestFit.candidate.physician_id
      ? "Lowest cost and best clinical fit agree on the same physician."
      : rankBy === "cost"
        ? `Saves ${usd(delta)} versus the best clinical fit.`
        : `Costs ${usd(delta)} more than the lowest-cost eligible option.`;

  return (
    <div className={`econ${compact ? " econ-compact" : ""}`}>
      <div className="econ-head">
        <div className="seg" role="radiogroup" aria-label="Offer order">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={rankBy === o.value}
              className={`seg-btn${rankBy === o.value ? " on" : ""}`}
              disabled={locked}
              onClick={() => setRankBy(o.value)}
            >
              {rankBy === o.value && !reduce ? (
                <motion.span layoutId={`seg-pill-${compact ? "c" : "f"}`} className="seg-pill" />
              ) : rankBy === o.value ? (
                <span className="seg-pill" />
              ) : null}
              <span className="seg-label">{o.label}</span>
            </button>
          ))}
        </div>
        <p className="econ-verdict">{verdict}</p>
      </div>

      <LayoutGroup>
        <ol className="econ-ladder">
          {ranked.map((c, i) => {
            const id = c.candidate.physician_id;
            const declined = declinedIds.includes(id);
            const isPrimary = primary?.candidate.physician_id === id;
            const partial = c.minutesClosed < gapMinutes;
            return (
              <motion.li
                key={id}
                layout={!reduce}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className={`econ-row${isPrimary ? " primary" : ""}${declined ? " declined" : ""}`}
              >
                <span className="econ-rank tabular">{i + 1}</span>
                <div className="econ-who">
                  <div className="econ-name">
                    <strong>{physicianName(id, dashboard.physicians)}</strong>
                    {acceptedId === id ? (
                      <span className="econ-tag">Accepted</span>
                    ) : isPrimary && !acceptedId ? (
                      <span className="econ-tag">Offer first</span>
                    ) : null}
                    {declined ? <span className="econ-tag muted">Declined</span> : null}
                  </div>
                  <div className="econ-exp">
                    <ExperienceMeter years={c.years} />
                    <span>
                      {c.years} yrs · {seniority(c.years)}
                    </span>
                  </div>
                </div>
                <dl className="econ-figures">
                  <div>
                    <dt>Rate</dt>
                    <dd className="tabular">{usd(c.rate)}/h</dd>
                  </div>
                  {!compact ? (
                    <div>
                      <dt>Window</dt>
                      <dd className="tabular">{duration(c.hours)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Closes</dt>
                    <dd className={`tabular${partial ? " warn" : ""}`}>
                      {c.minutesClosed}/{gapMinutes} min
                    </dd>
                  </div>
                  <div className="econ-cost">
                    <dt>Est. offer</dt>
                    <dd className="tabular">{usd(c.cost)}</dd>
                  </div>
                </dl>
              </motion.li>
            );
          })}
        </ol>
      </LayoutGroup>

      {!compact ? (
        <ul className="econ-excluded" aria-label="Excluded physicians">
          {recommendation.rejected.map((r) => {
            const id = String(r.physician_id);
            const econ = experienceOf(id);
            return (
              <li key={id}>
                <strong>{physicianName(id, dashboard.physicians)}</strong>
                <span>
                  {econ ? `${econ.years} yrs · ${usd(econ.rate)}/h · ` : ""}
                  Excluded. Not offered at any price.
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <p className="econ-note">
        Synthetic rates, {Math.round((SPLIT_SHIFT_PREMIUM - 1) * 100)}% split-shift premium. Cost only reorders
        physicians who pass every hard rule; eligibility is never traded for price.
      </p>
    </div>
  );
}
