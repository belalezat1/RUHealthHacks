import { Link } from "react-router-dom";
import { brand } from "../brand";

type Props = {
  size?: "nav" | "hero" | "sm";
  href?: string | null;
};

export function RelayMark({ size = "nav", href = "/" }: Props) {
  const fs = size === "hero" ? "2.85rem" : size === "sm" ? "1.2rem" : "1.75rem";
  const icon = size === "hero" ? 48 : size === "sm" ? 26 : 40;

  const inner = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        color: "var(--text)",
        textDecoration: "none",
      }}
    >
      <span className="relay-mark-icon" style={{ width: icon, height: icon }}>
        <svg width={icon * 0.58} height={icon * 0.58} viewBox="0 0 32 32" aria-hidden>
          <path
            d="M8 20h6l2-8 2 8h6"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span
        style={{
          fontFamily: "var(--font-ui)",
          fontWeight: 700,
          fontSize: fs,
          letterSpacing: "-0.04em",
        }}
      >
        {brand.nameLower}
      </span>
    </span>
  );

  if (href === null) return inner;
  return (
    <Link to={href} style={{ textDecoration: "none" }}>
      {inner}
    </Link>
  );
}