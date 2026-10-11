import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  /** Seconds to wait after entering view; use small steps (0.06–0.1) to stagger siblings. */
  delay?: number;
  as?: "section" | "div" | "li" | "footer";
  id?: string;
  style?: CSSProperties;
  "aria-labelledby"?: string;
  "aria-label"?: string;
};

/**
 * Slides content into place the first time it scrolls into view.
 *
 * Content is visible by default. It is only hidden when `html.rv-on` is set
 * (see main.tsx), which happens when IntersectionObserver exists and the user
 * has not asked for reduced motion, so nothing ever ships blank.
 */
export function Reveal({ children, className, delay = 0, as = "section", style, ...rest }: Props) {
  const Tag = as as ElementType;
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.06 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`rv${shown ? " is-in" : ""}${className ? ` ${className}` : ""}`}
      style={delay ? ({ ...style, "--rv-delay": `${delay}s` } as CSSProperties) : style}
      {...rest}
    >
      {children}
    </Tag>
  );
}
