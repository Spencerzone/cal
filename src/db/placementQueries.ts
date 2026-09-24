// src/db/placementQueries.ts (Firestore source-of-truth)

import {
  deleteDoc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import {
  placementDoc,
  placementsCol,
  type DayLabel,
  type Placement,
  type PlacementVersion,
  type SlotId,
} from "./db";

function keyFor(year: number, dayLabel: DayLabel, slotId: SlotId) {
  return `${year}::${dayLabel}::${slotId}`;
}

export type PlacementMode = "template" | "override" | "blank";

type PlacementPatch = {
  mode?: PlacementMode;

  subjectId?: string | null;
  roomOverride?: string | null;
};

function normaliseNext(next?: PlacementPatch): PlacementPatch {
  const n: PlacementPatch = (next ?? {}) as PlacementPatch;
  const out: PlacementPatch = {};
  if (Object.prototype.hasOwnProperty.call(n, "mode") && n.mode)
    out.mode = n.mode;

  if (Object.prototype.hasOwnProperty.call(n, "subjectId")) {
    const v = (n as any).subjectId;
    // Firestore does not allow `undefined`. Only persist string or null.
    if (typeof v === "string" || v === null) out.subjectId = v;
  }

  if (Object.prototype.hasOwnProperty.call(n, "roomOverride")) {
    const v = (n as any).roomOverride;
    if (typeof v === "string" || v === null) out.roomOverride = v;
  }

  return out;
}

function mergePlacement(
  existing: Placement | undefined,
  userId: string,
  year: number,
  dayLabel: DayLabel,
  slotId: SlotId,
  patch: PlacementPatch,
): Placement | null {
  const next: Placement = {
    key: keyFor(year, dayLabel, slotId),
    year,
    userId,
    dayLabel,
    slotId,
  };

  if (existing?.subjectId !== undefined) next.subjectId = existing.subjectId;
  if (existing?.roomOverride !== undefined)
    next.roomOverride = existing.roomOverride;

  const hasSubjectPatch = Object.prototype.hasOwnProperty.call(
    patch,
    "subjectId",
  );
  const hasRoomPatch = Object.prototype.hasOwnProperty.call(
    patch,
    "roomOverride",
  );

  if (hasSubjectPatch) {
    if (patch.subjectId === undefined) {
      delete (next as any).subjectId;
    } else {
      next.subjectId = patch.subjectId;
    }
  }

  if (hasRoomPatch) {
    if (patch.roomOverride === undefined) {
      delete (next as any).roomOverride;
    } else {
      next.roomOverride = patch.roomOverride;
    }
  }

  const hasSubjectOverride = next.subjectId !== undefined;
  const hasRoomOverride = next.roomOverride !== undefined;

  if (!hasSubjectOverride && !hasRoomOverride) return null;
  return next;
}

export async function getPlacementsForDayLabels(
  userId: string,
  year: number,
  dayLabels: DayLabel[],
): Promise<Placement[]> {
  if (dayLabels.length === 0) return [];
  const out: Placement[] = [];
  const col = placementsCol(userId);

  const CHUNK = 10;
  for (let i = 0; i < dayLabels.length; i += CHUNK) {
    const chunk = dayLabels.slice(i, i + CHUNK);
    const q = query(
      col,
      where("year", "==", year),
      where("dayLabel", "in", chunk),
    );
    const snap = await getDocs(q);
    out.push(...snap.docs.map((d) => d.data() as Placement));
  }

  // Deduplicate: legacy docs use key `${dayLabel}::${slotId}` (no year prefix) but
  // still store `year` as a field, so the query returns both old and new docs for the
  // same slot. Prefer the canonical year-prefixed document over legacy ones.
  const best = new Map<string, Placement>();
  for (const p of out) {
    const k = `${p.dayLabel}::${p.slotId}`;
    const isCanonical = p.key === keyFor(year, p.dayLabel, p.slotId);
    if (!best.has(k) || isCanonical) best.set(k, p);
  }
  return Array.from(best.values());
}

export async function getPlacement(
  userId: string,
  year: number,
  dayLabel: DayLabel,
  slotId: SlotId,
): Promise<Placement | undefined> {
  const ref = placementDoc(userId, keyFor(year, dayLabel, slotId));
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as Placement) : undefined;
}

