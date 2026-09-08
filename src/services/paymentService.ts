import type Database from "better-sqlite3";
import type { Booking } from "../types.js";
import {
  confirmBooking,
  failBooking,
  BookingNotFoundError,
  BookingNotPendingPaymentError,
} from "./bookingService.js";

/**
 * Mock payment step: records a payment_attempts row for a pending_payment
 * booking, then confirms or fails the booking based on the given outcome.
 * `success` stands in for a real payment gateway's result, the caller
 * (API layer, seed script, or test) decides which outcome to simulate.
 */
export function attemptPayment(db: Database.Database, bookingId: number, success: boolean): Booking {
  const attempt = db.transaction(() => {
    // Validate before writing the payment_attempts row, so an invalid booking
    // id fails with our domain errors rather than a raw FK-constraint error.
    const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId) as Booking | undefined;
    if (!booking) {
      throw new BookingNotFoundError(`booking ${bookingId} not found`);
    }
    if (booking.status !== "pending_payment") {
      throw new BookingNotPendingPaymentError(
        `booking ${bookingId} is not awaiting payment (status: ${booking.status})`
      );
    }

    db.prepare(`INSERT INTO payment_attempts (booking_id, success) VALUES (?, ?)`).run(
      bookingId,
      success ? 1 : 0
    );

    return success ? confirmBooking(db, bookingId) : failBooking(db, bookingId);
  });

  return attempt();
}
