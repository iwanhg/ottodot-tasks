import type Database from "better-sqlite3";

// TODO: implement mock payment step per TODO.md "Core Booking Flow"
// - attemptPayment(db, bookingId): records a payment_attempts row, then
//   calls confirmBooking or failBooking based on the (mocked) result

export function attemptPayment(_db: Database.Database, _bookingId: number, _forceSuccess?: boolean) {
  throw new Error("not implemented");
}
