import express from "express";
import { createDb } from "../db/client.js";
import {
  createDraftBooking,
  submitBooking,
  BookingNotFoundError,
  BookingNotDraftError,
  BookingNotPendingPaymentError,
  ClassFullError,
} from "../services/bookingService.js";
import { attemptPayment } from "../services/paymentService.js";
import { getRoster, TrialClassNotFoundError } from "../services/rosterService.js";

const app = express();
app.use(express.json());

const db = createDb();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Step 1 of the booking flow: parent picks a child + trial class.
// Creates (or returns the existing) 'draft' booking, no seat reserved yet.
app.post("/bookings", (req, res) => {
  const { studentId, trialClassId } = req.body ?? {};

  if (typeof studentId !== "number" || typeof trialClassId !== "number") {
    res.status(400).json({ error: "studentId and trialClassId are required numbers" });
    return;
  }

  try {
    const booking = createDraftBooking(db, studentId, trialClassId);
    res.status(201).json(booking);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Step 2 of the booking flow: parent submits the draft booking.
// Reserves the seat atomically; fails with 409 if the class is full.
app.post("/bookings/:id/submit", (req, res) => {
  const bookingId = Number(req.params.id);

  try {
    const booking = submitBooking(db, bookingId);
    res.json(booking);
  } catch (err) {
    if (err instanceof BookingNotFoundError) {
      res.status(404).json({ error: err.message });
    } else if (err instanceof BookingNotDraftError) {
      res.status(409).json({ error: err.message });
    } else if (err instanceof ClassFullError) {
      res.status(409).json({ error: err.message });
    } else {
      throw err;
    }
  }
});

// Step 3 of the booking flow: mock payment. Body: { success: boolean } stands
// in for a real payment gateway's result. Confirms or fails the booking;
// on failure the held seat is released back to the class.
app.post("/bookings/:id/pay", (req, res) => {
  const bookingId = Number(req.params.id);
  const { success } = req.body ?? {};

  if (typeof success !== "boolean") {
    res.status(400).json({ error: "success (boolean) is required" });
    return;
  }

  try {
    const booking = attemptPayment(db, bookingId, success);
    res.json(booking);
  } catch (err) {
    if (err instanceof BookingNotFoundError) {
      res.status(404).json({ error: err.message });
    } else if (err instanceof BookingNotPendingPaymentError) {
      res.status(409).json({ error: err.message });
    } else {
      throw err;
    }
  }
});

// Step 5: admin/teacher roster view, confirmed students for a trial class.
app.get("/classes/:id/roster", (req, res) => {
  const trialClassId = Number(req.params.id);

  try {
    const roster = getRoster(db, trialClassId);
    res.json(roster);
  } catch (err) {
    if (err instanceof TrialClassNotFoundError) {
      res.status(404).json({ error: err.message });
    } else {
      throw err;
    }
  }
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
