#!/usr/bin/env python3

import json
import os
import re
import sys
from decimal import Decimal
from datetime import date, datetime

import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor, Json


IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def db_connect():
    return psycopg2.connect(
        host=os.environ["SUPABASE_DB_HOST"],
        port=int(os.environ.get("SUPABASE_DB_PORT", "5432")),
        dbname=os.environ.get("SUPABASE_DB_NAME", "postgres"),
        user=os.environ["SUPABASE_DB_USER"],
        password=os.environ["SUPABASE_DB_PASSWORD"],
        sslmode=os.environ.get("SUPABASE_DB_SSLMODE", "require"),
    )


def json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return str(value)


def emit(payload):
    sys.stdout.write(json.dumps(payload, default=json_default))
    sys.stdout.flush()


def load_request():
    raw = sys.stdin.read()
    return json.loads(raw or "{}")


def parse_columns(select_clause):
    raw = (select_clause or "*").strip()
    if raw == "*" or not raw:
        return None
    columns = []
    for part in raw.split(","):
        candidate = part.strip()
        if not candidate:
            continue
        if candidate.startswith('"') and candidate.endswith('"') and len(candidate) >= 2:
            candidate = candidate[1:-1].replace('""', '"')
        columns.append(candidate)
    return columns


def sanitize_identifier_candidate(value):
    candidate = str(value or "").strip()
    if candidate.startswith('"') and candidate.endswith('"') and len(candidate) >= 2:
        candidate = candidate[1:-1].replace('""', '"')
    return candidate.strip()


def normalize_lookup_key(value):
    return sanitize_identifier_candidate(value).lower()


def load_table_columns(cur, table):
    query = """
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = %s
        order by ordinal_position
    """
    rows = exec_query(cur, query, [table])
    names = [row["column_name"] for row in rows]
    lookup = {normalize_lookup_key(name): name for name in names}
    return names, lookup


def resolve_column_name(column, available_columns, column_lookup):
    candidate = sanitize_identifier_candidate(column)
    if not candidate:
        return candidate
    if candidate in available_columns:
        return candidate
    return column_lookup.get(normalize_lookup_key(candidate), candidate)


def build_select_list(select_clause, available_columns=None, column_lookup=None):
    columns = parse_columns(select_clause)
    if not columns:
        return sql.SQL("*")
    resolved = [
        resolve_column_name(col, available_columns or [], column_lookup or {})
        for col in columns
    ]
    return sql.SQL(", ").join(sql.Identifier(col) for col in resolved)


def parse_filter_value(raw):
    if raw == "null":
        return None
    lowered = str(raw).lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    return raw


def parse_filters(filters, available_columns=None, column_lookup=None):
    clauses = []
    params = []
    for column, raw_values in (filters or {}).items():
        resolved_column = resolve_column_name(column, available_columns or [], column_lookup or {})
        for raw in raw_values:
            if raw.startswith("eq."):
                clauses.append(sql.SQL("{} = %s").format(sql.Identifier(resolved_column)))
                params.append(parse_filter_value(raw[3:]))
            elif raw.startswith("neq."):
                clauses.append(sql.SQL("{} <> %s").format(sql.Identifier(resolved_column)))
                params.append(parse_filter_value(raw[4:]))
            elif raw.startswith("gt."):
                clauses.append(sql.SQL("{} > %s").format(sql.Identifier(resolved_column)))
                params.append(parse_filter_value(raw[3:]))
            elif raw.startswith("gte."):
                clauses.append(sql.SQL("{} >= %s").format(sql.Identifier(resolved_column)))
                params.append(parse_filter_value(raw[4:]))
            elif raw.startswith("lt."):
                clauses.append(sql.SQL("{} < %s").format(sql.Identifier(resolved_column)))
                params.append(parse_filter_value(raw[3:]))
            elif raw.startswith("lte."):
                clauses.append(sql.SQL("{} <= %s").format(sql.Identifier(resolved_column)))
                params.append(parse_filter_value(raw[4:]))
            elif raw.startswith("like."):
                clauses.append(sql.SQL("{} LIKE %s").format(sql.Identifier(resolved_column)))
                params.append(raw[5:])
            elif raw.startswith("ilike."):
                clauses.append(sql.SQL("{} ILIKE %s").format(sql.Identifier(resolved_column)))
                params.append(raw[6:])
            elif raw.startswith("is."):
                parsed = parse_filter_value(raw[3:])
                if parsed is None:
                    clauses.append(sql.SQL("{} IS NULL").format(sql.Identifier(resolved_column)))
                else:
                    clauses.append(sql.SQL("{} IS %s").format(sql.Identifier(resolved_column)))
                    params.append(parsed)
            elif raw.startswith("in.(") and raw.endswith(")"):
                values = [parse_filter_value(part.strip()) for part in raw[4:-1].split(",") if part.strip()]
                if values:
                    clauses.append(
                        sql.SQL("{} = ANY(%s)").format(sql.Identifier(resolved_column))
                    )
                    params.append(values)
    if not clauses:
        return sql.SQL(""), []
    return sql.SQL(" WHERE ") + sql.SQL(" AND ").join(clauses), params


