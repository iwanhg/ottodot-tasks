import { describe, it, expect } from "vitest";
import { createDraftBooking } from "../src/services/bookingService.js";
import { createTestDb } from "./helpers.js";

describe("createDraftBooking", () => {
  it("creates a draft booking and reserves no seat", () => {
    const { db, studentId, trialClassId } = createTestDb();

    const booking = createDraftBooking(db, studentId, trialClassId);

    expect(booking.status).toBe("draft");
    expect(booking.student_id).toBe(studentId);
    expect(booking.trial_class_id).toBe(trialClassId);

    const trialClass = db
      .prepare(`SELECT seats_taken FROM trial_classes WHERE id = ?`)
      .get(trialClassId) as { seats_taken: number };
    expect(trialClass.seats_taken).toBe(0);
  });

  it("is idempotent: selecting the same child + class again returns the existing draft", () => {
    const { db, studentId, trialClassId } = createTestDb();

    const first = createDraftBooking(db, studentId, trialClassId);
    const second = createDraftBooking(db, studentId, trialClassId);

    expect(second.id).toBe(first.id);

    const count = db
      .prepare(`SELECT COUNT(*) as count FROM bookings WHERE student_id = ? AND trial_class_id = ?`)
      .get(studentId, trialClassId) as { count: number };
    expect(count.count).toBe(1);
  });
});
