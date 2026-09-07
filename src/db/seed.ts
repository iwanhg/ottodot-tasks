import { createDb } from "./client.js";

// TODO: populate seed data per TODO.md "Seed Data" section
// (a class with available seats, a class with exactly 3 confirmed students,
// a duplicate booking attempt, a payment failure case)

const db = createDb();

console.log("Seed script scaffolded — add seed rows here.");

db.close();
