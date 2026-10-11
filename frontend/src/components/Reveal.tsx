import type { CSSProperties, ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  /** Stagger within a row, 0–0.2. Shifts where in the scroll the lift happens. */
  delay?: number;
  as?: "section" | "div";
  "aria-labelledby"?: string;
  "aria-label"?: string;
};

/**
 * Lifts content into place as it scrolls into view, driven by a CSS scroll
 * timeline (see `.reveal` in styles.css). Content is visible by default, so
 * browsers without scroll-driven animations or with reduced motion simply
 * render it in place.
 */
export function Reveal({ children, className, delay = 0, as = "section", ...aria }: Props) {
  const Tag = as;
  const style = delay ? ({ "--reveal-offset": Math.round(delay * 100) } as CSSProperties) : undefined;
  return (
    <Tag className={`reveal${className ? ` ${className}` : ""}`} style={style} {...aria}>
      {children}
    </Tag>
  );
}
