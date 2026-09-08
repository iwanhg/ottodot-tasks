import { describe, it, expect } from "vitest";
import { createDraftBooking, submitBooking, BookingNotDraftError } from "../src/services/bookingService.js";
import { attemptPayment } from "../src/services/paymentService.js";
import { createTestDb } from "./helpers.js";

describe("duplicate confirmed booking prevention", () => {
  it("re-selecting the same child + class after confirmation returns the existing confirmed booking, not a new row", () => {
    const { db, studentId, trialClassId } = createTestDb();

    const draft = createDraftBooking(db, studentId, trialClassId);
    submitBooking(db, draft.id);
    const confirmed = attemptPayment(db, draft.id, true);
    expect(confirmed.status).toBe("confirmed");

    // Parent tries to book the same child into the same class again.
    const repeat = createDraftBooking(db, studentId, trialClassId);
    expect(repeat.id).toBe(confirmed.id);
    expect(repeat.status).toBe("confirmed");

    const rows = db
      .prepare(`SELECT * FROM bookings WHERE student_id = ? AND trial_class_id = ?`)
      .all(studentId, trialClassId);
    expect(rows).toHaveLength(1);

    // And it can't be re-submitted into a second pending_payment/confirmed cycle.
    expect(() => submitBooking(db, repeat.id)).toThrow(BookingNotDraftError);
  });

  it("allows re-booking the same child + class after a cancelled/failed attempt (not a duplicate)", () => {
    const { db, studentId, trialClassId } = createTestDb();

    const firstDraft = createDraftBooking(db, studentId, trialClassId);
    submitBooking(db, firstDraft.id);
    const failed = attemptPayment(db, firstDraft.id, false);
    expect(failed.status).toBe("payment_failed");

    // Same child + class again, should be a fresh draft, not the failed one.
    const secondDraft = createDraftBooking(db, studentId, trialClassId);
    expect(secondDraft.id).not.toBe(firstDraft.id);
    expect(secondDraft.status).toBe("draft");

    const confirmed = attemptPayment(db, submitBooking(db, secondDraft.id).id, true);
    expect(confirmed.status).toBe("confirmed");
  });
});
