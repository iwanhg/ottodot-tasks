import { describe, it, expect } from "vitest";
import { createDraftBooking, submitBooking } from "../src/services/bookingService.js";
import { attemptPayment } from "../src/services/paymentService.js";
import { getRoster, TrialClassNotFoundError } from "../src/services/rosterService.js";
import { createTestDb } from "./helpers.js";

function addStudent(db: ReturnType<typeof createTestDb>["db"], name: string): number {
  const parentId = db
    .prepare(`INSERT INTO parents (name, email) VALUES (?, ?)`)
    .run(`${name} Parent`, `${name.toLowerCase()}@test.dev`).lastInsertRowid as number;
  return db.prepare(`INSERT INTO students (parent_id, name) VALUES (?, ?)`).run(parentId, name)
    .lastInsertRowid as number;
}

describe("getRoster", () => {
  it("lists only confirmed students, not draft/pending/failed/cancelled ones", () => {
    const { db, studentId, trialClassId } = createTestDb();

    // Confirmed.
    const confirmedDraft = createDraftBooking(db, studentId, trialClassId);
    submitBooking(db, confirmedDraft.id);
    attemptPayment(db, confirmedDraft.id, true);

    // Draft only, never submitted.
    const draftStudent = addStudent(db, "DraftKid");
    createDraftBooking(db, draftStudent, trialClassId);

    // Pending payment, never paid.
    const pendingStudent = addStudent(db, "PendingKid");
    const pendingDraft = createDraftBooking(db, pendingStudent, trialClassId);
    submitBooking(db, pendingDraft.id);

    // Payment failed.
    const failedStudent = addStudent(db, "FailedKid");
    const failedDraft = createDraftBooking(db, failedStudent, trialClassId);
    submitBooking(db, failedDraft.id);
    attemptPayment(db, failedDraft.id, false);

    const roster = getRoster(db, trialClassId);

    expect(roster.confirmedStudents).toHaveLength(1);
    expect(roster.confirmedStudents[0].studentId).toBe(studentId);
    expect(roster.seatsTaken).toBe(2); // confirmed + still-pending, failed one released its seat
  });

  it("throws for a non-existent trial class", () => {
    const { db } = createTestDb();
    expect(() => getRoster(db, 999)).toThrow(TrialClassNotFoundError);
  });

  it("excludes an expired pending_payment booking's seat from the count", () => {
    const { db, studentId, trialClassId } = createTestDb();
    const draft = createDraftBooking(db, studentId, trialClassId);
    submitBooking(db, draft.id);
    db.prepare(`UPDATE bookings SET updated_at = datetime('now', '-20 minutes') WHERE id = ?`).run(draft.id);

    const roster = getRoster(db, trialClassId);

    expect(roster.seatsTaken).toBe(0);
    expect(roster.confirmedStudents).toHaveLength(0);
  });
});
