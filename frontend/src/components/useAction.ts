import { useState } from "react";
import { ApiError, describeError } from "../api";

export interface Notice {
  kind: "ok" | "error" | "warn";
  text: string;
}

/** Run a mutation with a busy flag, a readable outcome message and an immediate refetch. */
export function useAction(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const run = async <T,>(id: string, fn: () => Promise<T>, ok?: (r: T) => string): Promise<T | null> => {
    setBusy(id);
    setNotice(null);
    try {
      const r = await fn();
      if (ok) setNotice({ kind: "ok", text: ok(r) });
      return r;
    } catch (e) {
      const extra = e instanceof ApiError && Array.isArray(e.detail.failed_rules)
        ? ` (${(e.detail.failed_rules as string[]).join("; ")})` : "";
      setNotice({ kind: "error", text: describeError(e) + extra });
      return null;
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  return { busy, notice, setNotice, run };
}
