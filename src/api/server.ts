import express from "express";
import { createDb } from "../db/client.js";

const app = express();
app.use(express.json());

const db = createDb();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// TODO: add booking endpoints per TODO.md "Core Booking Flow"
// - POST /bookings            create a trial booking
// - POST /bookings/:id/pay    submit mock payment for a booking
// - GET  /classes/:id/roster  view confirmed roster for a class

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
