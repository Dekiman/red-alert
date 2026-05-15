import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inspect } from "node:util";

type CliOptions = {
  dbPath: string;
  sql: string | null;
  limit: number;
  help: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dbPath: process.env.RED_ALERT_DB_PATH ?? path.join(process.cwd(), "data", "red_alerts.sqlite"),
    sql: null,
    limit: 20,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--db") {
      options.dbPath = argv[i + 1] ?? options.dbPath;
      i += 1;
      continue;
    }
    if (arg === "--sql") {
      options.sql = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--limit") {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = Math.floor(parsed);
      }
      i += 1;
    }
  }

  return options;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage:",
      "  npm run db:inspect",
      "  npm run db:inspect -- --limit 50",
      "  npm run db:inspect -- --sql \"SELECT * FROM alerts ORDER BY id DESC LIMIT 5\"",
      "  npm run db:inspect -- --db data/red_alerts.sqlite --sql \"SELECT COUNT(*) AS count FROM alerts\"",
      "",
      "Flags:",
      "  --db <path>     Database path (default: RED_ALERT_DB_PATH or data/red_alerts.sqlite)",
      "  --sql <query>   Run a read-only SQL query and print result",
      "  --limit <n>     Result limit for default summary tables (default: 20)"
    ].join("\n") + "\n"
  );
}

function quoteIdentifier(identifier: string): string {
  return `"${String(identifier).replace(/"/g, "\"\"")}"`;
}

function assertReadOnlyQuery(sql: string) {
  const normalized = sql.trim().replace(/\s+/g, " ").toUpperCase();
  const allowedStart = ["SELECT ", "WITH ", "PRAGMA ", "EXPLAIN "];
  if (!allowedStart.some((prefix) => normalized.startsWith(prefix))) {
    throw new Error("Only read-only queries are allowed with --sql (SELECT/WITH/PRAGMA/EXPLAIN).");
  }
}

function getAllRows(db: DatabaseSync, sql: string) {
  const statement = db.prepare(sql);
  return statement.all();
}

function printQueryResult(rows: unknown) {
  process.stdout.write(`${inspect(rows, { depth: null, colors: true, maxArrayLength: null })}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const resolvedPath = path.resolve(options.dbPath);
  if (!existsSync(resolvedPath)) {
    process.stderr.write(`Database file not found: ${resolvedPath}\n`);
    process.exitCode = 1;
    return;
  }

  const db = new DatabaseSync(resolvedPath);
  process.stdout.write(`Database: ${resolvedPath}\n`);

  try {
    if (options.sql) {
      assertReadOnlyQuery(options.sql);
      const rows = getAllRows(db, options.sql);
      printQueryResult(rows);
      return;
    }

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as Array<{ name: string }>;

    process.stdout.write("\nTables:\n");
    for (const table of tables) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)}`).get() as {
        count: number | bigint;
      };
      process.stdout.write(`- ${table.name}: ${Number(row.count)} rows\n`);
    }

    if (tables.some((table) => table.name === "alerts")) {
      process.stdout.write(`\nRecent alerts (limit ${options.limit}):\n`);
      const rows = db.prepare(
        `SELECT id, notification_id, source, alert_timestamp_iso, location_count, LENGTH(raw_payload_json) AS raw_json_bytes
         FROM alerts
         ORDER BY id DESC
         LIMIT ?`
      ).all(options.limit);
      printQueryResult(rows);
    }

    if (tables.some((table) => table.name === "live_news_events")) {
      process.stdout.write(`\nRecent live news events (limit ${options.limit}):\n`);
      const rows = db.prepare(
        `SELECT id, external_event_id, title, category, signal_count, updated_at_iso
         FROM live_news_events
         ORDER BY id DESC
         LIMIT ?`
      ).all(options.limit);
      printQueryResult(rows);
    }
  } finally {
    db.close();
  }
}

main();
