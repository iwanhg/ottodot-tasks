# Ottodot Trial Booking

A minimal trial-class booking backend for Ottodot: a parent picks a child + trial class, submits a booking, pays (mocked), and an admin/teacher can view the confirmed roster. Built for the take-home task, backend correctness and edge cases over frontend polish, per the brief.

## How to run

Requires Node 20+.

```bash
npm install
npm run seed    # resets and populates data.sqlite with demo data (safe to re-run)
npm run dev     # starts the API on http://localhost:3000
```

In another terminal:

```bash
npm test        # runs the test suite (vitest)
```

`npm run build && npm start` builds and runs the compiled version instead of `dev`.

### Trying it against the seed data

`npm run seed` always resets `data.sqlite` to the same state (autoincrement ids are reset too), so these ids are stable:

| Students | id | | Classes | id | seats |
|---|---|---|---|---|---|
| Aiden | 1 | | Algebra | 1 | 1/4 confirmed |
| Bella | 2 | | Physics | 2 | 3/4 confirmed |
| Cody | 3 | | | | |
| Dana | 4 | | | | |
| Ellie | 5 (payment_failed booking, seat released) | | | | |
| Finn | 6 (unbooked) | | | | |
| Gia | 7 (unbooked) | | | | |

View a roster:
```bash
curl http://localhost:3000/classes/2/roster
```

**Demo - happy path** (all 4 endpoints, in order: Finn books the still-open Algebra class, submits, pays, and shows up on the roster):
```bash
curl -X POST http://localhost:3000/bookings -H "Content-Type: application/json" -d '{"studentId":6,"trialClassId":1}'   # POST /bookings -> draft, id 6
curl -X POST http://localhost:3000/bookings/6/submit                                                                    # POST /bookings/:id/submit -> pending_payment, seat reserved
curl -X POST http://localhost:3000/bookings/6/pay -H "Content-Type: application/json" -d '{"success":true}'             # POST /bookings/:id/pay -> confirmed
curl http://localhost:3000/classes/1/roster                                                                             # GET /classes/:id/roster -> Finn now included, 2/4 confirmed
```

**Demo the last-seat race** (Physics has 1 seat left, Finn and Gia both go for it):
```bash
curl -X POST http://localhost:3000/bookings -H "Content-Type: application/json" -d '{"studentId":6,"trialClassId":2}'   # draft, id 7
curl -X POST http://localhost:3000/bookings -H "Content-Type: application/json" -d '{"studentId":7,"trialClassId":2}'   # draft, id 8
curl -X POST http://localhost:3000/bookings/7/submit   # succeeds -> pending_payment
curl -X POST http://localhost:3000/bookings/8/submit   # 409 "trial class 2 is full"
```

**Demo a mock payment** (Finn pays for the booking he just reserved):
```bash
curl -X POST http://localhost:3000/bookings/7/pay -H "Content-Type: application/json" -d '{"success":true}'
```

## What was built

Trial booking only (no regular enrollment), covering all 5 required capabilities:
1. Parent selects a child + available trial class → `POST /bookings` (creates a `draft`, no seat reserved yet)
2. Parent submits the booking → `POST /bookings/:id/submit` (this is where the seat is actually reserved)
3. Mock payment result recorded → `POST /bookings/:id/pay` (`{ success: boolean }` stands in for a real gateway)
4. Booking status returned after every step (every endpoint responds with the current booking, including `status`)
5. Admin/teacher roster → `GET /classes/:id/roster` (confirmed students + current seat count)

All 4 required edge cases are handled and tested (see "Race-condition approach" and the Backend Design section below):
- Duplicate confirmed bookings for the same child + class
- Overbooking beyond capacity (4 seats)
- Payment failure without polluting the confirmed roster
- The last-seat race condition

No frontend, this is a backend-led implementation (Express API), verified via 18 automated tests and the seed script / curl walkthrough above.

## Time spent

