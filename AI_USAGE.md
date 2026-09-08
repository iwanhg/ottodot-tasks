# AI Usage

## Which AI tools I used

Antigravity IDE with Claude Code (Claude Sonnet 5) as an interactive pair-programmer for the whole task, from reading the brief through implementation, tests, seed data, and this documentation.

## What I used AI for

- Parsing the take-home brief (PDF) and the separate HR email, and turning them into a written plan/checklist (`TODO.md`, not included in the submitted repo, working notes, not a deliverable) before writing any code.
- Scaffolding the project (Node/TS, Express, `better-sqlite3`, vitest, tsconfig).
- Designing and writing the schema, service-layer logic, API routes, seed script, and test suite, with me reviewing and steering after each step rather than accepting one large generated dump.
- Drafting this README and this file.

I worked in small increments on purpose: pick a design decision → implement just that piece → run the tests/build → review → move on. That kept each change small enough to actually verify, rather than trusting a large batch of generated code.

## Where AI helped me move faster

Generating the atomic-UPDATE based reservation logic and its test coverage together was the biggest time saver. Writing a deterministic test for a race condition is normally fiddly, you either need real concurrent connections or you have to reason carefully about what you're actually proving. Claude proposed pre-filling a class to 3/4 capacity and running two sequential `submitBooking` calls for the last seat, asserting exactly one succeeds and `seats_taken` never exceeds `capacity`, and explained clearly *why* that's a valid test of the SQL-level atomicity guarantee even though `better-sqlite3` is synchronous and can't produce true thread-level concurrency in-process. That saved me from either overbuilding a fake-concurrency test harness or under-testing the one invariant the whole task is graded on.

## Where I disagreed with, corrected, or rejected AI output

The first pass at the booking status set only had `pending_payment`, `confirmed`, `payment_failed`, `cancelled`, mirroring the statuses suggested in the brief. I pushed back: what happens if a parent picks a child and a class but closes the tab before hitting submit? With the original design, there was no clean way to represent "in progress, not yet committed" without either reserving a seat too early (for someone who might never submit) or not persisting anything at all. I asked for a `draft` status that explicitly reserves no seat, with the seat only touched on the `draft → pending_payment` transition. Claude then had to thread that through the schema (CHECK constraint, the duplicate-booking partial unique index, adding `updated_at` since the expiry TTL needed to measure from *submission* time, not from when the draft row was first created, which the original `created_at`-based design would have gotten wrong for a booking that sat as a draft for a while). That `updated_at` fix in particular was a real correctness issue that only surfaced because I asked for `draft` in the first place, it's the kind of thing worth double-checking whenever an AI tool introduces a new state into an existing state machine.

## What I would change about my AI workflow next time

Design the full state machine (every status, every transition, and which invariant lives at which layer) as a single up-front decision, before letting the AI scaffold the schema. I found the `draft` status and the `updated_at`/expiry-timing issue only after the first schema was already written, which meant revising a committed design instead of getting it right the first time. Asking "what states can this thing be in, including abandoned/partial ones?" as the very first design question would have caught it earlier.

## How I verified the final implementation

- `npm run build` (strict TypeScript) and `npm test` (18 vitest cases) after every implementation step, not just at the end, each booking-flow step (draft, submit, pay, roster) was tested before moving to the next.
- The test suite explicitly covers all four required edge cases: duplicate confirmed bookings, overbooking, payment failure, and the last-seat race, plus the unpaid-booking expiry behavior the design added.
- Beyond automated tests, I ran the actual HTTP server against the seeded data and exercised the last-seat race live with `curl`, two students competing for Physics' last seat, to confirm the behavior holds through the real API layer, not just at the service-function level the unit tests exercise directly.
- Re-ran the seed script twice to confirm it's idempotent (safe to re-run without manual cleanup), since the brief asks for a demo that's quick to run.
