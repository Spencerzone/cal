# DayBook — Codebase Guide

## What This App Is

DayBook is a school timetable PWA for teachers. It shows a rolling A/B week cycle timetable, lets the user write rich-text lesson plans per period per day, and provides day-level notes. Data is stored in Firebase Firestore, scoped per authenticated user.

## Tech Stack

| Layer | Tool |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Vite 5 + `vite-plugin-pwa` |
| Routing | React Router v6 |
| Backend | Firebase Auth + Firestore |
| Dates | `date-fns` + `date-fns-tz` |
| ICS import | `ical.js` |

No CSS framework — plain CSS variables in `src/index.css` with dark/light theme via `[data-theme]`.

## Commands

```bash
npm run dev       # dev server (http://localhost:5173)
npm run build     # production build
npm run preview   # preview production build
```

There are no test scripts. TypeScript is checked via `vite build`.

## Project Structure

```
src/
  App.tsx                    # Shell: nav drawer, theme toggle, routes
  main.tsx                   # React + Router bootstrap
  firebase.ts                # Firebase init (reads .env for config)
  index.css                  # All CSS — variables, layout, components

  auth/
    AuthProvider.tsx         # Firebase Auth context + useAuth hook
    RequireAuth.tsx          # Route guard — redirects to /login if not authed

  db/
    db.ts                    # Firestore types + path helpers (collections/docs)
    dayNoteQueries.ts        # Day-level HTML notes (users/{uid}/dayNotes/{dateKey})
    lessonPlanQueries.ts     # Per-period HTML plans + URL attachments
    subjectQueries.ts        # Subject CRUD
    blockQueries.ts          # Time block definitions
    blockMutations.ts        # Block mutations
    placementQueries.ts      # Subject placements per DayLabel+SlotId
    itemQueries.ts           # Items (classes/duties/breaks)
    assignmentQueries.ts     # Slot assignments
    templateQueries.ts       # Cycle template events
    queries.ts               # Misc/shared queries
    seed.ts                  # Database seeding utilities
    seedItemsFromTemplates.ts
    seedSubjects.ts
    subjectUtils.ts

  rolling/
    cycle.ts                 # Core: date → DayLabel (MonA/TueB/etc.)
    termWeek.ts              # Term + week number for a given date
    settings.ts              # RollingSettings type + Firestore get/set
    slots.ts                 # SlotId definitions and display metadata
    generate.ts              # Generate timetable rows for a given date
    buildSlotAssignments.ts  # Build SlotAssignment from template events
    buildTemplateFromIcs.ts  # Parse ICS into template events
    templateMapping.ts       # Map ICS events to subjects

  ics/
    parseIcs.ts              # Parse .ics file into BaseEvent[]
    importIcs.ts             # Import ICS into Firestore

  components/
    RichTextPlanEditor.tsx   # Reusable rich-text editor (contentEditable, debounced save)

  pages/
    TodayPage.tsx            # Main view: today's timetable + day note
    WeekPage.tsx             # Week grid view (Mon–Fri, all slots)
    SubjectsPage.tsx         # List/manage subjects
    SubjectPage.tsx          # Individual subject detail
    MatrixPage.tsx           # Subject × DayLabel placement matrix
    BlocksPage.tsx           # Time block management
    TemplateMappingPage.tsx  # Map ICS event titles to subjects
    SetupPage.tsx            # Initial rolling settings (term dates, cycle start)
    ImportPage.tsx           # Import .ics timetable file
    LoginPage.tsx            # Firebase Auth sign-in

  util/
    time.ts                  # Date/time helpers
```

## Firestore Data Model

All data lives under `users/{uid}/...` — each user has a fully isolated subtree.

| Collection | Key | Description |
|---|---|---|
| `subjects` | subjectId | Subject definitions (title, code, color, year) |
| `placements` | `{year}::{dayLabel}::{slotId}` | Maps a slot to a subject |
| `slotAssignments` | `{dayLabel}::{slotId}` | Slot → kind (class/duty/break/free) from template |
| `cycleTemplateEvents` | uuid | Template events imported from ICS |
| `lessonPlans` | `{dateKey}::{slotId}` | Rich-text HTML plan for a specific date+slot |
| `lessonAttachments` | uuid | URL attachments linked to lesson plans |
| `dayNotes` | dateKey (yyyy-MM-dd) | Day-level HTML note |
| `settings` | `"rolling"` | RollingSettings (cycle start, term dates, active year) |
| `blocks` | uuid | Time block definitions (name, kind, orderIndex) |
| `items` | uuid | Generic items (class/duty/break/event) |
| `imports` | importId | Import history records |
| `baseEvents` | uuid | Raw events from ICS import |
| `userEventMeta` | eventId | Per-event user overrides (hidden, colour, note) |

Document IDs containing `/` are sanitised via `safeDocId()` in `db.ts` (replaces `/` with `_`).

## Rolling Cycle System

The core concept: each school day maps to a `DayLabel` like `MonA`, `TueB`, `WedA`, etc.

