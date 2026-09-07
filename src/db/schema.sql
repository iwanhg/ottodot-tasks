CREATE TABLE IF NOT EXISTS parents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL REFERENCES parents(id),
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trial_classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 4,
  -- Denormalized count of seats currently held: bookings with status
  -- 'pending_payment' (reserved, awaiting payment) OR 'confirmed' (paid).
  -- This is the counter the atomic conditional UPDATE checks/increments to
  -- enforce the capacity cap without a check-then-write race window.
  -- The admin/teacher roster is a *different* view: only 'confirmed' bookings.
  seats_taken INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  trial_class_id INTEGER NOT NULL REFERENCES trial_classes(id),
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending_payment', 'confirmed', 'payment_failed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Set on every status transition. Used (rather than created_at) to time the
  -- 15-minute pending_payment expiry window, since a booking may have sat as
  -- a 'draft' for a while before being submitted into 'pending_payment'.
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prevents duplicate active bookings (draft/pending/confirmed) for the same student+class.
-- (Enforced via a partial unique index so cancelled/failed bookings don't block re-booking.)
-- Note: 'draft' does not reserve a seat (seats_taken is only incremented on the
-- draft -> pending_payment transition), so this index only guards against
-- duplicate booking *rows*, not seat capacity.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_unique
  ON bookings(student_id, trial_class_id)
  WHERE status IN ('draft', 'pending_payment', 'confirmed');

-- Supports the lazy expiry-on-check scan: find pending_payment bookings whose
-- updated_at is older than the 15-minute TTL.
CREATE INDEX IF NOT EXISTS idx_bookings_status_updated_at
  ON bookings(status, updated_at);

-- 'pending_payment' bookings hold a reserved seat but may never complete payment
-- (abandoned checkout). Rather than a background job, expiry is checked lazily:
-- before reserving a seat or reading the roster, the app finds bookings where
-- status = 'pending_payment' AND updated_at < datetime('now', '-15 minutes'),
-- then for each: sets that booking's status to 'cancelled', bumps updated_at,
-- AND decrements the matching trial_classes.seats_taken by 1 (see bookingService).

CREATE TABLE IF NOT EXISTS payment_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  success INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
