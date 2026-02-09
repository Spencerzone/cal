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
}

let dbPromise: Promise<IDBPDatabase<DaybookDB>> | null = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<DaybookDB>("daybook", 1, {
      upgrade(db) {
        const be = db.createObjectStore("baseEvents", { keyPath: "id" });
        be.createIndex("byStartUtc", "dtStartUtc");
        be.createIndex("byCode", "code");
        be.createIndex("byType", "type");
        // add near other stores
const te = db.createObjectStore("cycleTemplateEvents", { keyPath: "id" });
te.createIndex("byDayLabel", "dayLabel");
te.createIndex("byStartMinutes", "startMinutes");
        

        db.createObjectStore("userEventMeta", { keyPath: "eventId" });
        db.createObjectStore("imports", { keyPath: "importId" });
      },
    });
  }
  return dbPromise;
}