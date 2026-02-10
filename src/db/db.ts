// src/db/db.ts
import { openDB, DBSchema, IDBPDatabase } from "idb";
import type { BaseEvent } from "../ics/parseIcs";

export interface UserEventMeta {
  eventId: string;
  hidden: boolean;
  colour: string | null;
  note: string | null;
}

// src/db/db.ts (types)
export type DayLabel =
  | "MonA" | "TueA" | "WedA" | "ThuA" | "FriA"
  | "MonB" | "TueB" | "WedB" | "ThuB" | "FriB";

export interface CycleTemplateEvent {
  id: string;
  dayLabel: DayLabel;
  startMinutes: number;
  endMinutes: number;
  periodCode: string | null;
  type: "class" | "duty" | "break";
  code: string | null;
  title: string;
  room: string | null;
}

export interface ImportRow {
  importId: string;
  importedAt: number;
  icsName: string;
  icsHash: string;
}

export type SlotId =
  | "before" | "rc" | "p1" | "p2" | "r1" | "r2"
  | "p3" | "p4" | "l1" | "l2" | "p5" | "p6" | "after";

export type AssignmentKind = "class" | "duty" | "break" | "free";

export interface SlotAssignment {
  key: string;                 // dayLabel::slotId
  dayLabel: DayLabel;
  slotId: SlotId;
  kind: AssignmentKind;
  // If kind === "class" or "duty"/"break" sourced from template:
  sourceTemplateEventId?: string;
  // Manual override fields (if you want to type your own):
  manualTitle?: string;
  manualCode?: string | null;
  manualRoom?: string | null;
}

interface DaybookDB extends DBSchema {
  baseEvents: {
    key: string; // BaseEvent.id
    value: BaseEvent;
    indexes: {
      byStartUtc: number;
      byCode: string;
      byType: string;
    };
  };
  userEventMeta: {
    key: string; // eventId
    value: UserEventMeta;
  };
  imports: {
    key: string; // importId
    value: ImportRow;
  };
  cycleTemplateEvents: {
  key: string;
  value: CycleTemplateEvent;
  indexes: {
    byDayLabel: string;
    byStartMinutes: number;
  };
};
  settings: {
    key: string;
    value: { key: string; value: any };
  };
  slotAssignments: {
    key: string; // dayLabel::slotId
    value: SlotAssignment;
    indexes: {
      byDayLabel: DayLabel;
    };
  };
 
  

}

let dbPromise: Promise<IDBPDatabase<DaybookDB>> | null = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<DaybookDB>("daybook", 4, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const be = db.createObjectStore("baseEvents", { keyPath: "id" });
          be.createIndex("byStartUtc", "dtStartUtc");
          be.createIndex("byCode", "code");
          be.createIndex("byType", "type");

          db.createObjectStore("userEventMeta", { keyPath: "eventId" });
          db.createObjectStore("imports", { keyPath: "importId" });
        }

        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains("cycleTemplateEvents")) {
            const te = db.createObjectStore("cycleTemplateEvents", { keyPath: "id" });
            te.createIndex("byDayLabel", "dayLabel");
            te.createIndex("byStartMinutes", "startMinutes");
          }
        }
        
        if (oldVersion < 3) {
          if (!db.objectStoreNames.contains("settings")) {
            db.createObjectStore("settings", { keyPath: "key" });
          }
        }

        if (oldVersion < 4) {
  if (!db.objectStoreNames.contains("slotAssignments")) {
    const sa = db.createObjectStore("slotAssignments", { keyPath: "key" });
    sa.createIndex("byDayLabel", "dayLabel");
  }
}

      },
    });
  }
  return dbPromise;
}

