import { useEffect, useState } from "react";
import { differenceInCalendarDays, format, isValid, parseISO } from "date-fns";

import { useAuth } from "../auth/AuthProvider";
import { getRollingSettings } from "../rolling/settings";
import type { TermKey } from "../rolling/settings";
import { termInfoForDate } from "../rolling/termWeek";

/** Small header label: calendar days remaining until the end of the current term. */
export default function TermCountdown() {
  const { user } = useAuth();
  const [text, setText] = useState("");

  useEffect(() => {
    if (!user) {
      setText("");
      return;
    }
    let cancelled = false;

    async function load() {
      try {
        const settings = await getRollingSettings(user!.uid);
        const today = new Date();
        const info = termInfoForDate(today, settings);
        const ty = info
          ? (settings.termYears ?? []).find((y) => y.year === info.year)
          : undefined;
        const endIso = (ty?.ends?.[`t${info?.term}` as TermKey] ?? "").trim();
        const end = endIso ? parseISO(endIso) : null;
        if (cancelled) return;
        if (!info || !end || !isValid(end)) {
          setText("");
          return;
        }
        const days = differenceInCalendarDays(
          end,
          parseISO(format(today, "yyyy-MM-dd")),
        );
        if (days < 0) setText("");
        else if (days === 0) setText("Last day of term");
        else setText(`${days} day${days === 1 ? "" : "s"} left in term`);
      } catch {
        if (!cancelled) setText("");
      }
    }

    load();
    window.addEventListener("rolling-settings-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("rolling-settings-changed", load);
    };
  }, [user]);

  if (!text) return null;
  return <span className="termCountdown">{text}</span>;
}