Roughly 4 hours of engineering (design, implementation, tests, docs), split into three phases (tracked in `TODO.md`, not included in the submitted repo since it's working notes rather than a deliverable). This excludes recording the video walkthrough itself, which is a separate, unscripted step done after the code and docs were already finished.
- **Phase 1 (~1h)**, read the brief, picked the stack, designed the schema and the two tricky-behavior mechanisms (race handling, unpaid-booking expiry) before writing implementation code.
- **Phase 2 (~2h)**, booking flow, all edge cases, seed data, tests.
- **Phase 3 (~1h)**, this documentation and final verification.

## Assumptions

- **No authentication.** Parents, students, and the admin/teacher roster view are all unauthenticated, the API takes `studentId`/`trialClassId` directly rather than deriving them from a logged-in session. Out of scope for a backend-correctness-focused take-home.
- **Trial classes are pre-seeded**, not created through the API, there's no "admin creates a class" endpoint, since the brief only asks for the booking flow.
- **Payment is fully mocked and caller-controlled.** `POST /bookings/:id/pay` takes an explicit `{ success: boolean }` rather than simulating randomness or integrating a real gateway, so outcomes are deterministic for demos and tests.
- **One booking = one child + one class.** No batch/multi-child booking in a single request.
- **`capacity` is a column on `trial_classes`** (defaulted to 4, per the brief) rather than a hardcoded constant, so it's not tied to a single magic number in the code, but every seeded class uses the required cap of 4.
- A child *can* hold confirmed bookings in multiple different trial classes; the brief only asks to prevent **duplicate** bookings (same child + same class).

## Key architecture and backend decisions

**Stack:** Node/TypeScript + Express + `better-sqlite3`. SQLite was chosen specifically because it's a real database with real transactions and atomic statement execution, that's what lets the last-seat race be genuinely prevented and tested, rather than approximated with in-memory locking.

**Layering:**
- `src/db/`, schema (`schema.sql`) and connection setup (`client.ts`). All invariants that can live at the schema level do (see Backend Design below).
- `src/services/`, all business logic and state transitions. `bookingService.ts` (draft → submit → the two terminal payment outcomes → expiry), `paymentService.ts` (records the payment attempt and delegates the outcome), `rosterService.ts` (read-only admin/teacher view).
- `src/api/server.ts`, a thin Express layer. It does input shape-checking and maps domain error classes (`BookingNotFoundError`, `ClassFullError`, etc.) to HTTP status codes; it holds no business logic itself.

**State machine:** `draft → pending_payment → confirmed | payment_failed`, plus `cancelled` (reached only via the expiry sweep). `draft` was added beyond the statuses suggested in the brief, see the next section.

**Why a `draft` status:** the brief's flow is "select → submit → pay." A parent can abandon the process after selecting a child + class but before hitting submit. Rather than reserving a seat the moment a class is picked (which would need a cleanup mechanism for every abandoned selection), `draft` bookings reserve nothing, the seat is only touched on the `draft → pending_payment` transition. An abandoned draft has zero effect on capacity and needs no cleanup job. It also gives duplicate-prevention a natural home: re-selecting the same child + class returns the existing draft/pending/confirmed booking instead of creating a second row.

## Race-condition approach, why chosen, tradeoffs

**Approach:** a single atomic conditional UPDATE reserves the seat:

```sql
UPDATE trial_classes SET seats_taken = seats_taken + 1
WHERE id = ? AND seats_taken < capacity;
```

The check (`seats_taken < capacity`) and the write (`+ 1`) happen in one SQL statement, so there is no gap between "check" and "write" for a second request to land in. If the statement affects 0 rows, the class was full and the booking is rejected (left as `draft`, untouched); if it affects 1 row, the caller has genuinely, exclusively reserved that seat. This runs inside `submitBooking`, at the `draft → pending_payment` transition.

**Why this over the alternatives:**
| Approach | Reliability | Complexity | Performance |
|---|---|---|---|
| Atomic conditional UPDATE (chosen) | Excellent | Very simple | Excellent |
| Transaction + explicit row lock (`SELECT ... FOR UPDATE`) | Excellent | Moderate (manual lock/unlock reasoning) | Good |
| Unique constraint + optimistic retry | Good (needs correct retry logic) | Moderate | Good, but wastes work on conflicts |

The atomic UPDATE needs no explicit locking, no retry loop, and no separate read-then-write window to reason about, the database does the mutual exclusion for us in one statement.

**Tradeoffs accepted:**
1. **The race is resolved at submission, before payment, not at payment completion, as the brief's literal scenario describes.** In the brief's 4-step scenario, both User A and User B would reach the payment step, and it's payment completion order that decides the winner. In this implementation, the seat is reserved at submit time, so of two users racing for the last seat, only one can even *begin* payment, the other is rejected immediately with "class is full." This is a stronger guarantee (fewer states to reconcile, no wasted payment attempt) but does mean User B finds out earlier/differently than the scenario narrates. I judged this an improvement, not a deviation that breaks the requirement, "at most one confirmed booking for the last seat" still holds, with less wasted work.
2. **`better-sqlite3` is synchronous** and runs on a single connection, blocking the Node event loop while a query executes. This actually makes the guarantee easy to reason about (no interleaving is possible mid-request), but it means this design doesn't scale to high write concurrency as-is, a real deployment would move to Postgres with the same atomic-UPDATE pattern (`UPDATE ... WHERE seats_taken < capacity RETURNING *`) and a proper async driver/connection pool.
3. Because `better-sqlite3` can't be driven concurrently within one process, the race isn't tested via actual parallel requests, it's tested by pre-filling the class to 3/4 and asserting that of two sequential `submitBooking` calls for the last seat, exactly one succeeds and `seats_taken` never exceeds `capacity`. This proves the invariant the atomic statement provides; it doesn't (and doesn't need to) prove Node-level thread safety, since Node is single-threaded and the guarantee comes from SQL atomicity, not from JS concurrency control.

## Backend design

**Data model** (`src/db/schema.sql`):
- `parents(id, name, email)`, `students(id, parent_id, name)`, minimal identity tables.
- `trial_classes(id, subject, starts_at, capacity, seats_taken)`, `seats_taken` is a denormalized counter of seats currently *held* (`pending_payment` + `confirmed`), not just paid; it's the counter the atomic UPDATE guards. The roster is a separate, `confirmed`-only view over `bookings`.
- `bookings(id, student_id, trial_class_id, status, created_at, updated_at)`, `status` is one of `draft | pending_payment | confirmed | payment_failed | cancelled`. `updated_at` tracks the last status transition and is what the expiry TTL is measured from (not `created_at`), since a booking may sit as a `draft` for a while before being submitted.
- `payment_attempts(id, booking_id, success, created_at)`, one row per mock payment attempt.

**Key backend functions / endpoints** (`src/services/*.ts`, wired to Express in `src/api/server.ts`):
| Function | Endpoint | Does |
|---|---|---|
| `createDraftBooking` | `POST /bookings` | Selects a child + class; idempotent, returns the existing active booking if one exists |
| `submitBooking` | `POST /bookings/:id/submit` | `draft → pending_payment`; the atomic seat reservation |
| `attemptPayment` | `POST /bookings/:id/pay` | Records the attempt, confirms or fails the booking |
| `getRoster` | `GET /classes/:id/roster` | Confirmed students + seat count for a class |
| `expireStalePendingBookings` | (internal, called by the two above) | Releases seats held by abandoned `pending_payment` bookings |

**Booking statuses:** `draft` (selected, no seat held) → `pending_payment` (submitted, seat held) → `confirmed` (paid) or `payment_failed` (seat released) → `cancelled` (reached only via expiry, seat released).

**How duplicate bookings are prevented:** two layers. Application-level: `createDraftBooking` looks up any existing active (`draft`/`pending_payment`/`confirmed`) booking for that `(student_id, trial_class_id)` pair and returns it instead of inserting, this also means re-selecting an already-confirmed booking is a no-op, not an error. Database-level backstop: a partial unique index on `bookings(student_id, trial_class_id) WHERE status IN ('draft','pending_payment','confirmed')`, so even a bug or a second process couldn't insert a genuine duplicate active row (a `cancelled`/`payment_failed` booking doesn't block re-booking the same pair).

**How payment failure is handled:** `attemptPayment(success: false)` calls `failBooking`, which, in one transaction, sets the booking to `payment_failed` and decrements `trial_classes.seats_taken`, releasing the seat it had been holding since submission. The child is never written to the confirmed roster; the released seat becomes available to the next booking.

**How the last-seat race is handled:** see the dedicated section above.

**How unpaid bookings are handled (a gap the brief doesn't explicitly ask about, but the design implies it):** a `pending_payment` booking that's never paid would otherwise hold its seat forever. Rather than a background job, this is checked lazily, `expireStalePendingBookings` runs at the top of `submitBooking` (before reserving a new seat) and `getRoster` (before reading seat counts), releasing any `pending_payment` booking whose `updated_at` is older than 15 minutes. No scheduler process to run/manage, and it's deterministic to test (backdate `updated_at`). The tradeoff: an abandoned booking's seat isn't released until *someone* next tries to book that class or view its roster, acceptable for a small, always-actively-viewed roster; wouldn't scale to a class nobody checks on.

**Which checks belong where:**
- **UI** (not built, but the intended split): only show classes with `seatsTaken < capacity` for selection, a convenience, not a security boundary.
- **Backend (service layer):** all real invariants live here, duplicate prevention's idempotent lookup, the atomic seat reservation, payment-outcome handling, expiry. This is the enforcement layer; nothing here trusts the caller.
- **Database:** the last line of defense, the `status` `CHECK` constraint, the partial unique index (duplicate bookings), and foreign keys. These hold even if a service-layer bug tried to violate them.
- **Background job:** deliberately none, replaced by the lazy expiry-on-check described above.

## What was deliberately cut

- Authentication/login for parents or admins.
- A real payment gateway, payments are a caller-supplied boolean.
- Any frontend UI, verified via tests, the seed script, and curl.
- A real background job/scheduler for expiring stale bookings (lazy-on-check instead).
- An endpoint to create/manage trial classes (seeded directly).
- Notifications/email (see "what's next" below).
- Input validation beyond basic type checks (no schema-validation library like zod), reasonable for this scope, but the first thing I'd add for a real API surface.

## What I would monitor after release

- **409 rate on `POST /bookings/:id/submit`** (`ClassFullError`), sustained high rate signals demand outstripping the 4-seat cap, or a UI that isn't hiding full classes.
- **Payment failure rate** on `POST /bookings/:id/pay`, a spike would point at a gateway/integration issue once this is a real payment provider.
- **Age distribution of open `pending_payment` bookings** relative to the 15-minute TTL, many sitting near expiry suggests checkout friction worth investigating.
- **`trial_classes.seats_taken` vs. actual `COUNT(*)` of `pending_payment`+`confirmed` bookings**, these should always match; drift would indicate a bug in the reservation/release logic and is worth an alert.
- **Time between a `pending_payment` booking expiring and its seat actually being reserved by someone else**, since expiry is lazy, a stale booking's seat isn't freed until the next booking/roster read touches that class; monitoring this tells us whether that lag matters in practice.

## What I would do next with more time

- Move unpaid-booking expiry from lazy-on-check to a real background sweep, for classes that aren't being actively viewed/booked.
- **Resume nudges for abandoned `draft`/`pending_payment` bookings**, if a parent logs back in with one of these still open, surface it via an in-app notification or email prompting them to finish (requires the auth system this take-home deliberately skipped).
- A minimal UI (booking form + roster view), the brief explicitly deprioritized this, but it's the natural next layer.
- Real payment gateway integration in place of the mock.
- A periodic reconciliation job comparing `seats_taken` against actual confirmed+pending row counts, to catch drift early.
- Schema-based request validation (zod) instead of manual type checks in the route handlers.
- Move from SQLite to Postgres with the same atomic-UPDATE pattern, for real concurrent write throughput.
