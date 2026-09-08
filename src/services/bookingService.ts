import type Database from "better-sqlite3";
import type { Booking } from "../types.js";

export class BookingNotFoundError extends Error { }
export class BookingNotDraftError extends Error { }
export class ClassFullError extends Error { }
export class BookingNotPendingPaymentError extends Error { }

const PENDING_PAYMENT_TTL_MINUTES = 15;

/**
 * Step 1 of the booking flow: parent selects a child + trial class.
 * Creates a 'draft' booking. No seat is reserved at this stage, that only
 * happens on submit (see TODO.md "Core Booking Flow" / "submitBooking").
 *
 * Idempotent: if the student already has an active booking (draft/pending_payment/
 * confirmed) for this class, that existing booking is returned instead of creating
 * a duplicate row (the partial unique index on bookings would otherwise reject it).
 */
export function createDraftBooking(
  db: Database.Database,
  studentId: number,
  trialClassId: number
): Booking {
  const existing = db
    .prepare(
      `SELECT * FROM bookings
       WHERE student_id = ? AND trial_class_id = ?
         AND status IN ('draft', 'pending_payment', 'confirmed')`
    )
    .get(studentId, trialClassId) as Booking | undefined;

  if (existing) return existing;

  const result = db
    .prepare(
      `INSERT INTO bookings (student_id, trial_class_id, status) VALUES (?, ?, 'draft')`
    )
    .run(studentId, trialClassId);

  return db
    .prepare(`SELECT * FROM bookings WHERE id = ?`)
    .get(result.lastInsertRowid) as Booking;
}

/**
 * Releases seats held by 'pending_payment' bookings that have sat unpaid past
 * the TTL, flipping them to 'cancelled' and decrementing trial_classes.seats_taken.
 * Called lazily before any seat reservation or roster read, instead of running
 * as a background job (see TODO.md "Release seats held by unpaid bookings").
 */
export function expireStalePendingBookings(db: Database.Database): void {
  const stale = db
    .prepare(
      `SELECT id, trial_class_id FROM bookings
       WHERE status = 'pending_payment' AND updated_at < datetime('now', ?)`
    )
    .all(`-${PENDING_PAYMENT_TTL_MINUTES} minutes`) as { id: number; trial_class_id: number }[];

  const release = db.transaction((booking: { id: number; trial_class_id: number }) => {
    db.prepare(`UPDATE bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(
      booking.id
    );
    db.prepare(`UPDATE trial_classes SET seats_taken = seats_taken - 1 WHERE id = ?`).run(
      booking.trial_class_id
    );
  });

  for (const booking of stale) {
    release(booking);
  }
}

/**
 * Step 2 of the booking flow: parent submits the draft booking.
 * This is where the seat is actually reserved, via a single atomic conditional
 * UPDATE (`seats_taken < capacity`), the check and the increment happen in one
 * SQL statement, so two submissions racing for the last seat cannot both
 * succeed (see TODO.md "Handle last-seat race condition").
 *
 * Throws BookingNotFoundError / BookingNotDraftError for invalid state, or
 * ClassFullError if the atomic reservation fails (booking is left untouched
 * as 'draft' in that case, so the parent can pick a different class).
 */
export function submitBooking(db: Database.Database, bookingId: number): Booking {
  expireStalePendingBookings(db);

  const submit = db.transaction(() => {
    const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId) as Booking | undefined;
    if (!booking) {
      throw new BookingNotFoundError(`booking ${bookingId} not found`);
    }
    if (booking.status !== "draft") {
      throw new BookingNotDraftError(`booking ${bookingId} is not a draft (status: ${booking.status})`);
    }

    const reserved = db
      .prepare(
        `UPDATE trial_classes SET seats_taken = seats_taken + 1 WHERE id = ? AND seats_taken < capacity`
      )
      .run(booking.trial_class_id);

    if (reserved.changes === 0) {
      throw new ClassFullError(`trial class ${booking.trial_class_id} is full`);
    }

    db.prepare(`UPDATE bookings SET status = 'pending_payment', updated_at = datetime('now') WHERE id = ?`).run(
      bookingId
    );

    return db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId) as Booking;
  });

  return submit();
}

function getPendingPaymentBooking(db: Database.Database, bookingId: number): Booking {
  const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId) as Booking | undefined;
  if (!booking) {
    throw new BookingNotFoundError(`booking ${bookingId} not found`);
  }
  if (booking.status !== "pending_payment") {
    throw new BookingNotPendingPaymentError(
      `booking ${bookingId} is not awaiting payment (status: ${booking.status})`
    );
  }
  return booking;
}

/**
 * Step 3 (success path): marks a pending_payment booking as confirmed after a
 * successful payment. The seat was already reserved at submit time, so
 * seats_taken is untouched here.
 */
export function confirmBooking(db: Database.Database, bookingId: number): Booking {
  getPendingPaymentBooking(db, bookingId);

  db.prepare(`UPDATE bookings SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?`).run(
    bookingId
  );

  return db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId) as Booking;
}

/**
 * Step 3 (failure path): marks a pending_payment booking as payment_failed and
 * releases the seat it was holding, so the child is never left occupying a
 * seat without a successful payment, and the seat becomes available to others.
 */
export function failBooking(db: Database.Database, bookingId: number): Booking {
  const fail = db.transaction((id: number) => {
    const booking = getPendingPaymentBooking(db, id);

    db.prepare(`UPDATE bookings SET status = 'payment_failed', updated_at = datetime('now') WHERE id = ?`).run(
      id
    );
    db.prepare(`UPDATE trial_classes SET seats_taken = seats_taken - 1 WHERE id = ?`).run(
      booking.trial_class_id
    );

    return db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(id) as Booking;
  });

  return fail(bookingId);
}