### DayLabel (`src/rolling/cycle.ts`)
- 10 possible values: `MonA`–`FriA`, `MonB`–`FriB`
- `dayLabelForDate(dateKey, settings)` → `DayLabel | null`
  - Returns `null` for weekends, excluded dates, or dates outside term ranges
  - **Term-based mode** (preferred): uses `termYears` in settings; A/B set comes from `termInfoForDate()`
  - **Anchor-based mode** (fallback): counts school days from `cycleStartDate`, alternating A/B weeks

### Slots (`src/rolling/slots.ts`)
Fixed ordered list of `SlotId` values:
`before` → `rc` → `p1` → `p2` → `r1` → `r2` → `p3` → `p4` → `l1` → `l2` → `p5` → `p6` → `after`

Period slots: `p1`–`p6`. Recess: `r1`, `r2`. Lunch: `l1`, `l2`. Admin slots: `before`, `rc`, `after`.

### RollingSettings (`src/rolling/settings.ts`)
```typescript
interface RollingSettings {
  cycleStartDate: string;   // YYYY-MM-DD — anchor for A/B calculation
  excludedDates: string[];  // Public holidays, etc.
  overrides: Array<{ date: string; set: WeekSet }>; // Manual A/B overrides
  activeYear?: number;      // Academic year for scoping data
  termYears?: TermYear[];   // Per-year term start/end dates and week1 A/B set
}
```

Settings are read/written via `getRollingSettings` / `setRollingSettings` in `src/rolling/settings.ts`. They are stored as `{ key: "rolling", value: RollingSettings }` in the `settings` collection.

## Routes

| Path | Page | Description |
|---|---|---|
| `/` | TodayPage | Today's timetable (default) |
| `/week` | WeekPage | Full week grid |
| `/subjects` | SubjectsPage | Subject list |
| `/subjects/:id` | SubjectPage | Subject detail |
| `/matrix` | MatrixPage | Placement matrix |
| `/blocks` | BlocksPage | Time blocks |
| `/template-mapping` | TemplateMappingPage | ICS → subject mapping |
| `/setup` | SetupPage | Rolling settings |
| `/import` | ImportPage | ICS import |
| `/login` | LoginPage | Auth |

All routes except `/login` are wrapped in `<RequireAuth>`.

## RichTextPlanEditor Component

`src/components/RichTextPlanEditor.tsx` — reusable rich-text editor for lesson plans and day notes.

**Key props:**
```typescript
userId: string
dateKey?: string        // for lesson plans
slotId?: SlotId         // for lesson plans
year?: number           // for lesson plans
initialHtml: string     // controlled initial value
attachments?: LessonAttachment[]
palette?: Record<string, string>
onSave?: (html: string) => void  // custom save callback (for day notes)
placeholder?: string
label?: string
compact?: boolean       // smaller inactive height (36px vs 72px)
filledCardStyle?: CSSProperties  // extra styles when content is present
```

**Behaviour:**
- Inactive by default; clicks activate the editor
- 600ms debounced save on every keystroke
- Uses `execCommand` for bold/italic/underline formatting
- `dirtyRef` flag prevents `initialHtml` prop changes from overwriting in-progress edits
- **Critical:** `useEffect` only depends on `[initialHtml]`, NOT `[initialHtml, active]` — removing `active` from deps prevents stale overwrites when the editor deactivates before the debounce fires

## Theme System

Theme is stored in `localStorage` under key `daybook.theme` (default: `"dark"`).

Applied via `document.documentElement.dataset.theme = theme` — CSS uses `[data-theme="light"]` overrides.

Key CSS variables: `--bg`, `--panel`, `--panel2`, `--panel3`, `--text`, `--muted`, `--line`, `--accent`, `--editor-bg`.

## Cross-Component Events

Components communicate via `window.dispatchEvent(new Event(...))`:

| Event | Fired when |
|---|---|
| `daynote-changed` | Day note saved/deleted |
| `lessonplans-changed` | Lesson plan saved/deleted/attachment changed |
| `rolling-settings-changed` | Rolling settings updated |

## Key Patterns and Conventions

- **Year-scoped data**: Subjects, placements, lesson plans, and template events are scoped to `activeYear`. Queries include `where("year", "==", year)`.
- **dateKey format**: Always `yyyy-MM-dd` (local date, no timezone).
- **safeDocId**: Always wrap Firestore document IDs through `safeDocId()` to replace `/` with `_`.
- **No test suite**: There are no unit or integration tests. Manual testing only.
- **No state management library**: Local `useState`/`useEffect` + Firestore reads. No Redux/Zustand/etc.
- **PWA**: Service worker via `vite-plugin-pwa`. Icons at `public/pwa-192.png` and `public/pwa-512.png`.
- **ICS import**: `.ics` files are parsed with `ical.js`, events are mapped to subjects via `TemplateMappingPage`, then stored as `cycleTemplateEvents`.
- **Firestore File Uploads**: Firebase Storage is not enabled. File attachments are disabled; only URL attachments work.
