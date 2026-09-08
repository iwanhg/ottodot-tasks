import { createDb } from "./client.js";
import { createDraftBooking, submitBooking } from "../services/bookingService.js";
import { attemptPayment } from "../services/paymentService.js";
import { getRoster } from "../services/rosterService.js";

const db = createDb();

// Reset so the script is safely re-runnable with the same ids every time
// (child tables first, for FKs; sqlite_sequence reset so autoincrement
// restarts at 1, keeps the README's example curl commands accurate).
db.exec(`
  DELETE FROM payment_attempts;
  DELETE FROM bookings;
  DELETE FROM trial_classes;
  DELETE FROM students;
  DELETE FROM parents;
  DELETE FROM sqlite_sequence WHERE name IN ('payment_attempts', 'bookings', 'trial_classes', 'students', 'parents');
`);

function addParentWithChild(parentName: string, email: string, childName: string) {
  const parentId = db
    .prepare(`INSERT INTO parents (name, email) VALUES (?, ?)`)
    .run(parentName, email).lastInsertRowid as number;
  const studentId = db
    .prepare(`INSERT INTO students (parent_id, name) VALUES (?, ?)`)
    .run(parentId, childName).lastInsertRowid as number;
  return studentId;
}

function addTrialClass(subject: string, startsAt: string) {
  return db
    .prepare(`INSERT INTO trial_classes (subject, starts_at) VALUES (?, ?)`)
    .run(subject, startsAt).lastInsertRowid as number;
}

const aiden = addParentWithChild("Alice Parent", "alice@example.com", "Aiden");
const bella = addParentWithChild("Bob Parent", "bob@example.com", "Bella");
const cody = addParentWithChild("Cara Parent", "cara@example.com", "Cody");
const dana = addParentWithChild("Dan Parent", "dan@example.com", "Dana");
const ellie = addParentWithChild("Eve Parent", "eve@example.com", "Ellie");
// Not booked into anything yet, left free for the README's live last-seat
// race demo (both compete for the 4th Physics seat via the API/curl).
const finn = addParentWithChild("Finn Parent", "finn@example.com", "Finn");
const gia = addParentWithChild("Gia Parent", "gia@example.com", "Gia");

const algebra = addTrialClass("Algebra", "2026-09-20T10:00:00Z");
const physics = addTrialClass("Physics", "2026-09-21T10:00:00Z");

function bookAndConfirm(studentId: number, trialClassId: number) {
  const draft = createDraftBooking(db, studentId, trialClassId);
  submitBooking(db, draft.id);
  attemptPayment(db, draft.id, true);
}

// Scenario 1: a class with available seats, Algebra has 1/4 confirmed.
bookAndConfirm(aiden, algebra);

// Scenario 2: a class with exactly 3 confirmed students, Physics has 3/4
// confirmed, ready to demo the last-seat race for the 4th seat.
bookAndConfirm(bella, physics);
bookAndConfirm(cody, physics);
bookAndConfirm(dana, physics);

// Scenario 3: a duplicate booking attempt for the same child + class.
// Aiden is already confirmed in Algebra; selecting it again returns the
// existing confirmed booking rather than creating a second one.
const duplicateAttempt = createDraftBooking(db, aiden, algebra);
console.log(
  `Duplicate booking attempt: Aiden -> Algebra again returned existing booking #${duplicateAttempt.id} ` +
  `(status: ${duplicateAttempt.status}), no new row created.`
);

// Scenario 4: a payment failure case. Ellie books the still-open Algebra
// class, but the mock payment fails, she must not appear on the roster,
// and her seat is released back to the class.
const ellieDraft = createDraftBooking(db, ellie, algebra);
submitBooking(db, ellieDraft.id);
const ellieResult = attemptPayment(db, ellieDraft.id, false);
console.log(`Payment failure case: Ellie's booking #${ellieResult.id} status: ${ellieResult.status}`);

console.log("\nSeeded database. Rosters:");
console.log(getRoster(db, algebra));
console.log(getRoster(db, physics));

console.log("\nIds (stable across re-runs, sqlite_sequence is reset each time):");
console.log({ students: { aiden, bella, cody, dana, ellie, finn, gia }, classes: { algebra, physics } });
console.log(
  `\nFinn (student ${finn}) and Gia (student ${gia}) are unbooked, use them to demo the ` +
  `live last-seat race for Physics' (class ${physics}) 4th seat.`
);

db.close();
