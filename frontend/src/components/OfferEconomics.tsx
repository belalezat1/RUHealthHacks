import { useRef, type KeyboardEvent } from "react";
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
import { eligibleOf } from "../demo/interventions";
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

function ExcludedList() {
  const { recommendation, dashboard } = useDemo();
  if (!recommendation.rejected.length) return null;
  return (
    <ul className="rx-excluded" aria-label="Excluded physicians">
      {recommendation.rejected.map((r) => {
        const id = String(r.physician_id);
        const econ = experienceOf(id);
        return (
          <li key={id}>
            <strong>{physicianName(id, dashboard.physicians)}</strong>
            <span className="num">
              {econ ? `${econ.years} yrs · ${usd(econ.rate)}/h · ` : ""}
              {r.reason ?? "Excluded."} Not offered at any price.
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Eligible physicians in offer order. Cost only reorders physicians who pass
 * every hard rule; excluded physicians are listed but never offered.
 */
export function OfferEconomics({ compact = false }: { compact?: boolean }) {
  const demo = useDemo();
  const reduce = useReducedMotion();
  const {
    ranked,
    rankBy,
    setRankBy,
    declinedIds,
    primary,
    gapMinutes,
    recommendation,
    dashboard,
    selectCandidate,
    canSelect,
  } = demo;
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const locked = !["idle", "ready", "checking", "declined"].includes(demo.offerStep);

  const eligible = eligibleOf(recommendation);
  const cheapest = rankCandidates(eligible, "cost")[0];
  const bestFit = rankCandidates(eligible, "fit")[0];
  if (!cheapest || !bestFit) {
    return (
      <div className="rx-econ">
        <div className="rx-empty">
          <strong>No eligible backup right now</strong>
          Every physician fails at least one hard rule for this gap. See off-shift eligibility for the reasons.
        </div>
        {!compact ? <ExcludedList /> : null}
      </div>
    );
  }
  const delta = bestFit.cost - cheapest.cost;
  const acceptedId = demo.lastFill?.physicianId;
  const cheapestDeclined = declinedIds.includes(cheapest.candidate.physician_id);

  const firstOpen = ranked.find((c) => !declinedIds.includes(c.candidate.physician_id));
  const pickedOther = Boolean(primary && firstOpen && primary.candidate.physician_id !== firstOpen.candidate.physician_id);
  const pickDelta = primary ? primary.cost - cheapest.cost : 0;
  const verdict = acceptedId ? (
    <>Accepted by {physicianName(acceptedId, dashboard.physicians)}. Offers stopped.</>
  ) : pickedOther && primary ? (
    <>
      {physicianName(primary.candidate.physician_id, dashboard.physicians)} selected
      {pickDelta > 0 ? (
        <>
          {" "}· <b className="num">{usd(pickDelta)}</b> more than the lowest-cost option
        </>
      ) : null}
      {primary.minutesClosed >= gapMinutes && cheapest.minutesClosed < gapMinutes ? ", closes the full gap" : ""}.
    </>
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

  const selectable = (id: string) => canSelect && !declinedIds.includes(id) && !acceptedId;

  // Radio-group keyboard model: arrows move and select, skipping declined rows.
  const onRowKey = (e: KeyboardEvent<HTMLLIElement>, i: number) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      selectCandidate(ranked[i].candidate.physician_id);
      return;
    }
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    for (let n = 1; n <= ranked.length; n++) {
      const j = (i + step * n + ranked.length) % ranked.length;
      const id = ranked[j].candidate.physician_id;
      if (selectable(id)) {
        selectCandidate(id);
        rowRefs.current[j]?.focus();
        return;
      }
    }
  };

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
        <ol
          className="rx-ladder"
          role="radiogroup"
          aria-label="Physician to receive the offer"
          aria-disabled={!canSelect || Boolean(acceptedId)}
        >
          {ranked.map((c, i) => {
            const id = c.candidate.physician_id;
            const declined = declinedIds.includes(id);
            const isPrimary = primary?.candidate.physician_id === id && !acceptedId;
            const partial = c.minutesClosed < gapMinutes;
            const name = physicianName(id, dashboard.physicians);
            return (
              <motion.li
                key={id}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                layout={!reduce}
                transition={{ duration: 0.4, ease: EASE }}
                role="radio"
                aria-checked={isPrimary || acceptedId === id}
                aria-disabled={!selectable(id)}
                tabIndex={isPrimary && selectable(id) ? 0 : -1}
                onClick={() => selectable(id) && selectCandidate(id)}
                onKeyDown={(e) => onRowKey(e, i)}
                className={`rx-ladder-row${isPrimary || acceptedId === id ? " is-primary" : ""}${declined ? " is-declined" : ""}${selectable(id) ? " is-selectable" : ""}`}
              >
                <span className="rx-rank num">{i + 1}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                  {!compact ? <Avatar name={name} seed={id} /> : null}
                  <div style={{ minWidth: 0 }}>
                    <div className="rx-ladder-name">
                      <strong>{name}</strong>
                      {acceptedId === id ? <Pill tone="ok">Accepted</Pill> : null}
                      {isPrimary ? <Pill tone="accent">Selected</Pill> : null}
                      {i === 0 && !isPrimary && !declined && !acceptedId ? (
                        <Pill>{rankBy === "cost" ? "Lowest cost" : "Best fit"}</Pill>
                      ) : null}
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
                <span className="rx-radio" aria-hidden />
              </motion.li>
            );
          })}
        </ol>
      </LayoutGroup>

      {!compact ? <ExcludedList /> : null}

      <p className="rx-note">
        Synthetic rates, {Math.round((SPLIT_SHIFT_PREMIUM - 1) * 100)}% split-shift premium. Cost only reorders
        physicians who pass every hard rule; eligibility is never traded for price.
      </p>
    </div>
  );
}