export async function upsertPlacementPatch(
  userId: string,
  year: number,
  dayLabel: DayLabel,
  slotId: SlotId,
  patch: PlacementPatch,
): Promise<void> {
  const ref = placementDoc(userId, keyFor(year, dayLabel, slotId));
  // Legacy docs used `${dayLabel}::${slotId}` as the document ID (no year prefix)
  // but still stored `year` as a field, so queries return both. Read and migrate on write.
  const legacyRef = placementDoc(userId, `${dayLabel}::${slotId}`);

  await runTransaction(db, async (tx) => {
    const [snap, legacySnap] = await Promise.all([tx.get(ref), tx.get(legacyRef)]);
    // Prefer the canonical doc; fall back to legacy so its data isn't lost
    const existing = snap.exists()
      ? (snap.data() as Placement)
      : legacySnap.exists()
        ? (legacySnap.data() as Placement)
        : undefined;
    const merged = mergePlacement(existing, userId, year, dayLabel, slotId, patch);

    if (!merged) {
      if (snap.exists()) tx.delete(ref);
      if (legacySnap.exists()) tx.delete(legacyRef);
    } else {
      tx.set(ref, merged, { merge: false });
      // Remove legacy doc so it can no longer shadow the canonical one
      if (legacySnap.exists()) tx.delete(legacyRef);
    }
  });

  window.dispatchEvent(new Event("placements-changed"));
}

export async function setPlacement(
  userId: string,
  year: number,
  dayLabel: DayLabel,
  slotId: SlotId,
  next?: PlacementPatch,
): Promise<void> {
  const ref = placementDoc(userId, keyFor(year, dayLabel, slotId));
  const n = normaliseNext(next);

  const p: any = {
    key: keyFor(year, dayLabel, slotId),
    year,
    userId,
    dayLabel,
    slotId,
  };
  if (Object.prototype.hasOwnProperty.call(n, "subjectId"))
    p.subjectId = n.subjectId;
  if (Object.prototype.hasOwnProperty.call(n, "roomOverride"))
    p.roomOverride = n.roomOverride;
  if (Object.prototype.hasOwnProperty.call(n, "mode")) p.mode = n.mode;

  const hasSubjectOverride = Object.prototype.hasOwnProperty.call(
    p,
    "subjectId",
  );
  const hasRoomOverride = Object.prototype.hasOwnProperty.call(
    p,
    "roomOverride",
  );

  const hasMode = Object.prototype.hasOwnProperty.call(p, "mode");

  if (!hasSubjectOverride && !hasRoomOverride && !hasMode) {
    await deleteDoc(ref);
  } else {
    await runTransaction(db, async (tx) => {
      tx.set(ref, p, { merge: false });
    });
  }

  window.dispatchEvent(new Event("placements-changed"));
}

export async function deletePlacement(
  userId: string,
  year: number,
  dayLabel: DayLabel,
  slotId: SlotId,
): Promise<void> {
  await deleteDoc(placementDoc(userId, keyFor(year, dayLabel, slotId)));
  window.dispatchEvent(new Event("placements-changed"));
}

export async function deletePlacementsReferencingSubject(
  userId: string,
  subjectId: string,
): Promise<void> {
  const col = placementsCol(userId);
  const q = query(col, where("subjectId", "==", subjectId));
  const snap = await getDocs(q);
  for (const d of snap.docs) await deleteDoc(d.ref);
  window.dispatchEvent(new Event("placements-changed"));
}

