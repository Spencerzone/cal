import { useEffect, useState } from "react";
import { addDays, format, isValid, parseISO } from "date-fns";

import { useAuth } from "../auth/AuthProvider";
import { dayLabelForDate } from "../rolling/cycle";
import { getRollingSettings } from "../rolling/settings";
import type { TermKey } from "../rolling/settings";
import { termInfoForDate } from "../rolling/termWeek";

/** Header badge: school days remaining until the end of the current term. */
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
        // Count school days (weekdays that aren't excluded) from today through term end, inclusive.
        let days = 0;
        const endKey = format(end, "yyyy-MM-dd");
        for (let d = new Date(today); format(d, "yyyy-MM-dd") <= endKey; d = addDays(d, 1)) {
          if (dayLabelForDate(format(d, "yyyy-MM-dd"), settings)) days++;
        }
        if (days <= 0) setText("");
        else if (days === 1) setText("Last school day of term");
        else setText(`${days} school days left`);
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