def parse_order(order_value, available_columns=None, column_lookup=None):
    if not order_value:
        return sql.SQL("")
    parts = str(order_value).split(".")
    column = resolve_column_name(parts[0].strip(), available_columns or [], column_lookup or {})
    direction = "DESC" if len(parts) > 1 and parts[1].lower() == "desc" else "ASC"
    return sql.SQL(" ORDER BY {} {}").format(sql.Identifier(column), sql.SQL(direction))


def wants_representation(prefer_header):
    return "return=representation" in str(prefer_header or "")


def wants_exact_count(prefer_header):
    return "count=exact" in str(prefer_header or "")


def exec_query(cur, query, params=None, fetch="all"):
    cur.execute(query, params or [])
    if fetch == "one":
        return cur.fetchone()
    if fetch == "none":
        return None
    return cur.fetchall()


def handle_verify_user_password(payload):
    email = str(payload.get("email") or "").strip().lower()
    password = str(payload.get("password") or "")
    query = """
        select
          u.id,
          u.email,
          u.raw_app_meta_data,
          u.raw_user_meta_data,
          u.encrypted_password,
          p.role,
          p.status,
          p.name,
          p.background_mode
        from auth.users u
        left join public.profiles p on p.id = u.id
        where lower(u.email) = %s
          and u.encrypted_password = crypt(%s, u.encrypted_password)
          and u.deleted_at is null
        limit 1
    """
    with db_connect() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        row = exec_query(cur, query, [email, password], fetch="one")
        if not row:
            return {"ok": False}
        return {"ok": True, "user": dict(row)}


def handle_get_user_bundle(payload):
    user_id = str(payload.get("userId") or "").strip()
    query = """
        select
          u.id,
          u.email,
          u.raw_app_meta_data,
          u.raw_user_meta_data,
          p.role,
          p.status,
          p.name,
          p.background_mode
        from auth.users u
        left join public.profiles p on p.id = u.id
        where u.id = %s
          and u.deleted_at is null
        limit 1
    """
    with db_connect() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        row = exec_query(cur, query, [user_id], fetch="one")
        return {"user": dict(row) if row else None}


def handle_update_profile(payload):
    user_id = str(payload.get("userId") or "").strip()
    profile = payload.get("profile") or {}
    if not user_id or not profile:
        return {"profile": None}
    columns = []
    params = []
    for key, value in profile.items():
        columns.append(sql.SQL("{} = %s").format(sql.Identifier(key)))
        params.append(Json(value) if isinstance(value, (dict, list)) else value)
    params.append(user_id)
    query = sql.SQL("""
        update public.profiles
        set {assignments}
        where id = %s
        returning *
    """).format(assignments=sql.SQL(", ").join(columns))
    with db_connect() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        row = exec_query(cur, query, params, fetch="one")
        conn.commit()
        return {"profile": dict(row) if row else None}