export type ResolvedPlacement = {
  dayLabel: DayLabel;
  slotId: SlotId;
  subjectId?: string | null;
  roomOverride?: string | null;
};

/**
 * Resolves which state of a Placement applies on `dateKey`.
 *
 * If the doc has `versions`, picks the version with the latest `effectiveFrom`
 * that is `<= dateKey`, then checks it hasn't been superseded by its own
 * `effectiveTo`. Falls back to the doc's legacy flat `subjectId`/`roomOverride`
 * fields (treated as always-effective) for docs written before versioning
 * existed. Returns `undefined` when no version applies (nothing overrides the
 * template for that date).
 */
export function resolvePlacementVersion(
  p: Placement | undefined,
  dateKey: string,
): { subjectId?: string | null; roomOverride?: string | null } | undefined {
  if (!p) return undefined;

  if (p.versions && p.versions.length) {
    let best: PlacementVersion | undefined;
    for (const v of p.versions) {
      if (v.effectiveFrom > dateKey) continue;
      if (!best || v.effectiveFrom > best.effectiveFrom) best = v;
    }
    if (!best) return undefined;
    if (best.effectiveTo && dateKey >= best.effectiveTo) return undefined;

    const out: { subjectId?: string | null; roomOverride?: string | null } = {};
    if (Object.prototype.hasOwnProperty.call(best, "subjectId"))
      out.subjectId = best.subjectId;
    if (Object.prototype.hasOwnProperty.call(best, "roomOverride"))
      out.roomOverride = best.roomOverride;
    return out;
  }

  const out: { subjectId?: string | null; roomOverride?: string | null } = {};
  let has = false;
  if (Object.prototype.hasOwnProperty.call(p, "subjectId")) {
    out.subjectId = p.subjectId;
    has = true;
  }
  if (Object.prototype.hasOwnProperty.call(p, "roomOverride")) {
    out.roomOverride = p.roomOverride;
    has = true;
  }
  return has ? out : undefined;
}

/**
 * Like `getPlacementsForDayLabels`, but resolves each doc's effective-dated
 * `versions` (or legacy flat fields) against `dateKey`, so callers rendering a
 * specific date always see the state that was/will-be in effect on that date —
 * not just whatever is currently in the doc.
 */
export async function getResolvedPlacementsForDayLabels(
  userId: string,
  year: number,
  dayLabels: DayLabel[],
  dateKey: string,
): Promise<ResolvedPlacement[]> {
  const placements = await getPlacementsForDayLabels(userId, year, dayLabels);
  const out: ResolvedPlacement[] = [];
  for (const p of placements) {
    const resolved = resolvePlacementVersion(p, dateKey);
    if (!resolved) continue;
    out.push({ dayLabel: p.dayLabel, slotId: p.slotId, ...resolved });
  }
  return out;
}

export type EffectiveDatedPatch = {
  effectiveFrom: string; // yyyy-MM-dd — the change takes effect from this date
  effectiveTo?: string | null; // optional explicit end date for the new version
  // Omit a field to carry it forward unchanged from whatever was effective
  // immediately before `effectiveFrom`; pass `null` to explicitly blank it.
  subjectId?: string | null;
  roomOverride?: string | null;
};

function seedVersionsFromLegacy(existing: Placement | undefined): PlacementVersion[] {
  if (existing?.versions) return existing.versions.map((v) => ({ ...v }));
  if (
    existing &&
    (Object.prototype.hasOwnProperty.call(existing, "subjectId") ||
      Object.prototype.hasOwnProperty.call(existing, "roomOverride"))
  ) {
    // Migrate legacy flat fields into a single open-ended version effective
    // "from the beginning of time" so historical dates keep resolving exactly
    // as they did before this doc was versioned.
    return [
      {
        effectiveFrom: "0001-01-01",
        ...(Object.prototype.hasOwnProperty.call(existing, "subjectId")
          ? { subjectId: existing.subjectId }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(existing, "roomOverride")
          ? { roomOverride: existing.roomOverride }
          : {}),
      },
    ];
  }
  return [];
}

