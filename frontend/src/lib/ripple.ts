import { useEffect } from "react";

const TARGETS = ".rx-btn, .rx-preset, .btn";

/**
 * One delegated listener gives every button a press ripple from the pointer.
 * Skipped entirely for reduced-motion users and disabled controls.
 */
export function usePressRipple() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onDown = (e: PointerEvent) => {
      if (media.matches || e.button !== 0) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>(TARGETS);
      if (!el || (el as HTMLButtonElement).disabled) return;
      const rect = el.getBoundingClientRect();
      const d = Math.hypot(rect.width, rect.height) * 2;
      const ripple = document.createElement("span");
      ripple.className = "press-ripple";
      ripple.style.width = ripple.style.height = `${d}px`;
      ripple.style.left = `${e.clientX - rect.left - d / 2}px`;
      ripple.style.top = `${e.clientY - rect.top - d / 2}px`;
      el.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
}
