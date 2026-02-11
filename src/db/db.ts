// src/db/db.ts
import { openDB, DBSchema, IDBPDatabase } from "idb";
import type { BaseEvent } from "../ics/parseIcs";

export type BlockKind = "class" | "break" | "duty" | "admin" | "other";

export interface UserEventMeta {
  eventId: string;
  hidden: boolean;
  colour: string | null;
  note: string | null;
}

export type ItemType = "class" | "duty" | "break" | "event" | "other";

export type Item = {
  id: string;          // uuid
  userId: string;
  type: ItemType;
  title: string;       // "10 Sci", "Yard Duty", "Recess"
  location?: string;
  color: string;       // "#RRGGBB"
  metaJson?: string;   // optional JSON string for now
};

export type Block = {
  id: string;          // uuid
  userId: string;
  name: string;        // "P1", "Recess", "Before school"
  kind: BlockKind;
  orderIndex: number;  // for drag/drop
  isVisible: 0 | 1;
};

export type SubjectKind = "subject" | "duty" | "break" | "other";

export type Subject = {
  id: string;          // e.g. "code::12INV01", "code::11Roll7", "duty"
  userId: string;
  kind: SubjectKind;
  code: string | null; // "12INV01" etc
  title: string;       // editable display name
  color: string;       // #RRGGBB
};

export type Placement = {
  key: string;         // `${dayLabel}::${blockId}`
  userId: string;
  dayLabel: DayLabel;
  blockId: string;     // from blocks store
  subjectId: string | null; // null means blank/free
  note?: string;
};

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
   blocks: {
    key: string; // Block.id
    value: Block;
    indexes: {
      byUserId: string;
      byUserIdOrder: [string, number]; // [userId, orderIndex]
    };
  };
  items: {
    key: string; // Item.id
    value: Item;
    indexes: {
      byUserId: string;
      byUserIdType: [string, ItemType]; // [userId, type]
    };
  };
    subjects: {
    key: string; // Subject.id
    value: Subject;
    indexes: {
      byUserId: string;
      byUserIdKind: [string, SubjectKind];
    };
  };
  

}

let dbPromise: Promise<IDBPDatabase<DaybookDB>> | null = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<DaybookDB>("daybook", 6, {
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
        if (oldVersion < 5) {
          if (!db.objectStoreNames.contains("blocks")) {
            const b = db.createObjectStore("blocks", { keyPath: "id" });
            b.createIndex("byUserId", "userId");
            b.createIndex("byUserIdOrder", ["userId", "orderIndex"]);
          }

          if (!db.objectStoreNames.contains("items")) {
            const it = db.createObjectStore("items", { keyPath: "id" });
            it.createIndex("byUserId", "userId");
            it.createIndex("byUserIdType", ["userId", "type"]);
          }
        }
        if (oldVersion < 6) {
          if (!db.objectStoreNames.contains("subjects")) {
            const s = db.createObjectStore("subjects", { keyPath: "id" });
            s.createIndex("byUserId", "userId");
            s.createIndex("byUserIdKind", ["userId", "kind"]);
  }
}
      },
    });
  }
  return dbPromise;
}

