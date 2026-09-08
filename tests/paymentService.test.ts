import { describe, it, expect } from "vitest";
import { createDraftBooking, submitBooking, BookingNotPendingPaymentError } from "../src/services/bookingService.js";
import { attemptPayment } from "../src/services/paymentService.js";
import { createTestDb } from "./helpers.js";

describe("attemptPayment", () => {
  it("confirms the booking on successful payment and keeps the seat held", () => {
    const { db, studentId, trialClassId } = createTestDb();
    const draft = createDraftBooking(db, studentId, trialClassId);
    submitBooking(db, draft.id);

    const confirmed = attemptPayment(db, draft.id, true);

    expect(confirmed.status).toBe("confirmed");

    const trialClass = db
      .prepare(`SELECT seats_taken FROM trial_classes WHERE id = ?`)
      .get(trialClassId) as { seats_taken: number };
    expect(trialClass.seats_taken).toBe(1);

    const attempts = db
      .prepare(`SELECT success FROM payment_attempts WHERE booking_id = ?`)
      .all(draft.id) as { success: number }[];
    expect(attempts).toHaveLength(1);
    expect(attempts[0].success).toBe(1);
  });

  it("fails the booking on failed payment and releases the held seat", () => {
    const { db, studentId, trialClassId } = createTestDb();
    const draft = createDraftBooking(db, studentId, trialClassId);
    submitBooking(db, draft.id);

    const failed = attemptPayment(db, draft.id, false);

    expect(failed.status).toBe("payment_failed");

    const trialClass = db
      .prepare(`SELECT seats_taken FROM trial_classes WHERE id = ?`)
      .get(trialClassId) as { seats_taken: number };
    expect(trialClass.seats_taken).toBe(0);

    const attempts = db
      .prepare(`SELECT success FROM payment_attempts WHERE booking_id = ?`)
      .all(draft.id) as { success: number }[];
    expect(attempts).toHaveLength(1);
    expect(attempts[0].success).toBe(0);
  });

  it("a failed payment never leaves the child on the confirmed roster", () => {
    const { db, studentId, trialClassId } = createTestDb();
    const draft = createDraftBooking(db, studentId, trialClassId);
    submitBooking(db, draft.id);
    attemptPayment(db, draft.id, false);

    const confirmedBookings = db
      .prepare(`SELECT * FROM bookings WHERE trial_class_id = ? AND status = 'confirmed'`)
      .all(trialClassId);
    expect(confirmedBookings).toHaveLength(0);
  });

  it("rejects paying for a booking that is not awaiting payment", () => {
    const { db, studentId, trialClassId } = createTestDb();
    const draft = createDraftBooking(db, studentId, trialClassId);

    expect(() => attemptPayment(db, draft.id, true)).toThrow(BookingNotPendingPaymentError);
  });

  it("a released seat after payment failure can be taken by another booking", () => {
    const { db, studentId, trialClassId } = createTestDb();
    db.prepare(`UPDATE trial_classes SET seats_taken = 3 WHERE id = ?`).run(trialClassId);

    const draftA = createDraftBooking(db, studentId, trialClassId);
    submitBooking(db, draftA.id); // takes the 4th (last) seat
    attemptPayment(db, draftA.id, false); // fails, releases it

    const parentB = db.prepare(`INSERT INTO parents (name, email) VALUES ('B', 'b@test.dev')`).run()
      .lastInsertRowid as number;
    const studentB = db.prepare(`INSERT INTO students (parent_id, name) VALUES (?, 'Kid B')`).run(parentB)
      .lastInsertRowid as number;
    const draftB = createDraftBooking(db, studentB, trialClassId);
    const submittedB = submitBooking(db, draftB.id);

    expect(submittedB.status).toBe("pending_payment");
  });
});