def handle_query_table(payload):
    table = payload["table"]
    method = str(payload.get("method") or "GET").upper()
    query_params = payload.get("query") or {}
    prefer_header = payload.get("prefer") or ""
    body = payload.get("body")
    select_clause = query_params.get("select", ["*"])[0]
    limit_value = query_params.get("limit", [None])[0]
    offset_value = query_params.get("offset", [None])[0]
    order_value = query_params.get("order", [None])[0]
    on_conflict = query_params.get("on_conflict", [None])[0]
    filters = {
        key: value
        for key, value in query_params.items()
        if key not in {"select", "limit", "offset", "order", "on_conflict"}
    }

    with db_connect() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        available_columns, column_lookup = load_table_columns(cur, table)
        if method == "GET":
            where_sql, where_params = parse_filters(filters, available_columns, column_lookup)
            count = None
            if wants_exact_count(prefer_header):
                count_query = sql.SQL("select count(*) as total from public.{}").format(sql.Identifier(table)) + where_sql
                count_row = exec_query(cur, count_query, where_params, fetch="one")
                count = int(count_row["total"]) if count_row else 0
            query = sql.SQL("select {} from public.{}").format(
                build_select_list(select_clause, available_columns, column_lookup),
                sql.Identifier(table),
            ) + where_sql + parse_order(order_value, available_columns, column_lookup)
            params = list(where_params)
            if limit_value is not None:
                query += sql.SQL(" limit %s")
                params.append(int(limit_value))
            if offset_value is not None:
                query += sql.SQL(" offset %s")
                params.append(int(offset_value))
            rows = exec_query(cur, query, params)
            return {"rows": [dict(row) for row in rows], "count": count}

        if method in {"POST", "PATCH", "DELETE"}:
            where_sql, where_params = parse_filters(filters, available_columns, column_lookup)
            if method == "POST":
                records = body if isinstance(body, list) else [body]
                if not records:
                    return {"rows": [], "count": 0}
                columns = [
                    resolve_column_name(column, available_columns, column_lookup)
                    for column in list(records[0].keys())
                ]
                values_sql = []
                params = []
                for record in records:
                    placeholders = []
                    for column in columns:
                        value = record.get(column)
                        if value is None and column not in record:
                            original_key = next(
                                (key for key in record.keys() if resolve_column_name(key, available_columns, column_lookup) == column),
                                None,
                            )
                            value = record.get(original_key) if original_key is not None else None
                        params.append(Json(value) if isinstance(value, (dict, list)) else value)
                        placeholders.append(sql.SQL("%s"))
                    values_sql.append(sql.SQL("({})").format(sql.SQL(", ").join(placeholders)))
                query = sql.SQL("insert into public.{} ({}) values {}").format(
                    sql.Identifier(table),
                    sql.SQL(", ").join(sql.Identifier(column) for column in columns),
                    sql.SQL(", ").join(values_sql),
                )
                if on_conflict:
                    conflict_columns = [
                        resolve_column_name(part.strip(), available_columns, column_lookup)
                        for part in on_conflict.split(",")
                        if part.strip()
                    ]
                    if "resolution=ignore-duplicates" in prefer_header:
                        query += sql.SQL(" on conflict ({}) do nothing").format(
                            sql.SQL(", ").join(sql.Identifier(col) for col in conflict_columns)
                        )
                    else:
                        update_columns = [column for column in columns if column not in conflict_columns]
                        query += sql.SQL(" on conflict ({}) do update set {}").format(
                            sql.SQL(", ").join(sql.Identifier(col) for col in conflict_columns),
                            sql.SQL(", ").join(
                                sql.SQL("{} = excluded.{}").format(sql.Identifier(col), sql.Identifier(col))
                                for col in update_columns
                            ),
                        )
                if wants_representation(prefer_header):
                    query += sql.SQL(" returning {}").format(build_select_list(select_clause, available_columns, column_lookup))
                    rows = exec_query(cur, query, params)
                    conn.commit()
                    return {"rows": [dict(row) for row in rows], "count": len(rows)}
                exec_query(cur, query, params, fetch="none")
                conn.commit()
                return {"rows": [], "count": len(records)}

            if method == "PATCH":
                values = body or {}
                assignments = []
                params = []
                for column, value in values.items():
                    resolved_column = resolve_column_name(column, available_columns, column_lookup)
                    assignments.append(sql.SQL("{} = %s").format(sql.Identifier(resolved_column)))
                    params.append(Json(value) if isinstance(value, (dict, list)) else value)
                query = sql.SQL("update public.{} set {}").format(
                    sql.Identifier(table),
                    sql.SQL(", ").join(assignments),
                ) + where_sql
                params.extend(where_params)
                if wants_representation(prefer_header):
                    query += sql.SQL(" returning {}").format(build_select_list(select_clause, available_columns, column_lookup))
                    rows = exec_query(cur, query, params)
                    conn.commit()
                    return {"rows": [dict(row) for row in rows], "count": len(rows)}
                exec_query(cur, query, params, fetch="none")
                conn.commit()
                return {"rows": [], "count": 0}

            if method == "DELETE":
                query = sql.SQL("delete from public.{}").format(sql.Identifier(table)) + where_sql
                params = list(where_params)
                if wants_representation(prefer_header):
                    query += sql.SQL(" returning {}").format(build_select_list(select_clause, available_columns, column_lookup))
                    rows = exec_query(cur, query, params)
                    conn.commit()
                    return {"rows": [dict(row) for row in rows], "count": len(rows)}
                exec_query(cur, query, params, fetch="none")
                conn.commit()
                return {"rows": [], "count": 0}

    return {"rows": [], "count": 0}


def handle_rpc(payload):
    function_name = str(payload.get("function") or "").strip()
    args = payload.get("args") or {}
    if not IDENTIFIER_RE.match(function_name):
        raise ValueError("Invalid function name.")
    named_parts = []
    params = []
    for key, value in args.items():
        if not IDENTIFIER_RE.match(key):
            raise ValueError("Invalid function argument.")
        named_parts.append(sql.SQL(f"{key} => %s"))
        params.append(Json(value) if isinstance(value, (dict, list)) else value)
    query = sql.SQL("select public.{}({}) as result").format(
        sql.Identifier(function_name),
        sql.SQL(", ").join(named_parts),
    )
    with db_connect() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        row = exec_query(cur, query, params, fetch="one")
        conn.commit()
        return {"result": row["result"] if row else None}


def main():
    request = load_request()
    action = request.get("action")
    if action == "verify_user_password":
        emit(handle_verify_user_password(request))
        return
    if action == "get_user_bundle":
        emit(handle_get_user_bundle(request))
        return
    if action == "update_profile":
        emit(handle_update_profile(request))
        return
    if action == "query_table":
        emit(handle_query_table(request))
        return
    if action == "rpc":
        emit(handle_rpc(request))
        return
    emit({"error": "Unsupported action"})


if __name__ == "__main__":
    main()
