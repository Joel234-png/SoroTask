const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migrationsDir = path.resolve(__dirname, "../migrations");

test("002 migration configures TimescaleDB hypertable and compression", () => {
  const sql = fs.readFileSync(
    path.join(migrationsDir, "002_timescaledb_raw_events_retention.sql"),
    "utf8",
  );

  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS timescaledb/i);
  assert.match(sql, /RENAME TO raw_events/i);
  assert.match(sql, /ledger_timestamp/i);
  assert.match(sql, /chunk_time_interval\s*=>\s*INTERVAL '7 days'/i);
  assert.match(sql, /timescaledb\.compress/i);
  assert.match(sql, /add_compression_policy[\s\S]*INTERVAL '14 days'/i);
  assert.match(sql, /CREATE OR REPLACE VIEW events/i);
  assert.match(sql, /002_timescaledb_raw_events_retention/);
});

test("migration versions are unique and ordered", () => {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  assert.deepEqual(files, [
    "001_initial_schema.sql",
    "002_timescaledb_raw_events_retention.sql",
  ]);

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    assert.match(sql, /INSERT INTO schema_migrations \(version\)/);
  }
});
