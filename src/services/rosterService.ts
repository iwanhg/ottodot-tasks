import type Database from "better-sqlite3";
import { expireStalePendingBookings } from "./bookingService.js";

export class TrialClassNotFoundError extends Error {}

export interface RosterEntry {
  bookingId: number;
  studentId: number;
  studentName: string;
}

export interface Roster {
  trialClassId: number;
  subject: string;
  startsAt: string;
  capacity: number;
  seatsTaken: number;
  confirmedStudents: RosterEntry[];
}

/**
 * Admin/teacher view: the confirmed students for a trial class, plus the
 * current seat count. Runs the same lazy expiry check as seat reservation so
 * the displayed seatsTaken doesn't count abandoned pending_payment bookings
 * (see TODO.md "Release seats held by unpaid bookings").
 */
export function getRoster(db: Database.Database, trialClassId: number): Roster {
  expireStalePendingBookings(db);

  const trialClass = db.prepare(`SELECT * FROM trial_classes WHERE id = ?`).get(trialClassId) as
    | { id: number; subject: string; starts_at: string; capacity: number; seats_taken: number }
    | undefined;

  if (!trialClass) {
    throw new TrialClassNotFoundError(`trial class ${trialClassId} not found`);
  }

  const confirmedStudents = db
    .prepare(
      `SELECT b.id as bookingId, s.id as studentId, s.name as studentName
       FROM bookings b
       JOIN students s ON s.id = b.student_id
       WHERE b.trial_class_id = ? AND b.status = 'confirmed'
       ORDER BY b.updated_at ASC`
    )
    .all(trialClassId) as RosterEntry[];

  return {
    trialClassId: trialClass.id,
    subject: trialClass.subject,
    startsAt: trialClass.starts_at,
    capacity: trialClass.capacity,
    seatsTaken: trialClass.seats_taken,
    confirmedStudents,
  };
}