/**
 * Appends a new effective-dated version to a Placement slot, effective from
 * `patch.effectiveFrom` onward. Fields left out of `patch` carry forward
 * unchanged from whatever was effective immediately before that date (same
 * merge semantics as the old `upsertPlacementPatch`), so e.g. a room-only
 * edit doesn't blank out the subject. The immediately-preceding version (if
 * any) has its `effectiveTo` capped to the new version's start, so it — and
 * every version before it — is preserved exactly as it was for any date
 * before the change.
 *
 * This is the write path for all "change from date X" edits: cancelling a
 * class forward, starting a new one on a future date, or moving a class to a
 * different slot (blank the old slot + set the new slot, both effective from
 * the same date).
 */
export async function addPlacementVersion(
  userId: string,
  year: number,
  dayLabel: DayLabel,
  slotId: SlotId,
  patch: EffectiveDatedPatch,
): Promise<void> {
  const ref = placementDoc(userId, keyFor(year, dayLabel, slotId));
  // Legacy docs used `${dayLabel}::${slotId}` as the document ID (no year prefix).
  const legacyRef = placementDoc(userId, `${dayLabel}::${slotId}`);

  await runTransaction(db, async (tx) => {
    const [snap, legacySnap] = await Promise.all([tx.get(ref), tx.get(legacyRef)]);
    const existing: Placement | undefined = snap.exists()
      ? (snap.data() as Placement)
      : legacySnap.exists()
        ? (legacySnap.data() as Placement)
        : undefined;

    let versions = seedVersionsFromLegacy(existing);

    // Baseline = whatever is resolved as effective at `effectiveFrom` today
    // (before this edit), including a version that already starts exactly on
    // that date — so repeated same-day edits merge onto each other like the
    // old flat-doc behaviour did.
    const pseudo: Placement = {
      key: keyFor(year, dayLabel, slotId),
      year,
      userId,
      dayLabel,
      slotId,
      versions,
    };
    const baseline = resolvePlacementVersion(pseudo, patch.effectiveFrom) ?? {};

    const hasSubjectPatch = Object.prototype.hasOwnProperty.call(patch, "subjectId");
    const hasRoomPatch = Object.prototype.hasOwnProperty.call(patch, "roomOverride");
    const nextSubjectId = hasSubjectPatch ? patch.subjectId : baseline.subjectId;
    const nextRoomOverride = hasRoomPatch ? patch.roomOverride : baseline.roomOverride;

    const nv: PlacementVersion = { effectiveFrom: patch.effectiveFrom };
    if (nextSubjectId !== undefined) nv.subjectId = nextSubjectId;
    if (nextRoomOverride !== undefined) nv.roomOverride = nextRoomOverride;
    if (Object.prototype.hasOwnProperty.call(patch, "effectiveTo"))
      nv.effectiveTo = patch.effectiveTo ?? null;

    // Cap the immediately-preceding version's effectiveTo at the new version's
    // start, so it stops applying exactly where the new one takes over.
    const prior = versions
      .filter((v) => v.effectiveFrom < patch.effectiveFrom)
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
    if (prior && (!prior.effectiveTo || prior.effectiveTo > patch.effectiveFrom)) {
      prior.effectiveTo = patch.effectiveFrom;
    }

    // Replace any existing version that starts on the exact same date.
    versions = versions.filter((v) => v.effectiveFrom !== patch.effectiveFrom);
    versions.push(nv);
    versions.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));

    const next: Placement = {
      key: keyFor(year, dayLabel, slotId),
      year,
      userId,
      dayLabel,
      slotId,
      versions,
    };
    tx.set(ref, next, { merge: false });
    if (legacySnap.exists()) tx.delete(legacyRef);
  });

  window.dispatchEvent(new Event("placements-changed"));
}
