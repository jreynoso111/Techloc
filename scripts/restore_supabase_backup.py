#!/usr/bin/env python3

import argparse
import pathlib
import sys

import psycopg2
import sqlparse


EXCLUDED_PUBLIC_OBJECTS = {
    '"public"."PT-LastPing_backup"',
}

AUTH_DATA_PREFIXES = (
    'INSERT INTO "auth"."users"',
    'INSERT INTO "auth"."identities"',
)

PUBLIC_DATA_PREFIX = 'INSERT INTO "public".'
PUBLIC_SETVAL_PREFIX = "SELECT pg_catalog.setval('\"public\"."


def load_statements(path: pathlib.Path):
    text = path.read_text(encoding="utf-8")
    return [stmt.strip() for stmt in sqlparse.split(text) if stmt.strip()]


def strip_leading_comments(statement: str) -> str:
    lines = []
    skipping = True
    for raw_line in statement.splitlines():
        line = raw_line.strip()
        if skipping and (not line or line.startswith("--")):
            continue
        skipping = False
        lines.append(raw_line)
    return "\n".join(lines).strip()


def is_excluded(statement: str) -> bool:
    return any(token in statement for token in EXCLUDED_PUBLIC_OBJECTS)


def is_public_statement(statement: str) -> bool:
    if is_excluded(statement):
      return False
    return '"public".' in statement


def classify_schema_statement(statement: str):
    normalized = " ".join(strip_leading_comments(statement).split())
    upper = normalized.upper()

    if not is_public_statement(statement):
        return None

    if upper.startswith('CREATE TYPE "PUBLIC".'):
        return "tables"
    if upper.startswith('CREATE TABLE "PUBLIC".'):
        return "tables"
    if upper.startswith('CREATE VIEW "PUBLIC".'):
        return "tables"
    if upper.startswith('CREATE FUNCTION "PUBLIC".'):
        return "functions"
    if upper.startswith('ALTER TABLE "PUBLIC".') and 'ENABLE ROW LEVEL SECURITY' in upper:
        return "post"
    if upper.startswith('ALTER TABLE ONLY "PUBLIC".'):
        if 'ADD GENERATED' in upper:
            return "tables"
        return "post"
    if upper.startswith('CREATE INDEX '):
        return "post"
    if upper.startswith('CREATE UNIQUE INDEX '):
        return "post"
    if upper.startswith('CREATE TRIGGER '):
        return "post"
    if upper.startswith('CREATE POLICY '):
        return "post"
    if upper.startswith("COMMENT ON "):
        return None
    return None


def classify_data_statement(statement: str):
    normalized = " ".join(strip_leading_comments(statement).split())
    if is_excluded(statement):
        return None
    if normalized.startswith(AUTH_DATA_PREFIXES):
        return "auth"
    if normalized.startswith(PUBLIC_DATA_PREFIX):
        return "public"
    if normalized.startswith(PUBLIC_SETVAL_PREFIX):
        return "setval"
    return None


def execute_batch(cursor, statements, label):
    total = len(statements)
    for index, statement in enumerate(statements, start=1):
        try:
            cursor.execute(statement)
        except Exception as error:
            print(f"[restore:{label}] failed at statement {index}/{total}", file=sys.stderr)
            print(statement[:1200], file=sys.stderr)
            raise error
        if index % 25 == 0 or index == total:
            print(f"[restore:{label}] {index}/{total}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--dbname", required=True)
    parser.add_argument("--user", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--backup-dir", required=True)
    args = parser.parse_args()

    backup_dir = pathlib.Path(args.backup_dir).expanduser().resolve()
    extensions_path = backup_dir / "extensions.sql"
    schema_path = backup_dir / "schema.sql"
    data_path = backup_dir / "data.sql"

    extensions = [line.strip().rstrip(";") + ";" for line in extensions_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    schema_statements = load_statements(schema_path)
    data_statements = load_statements(data_path)

    table_schema = []
    function_schema = []
    post_schema = []
    for statement in schema_statements:
        bucket = classify_schema_statement(statement)
        if bucket == "tables":
            table_schema.append(statement)
        elif bucket == "functions":
            function_schema.append(statement)
        elif bucket == "post":
            post_schema.append(statement)

    auth_data = []
    public_data = []
    public_setvals = []
    for statement in data_statements:
        bucket = classify_data_statement(statement)
        if bucket == "auth":
            auth_data.append(statement)
        elif bucket == "public":
            public_data.append(statement)
        elif bucket == "setval":
            public_setvals.append(statement)

    conn = psycopg2.connect(
        host=args.host,
        port=args.port,
        dbname=args.dbname,
        user=args.user,
        password=args.password,
        sslmode="require",
    )
    conn.autocommit = True

    try:
        with conn.cursor() as cursor:
            print("[restore] enabling extensions")
            execute_batch(cursor, extensions, "extensions")

            print("[restore] creating public tables and types")
            execute_batch(cursor, table_schema, "schema-tables")

            print("[restore] creating public functions")
            execute_batch(cursor, function_schema, "schema-functions")

            print("[restore] importing auth users")
            execute_batch(cursor, auth_data, "data-auth")

            print("[restore] importing public data")
            execute_batch(cursor, public_data, "data-public")

            print("[restore] applying public constraints, indexes, triggers and policies")
            execute_batch(cursor, post_schema, "schema-post")

            print("[restore] setting public sequences")
            execute_batch(cursor, public_setvals, "setval")
    finally:
        conn.close()

    print("[restore] complete")


if __name__ == "__main__":
    main()
