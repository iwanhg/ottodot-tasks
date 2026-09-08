import { describe, it, expect } from "vitest";
import {
  createDraftBooking,
  submitBooking,
  expireStalePendingBookings,
  BookingNotDraftError,
  ClassFullError,
} from "../src/services/bookingService.js";
import { createTestDb } from "./helpers.js";

describe("submitBooking", () => {
  it("reserves a seat and moves draft -> pending_payment", () => {
    const { db, studentId, trialClassId } = createTestDb();
    const draft = createDraftBooking(db, studentId, trialClassId);

    const submitted = submitBooking(db, draft.id);

    expect(submitted.status).toBe("pending_payment");
    const trialClass = db
      .prepare(`SELECT seats_taken FROM trial_classes WHERE id = ?`)
      .get(trialClassId) as { seats_taken: number };
    expect(trialClass.seats_taken).toBe(1);
  });

  it("overbooking: rejects a new booking once the class is already at full capacity", () => {
    const { db, studentId, trialClassId } = createTestDb();
    db.prepare(`UPDATE trial_classes SET seats_taken = 4 WHERE id = ?`).run(trialClassId); // 4/4, full

    const draft = createDraftBooking(db, studentId, trialClassId);

    expect(() => submitBooking(db, draft.id)).toThrow(ClassFullError);

    const trialClass = db
      .prepare(`SELECT seats_taken, capacity FROM trial_classes WHERE id = ?`)
      .get(trialClassId) as { seats_taken: number; capacity: number };
    expect(trialClass.seats_taken).toBe(4);
    expect(trialClass.seats_taken).toBeLessThanOrEqual(trialClass.capacity);
  });

  it("rejects submitting a booking that is not a draft", () => {
    const { db, studentId, trialClassId } = createTestDb();
    const draft = createDraftBooking(db, studentId, trialClassId);
    submitBooking(db, draft.id);

    expect(() => submitBooking(db, draft.id)).toThrow(BookingNotDraftError);
  });

  it("last-seat race: with 3/4 seats taken, exactly one of two competing submits succeeds", () => {
    const { db, trialClassId } = createTestDb();

    // Fill 3 of the 4 seats directly (simulating 3 already-confirmed students).
    db.prepare(`UPDATE trial_classes SET seats_taken = 3 WHERE id = ?`).run(trialClassId);

    // Two different students draft-booking the same last seat.
    const parentA = db.prepare(`INSERT INTO parents (name, email) VALUES ('A', 'a@test.dev')`).run()
      .lastInsertRowid as number;
    const studentA = db.prepare(`INSERT INTO students (parent_id, name) VALUES (?, 'Kid A')`).run(parentA)
      .lastInsertRowid as number;
    const parentB = db.prepare(`INSERT INTO parents (name, email) VALUES ('B', 'b@test.dev')`).run()
      .lastInsertRowid as number;
    const studentB = db.prepare(`INSERT INTO students (parent_id, name) VALUES (?, 'Kid B')`).run(parentB)
      .lastInsertRowid as number;

    const draftA = createDraftBooking(db, studentA, trialClassId);
    const draftB = createDraftBooking(db, studentB, trialClassId);

    // User A selects last slot and moves toward payment (submits first).
    const resultA = submitBooking(db, draftA.id);
    expect(resultA.status).toBe("pending_payment");

    // User B selected the same slot but submits second, once the seat is gone.
    expect(() => submitBooking(db, draftB.id)).toThrow(ClassFullError);

    const trialClass = db
      .prepare(`SELECT seats_taken, capacity FROM trial_classes WHERE id = ?`)
      .get(trialClassId) as { seats_taken: number; capacity: number };
    expect(trialClass.seats_taken).toBe(4);
    expect(trialClass.seats_taken).toBeLessThanOrEqual(trialClass.capacity);

    const bookingB = db.prepare(`SELECT status FROM bookings WHERE id = ?`).get(draftB.id) as {
      status: string;
    };
    expect(bookingB.status).toBe("draft"); // left untouched, parent can pick another class
  });
});

describe("expireStalePendingBookings", () => {
  it("releases a seat held by a pending_payment booking older than the 15 min TTL", () => {
    const { db, studentId, trialClassId } = createTestDb();
    const draft = createDraftBooking(db, studentId, trialClassId);
    submitBooking(db, draft.id);

    // Backdate updated_at to simulate an abandoned checkout 20 minutes ago.
    db.prepare(`UPDATE bookings SET updated_at = datetime('now', '-20 minutes') WHERE id = ?`).run(draft.id);

    expireStalePendingBookings(db);

    const booking = db.prepare(`SELECT status FROM bookings WHERE id = ?`).get(draft.id) as { status: string };
    expect(booking.status).toBe("cancelled");

    const trialClass = db
      .prepare(`SELECT seats_taken FROM trial_classes WHERE id = ?`)
      .get(trialClassId) as { seats_taken: number };
    expect(trialClass.seats_taken).toBe(0);
  });

  it("does not release a pending_payment booking within the TTL", () => {
    const { db, studentId, trialClassId } = createTestDb();
    const draft = createDraftBooking(db, studentId, trialClassId);
    submitBooking(db, draft.id);

    expireStalePendingBookings(db);

    const booking = db.prepare(`SELECT status FROM bookings WHERE id = ?`).get(draft.id) as { status: string };
    expect(booking.status).toBe("pending_payment");
  });
});
