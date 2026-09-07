import type Database from "better-sqlite3";

// TODO: implement per TODO.md "Core Booking Flow" and "Reliability / Edge Cases"
// - createBooking(db, studentId, trialClassId): atomic conditional UPDATE to reserve a seat
// - confirmBooking(db, bookingId): mark confirmed after successful payment
// - failBooking(db, bookingId): release the reserved seat, mark payment_failed

export function createBooking(_db: Database.Database, _studentId: number, _trialClassId: number) {
  throw new Error("not implemented");
}
