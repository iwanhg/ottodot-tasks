import { createDb } from "../src/db/client.js";

export function createTestDb() {
  const db = createDb(":memory:");

  const parentId = db
    .prepare(`INSERT INTO parents (name, email) VALUES ('Test Parent', 'parent@test.dev')`)
    .run().lastInsertRowid as number;

  const studentId = db
    .prepare(`INSERT INTO students (parent_id, name) VALUES (?, 'Test Student')`)
    .run(parentId).lastInsertRowid as number;

  const trialClassId = db
    .prepare(
      `INSERT INTO trial_classes (subject, starts_at, capacity) VALUES ('Math', '2026-09-15T10:00:00Z', 4)`
    )
    .run().lastInsertRowid as number;

  return { db, parentId, studentId, trialClassId };
}
