export type SlotId =
  | "before" | "rc"
  | "p1" | "p2"
  | "r1" | "r2"
  | "p3" | "p4"
  | "l1" | "l2"
  | "p5" | "p6"
  | "after";

export const SLOT_DEFS: Array<{ id: SlotId; label: string }> = [
  { id: "before", label: "Before school" },
  { id: "rc", label: "Roll call" },
  { id: "p1", label: "Period 1" },
  { id: "p2", label: "Period 2" },
  { id: "r1", label: "Recess 1" },
  { id: "r2", label: "Recess 2" },
  { id: "p3", label: "Period 3" },
  { id: "p4", label: "Period 4" },
  { id: "l1", label: "Lunch 1" },
  { id: "l2", label: "Lunch 2" },
  { id: "p5", label: "Period 5" },
  { id: "p6", label: "Period 6" },
  { id: "after", label: "After school" },
];