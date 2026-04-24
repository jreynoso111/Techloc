#!/usr/bin/env python3
import io
import os
import sys

import psycopg2


BACKUP_SQL = "/Users/jreynoso/Desktop/techloc-supabase-backup-2026-04-23/techloc_supabase_full_2026-04-23.sql"
COPY_HEADER = 'COPY public."PT-LastPing" ("Serial", "Year", "Make", "Model", "Color", "Customer", "Vehicle Status", "VIN", "Date", address, "Lat", "Long", city_bucket, moved, days_stationary, city_previous, vehicle_id, id, moved_v2, days_stationary_v2) FROM stdin;'


def load_copy_payload(path):
    rows = 0
    capture = False
    buffer = io.StringIO()
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            if not capture:
                if line.rstrip("\n") == COPY_HEADER:
                    capture = True
                continue
            if line == "\\.\n":
                break
            buffer.write(line)
            rows += 1
    if not capture:
        raise RuntimeError("PT-LastPing COPY block was not found in backup SQL.")
    buffer.seek(0)
    return buffer, rows


def main():
    backup_path = os.environ.get("PT_BACKUP_SQL", BACKUP_SQL)
    db_url = os.environ.get(
        "SUPABASE_DB_URL",
        "postgresql://postgres:Mntfunding123%3F@db.lzmbeojzjlrxuluroprh.supabase.co:5432/postgres?sslmode=require",
    )

    payload, backup_rows = load_copy_payload(backup_path)
    print(f"backup_rows={backup_rows}")

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                create temp table tmp_pt_lastping_backup (
                  "Serial" text,
                  "Year" text,
                  "Make" text,
                  "Model" text,
                  "Color" text,
                  "Customer" text,
                  "Vehicle Status" text,
                  "VIN" text,
                  "Date" timestamp without time zone,
                  address text,
                  "Lat" double precision,
                  "Long" double precision,
                  city_bucket text,
                  moved integer,
                  days_stationary integer,
                  city_previous text,
                  vehicle_id uuid,
                  id bigint,
                  moved_v2 integer,
                  days_stationary_v2 integer
                ) on commit drop;
                """
            )
            cur.copy_expert(
                """
                copy tmp_pt_lastping_backup (
                  "Serial", "Year", "Make", "Model", "Color", "Customer", "Vehicle Status",
                  "VIN", "Date", address, "Lat", "Long", city_bucket, moved,
                  days_stationary, city_previous, vehicle_id, id, moved_v2, days_stationary_v2
                ) from stdin
                """,
                payload,
            )
            cur.execute(
                """
                select
                  count(*)::bigint,
                  min("Date"),
                  max("Date"),
                  count(distinct "Serial")::bigint
                from tmp_pt_lastping_backup;
                """
            )
            staged = cur.fetchone()

            cur.execute(
                """
                with max_dates as (
                  select "Serial", max("Date") as max_date
                  from (
                    select "Serial", "Date"
                    from public."PT-LastPing"
                    where "Serial" is not null and "Date" is not null
                    union all
                    select "Serial", "Date"
                    from tmp_pt_lastping_backup
                    where "Serial" is not null and "Date" is not null
                  ) all_rows
                  group by "Serial"
                ), eligible as (
                  select b.*
                  from tmp_pt_lastping_backup b
                  join max_dates m on m."Serial" = b."Serial"
                  where b."Date" >= (m.max_date - interval '3 months')
                ), inserted as (
                  insert into public."PT-LastPing" (
                    "Serial", "Year", "Make", "Model", "Color", "Customer", "Vehicle Status",
                    "VIN", "Date", address, "Lat", "Long", city_bucket, moved,
                    days_stationary, city_previous, vehicle_id, moved_v2, days_stationary_v2
                  )
                  select
                    "Serial", "Year", "Make", "Model", "Color", "Customer", "Vehicle Status",
                    "VIN", "Date", address, "Lat", "Long", city_bucket, moved,
                    days_stationary, city_previous, null::uuid, moved_v2, days_stationary_v2
                  from eligible
                  on conflict do nothing
                  returning 1
                )
                select count(*)::bigint from inserted;
                """
            )
            inserted = cur.fetchone()[0]

            cur.execute(
                """
                with max_dates as (
                  select "Serial", max("Date") as max_date
                  from public."PT-LastPing"
                  where "Serial" is not null and "Date" is not null
                  group by "Serial"
                ), deleted as (
                  delete from public."PT-LastPing" p
                  using max_dates m
                  where p."Serial" = m."Serial"
                    and p."Date" < (m.max_date - interval '3 months')
                  returning 1
                )
                select count(*)::bigint from deleted;
                """
            )
            pruned = cur.fetchone()[0]

            cur.execute(
                """
                select
                  count(*)::bigint,
                  min("Date"),
                  max("Date"),
                  count(distinct "Serial")::bigint
                from public."PT-LastPing";
                """
            )
            final_stats = cur.fetchone()

            conn.commit()
            print(
                "staged_rows={} staged_min={} staged_max={} staged_serials={}".format(
                    staged[0], staged[1], staged[2], staged[3]
                )
            )
            print(f"inserted_rows={inserted}")
            print(f"pruned_rows={pruned}")
            print(
                "final_rows={} final_min={} final_max={} final_serials={}".format(
                    final_stats[0], final_stats[1], final_stats[2], final_stats[3]
                )
            )
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
