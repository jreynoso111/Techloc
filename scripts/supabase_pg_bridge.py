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

ROLE_ACTIVE_USER = "active_user"
ROLE_ADMINISTRATOR = "administrator"


def make_set(values):
    return set(str(value).strip() for value in values if str(value).strip())


def without_columns(columns, blocked):
    blocked_set = make_set(blocked)
    return set(column for column in columns if column not in blocked_set)


ALLOWED_REPAIR_FIELDS = make_set([
    "vehicle_id",
    "deal_status",
    "customer_id",
    "unit_type",
    "model_year",
    "model",
    "inv_prep_stat",
    "deal_completion",
    "pt_status",
    "pt_serial",
    "encore_serial",
    "phys_loc",
    "VIN",
    "vehicle_status",
    "days_stationary",
    "short_location",
    "current_stock_no",
    "cs_contact_date",
    "status",
    "doc",
    "shipping_date",
    "poc_name",
    "poc_phone",
    "customer_availability",
    "installer_request_date",
    "installation_company",
    "technician_availability_date",
    "installation_place",
    "repair_price",
    "repair_notes",
    "shortvin",
])

PROFILE_PUBLIC_COLUMNS = make_set([
    "id",
    "email",
    "name",
    "role",
    "status",
    "map_category",
    "background_mode",
    "created_at",
    "updated_at",
])

VEHICLE_WRITE_COLUMNS = make_set([
    "gps fix",
    "gps fix reason",
    "gps_fix",
    "gps_fix_reason",
    "gps_moving",
    "moving",
    "movement_status_v2",
    "movement_days_stationary_v2",
    "movement_threshold_meters_v2",
    "movement_unit_type_v2",
    "movement_computed_at_v2",
    "pt_first_read",
    "pt_last_read",
    "pt_last_lat",
    "pt_last_long",
    "pt_last_address",
    "pt_last_city",
    "pt_last_serial",
    "days_stationary",
    "short_location",
    "updated_at",
])

PT_LASTPING_WRITE_COLUMNS = make_set([
    "VIN",
    "vehicle_id",
    "moved_v2",
    "days_stationary_v2",
])

VEHICLE_COLUMNS = make_set([
    "deal status", "customer id", "unit type", "model year", "model", "shortvin", "inv. prep. stat.",
    "deal completion", "gps fix", "gps fix reason", "pt status", "pt serial", "encore serial", "moving",
    "pt last read", "state loc", "pt city", "pt zipcode", "lat", "long", "phys_loc", "Current Stock No",
    "id", "VIN", "Vehicle Status", "Open Balance", "Oldest Invoice (Open)", "days_stationary",
    "short_location", "CDL State", "Real ID?", "CDL Note", "Visit Exp.", "CDL Exp Date", "SSN",
    "Green Card", "Passport", "Work Permit Expires", "repo notes", "Last Update", "Schdl To repair?",
    "Last_repo_date", "pt first read", "movement_status_v2", "movement_days_stationary_v2",
    "movement_computed_at_v2", "movement_threshold_meters_v2", "movement_unit_type_v2",
])

DEALSJP1_COLUMNS = make_set([
    "Deal Status", "Deal Date", "HOLD", "Current Stock No", "Customer", "Brand", "Model", "Model Year",
    "VIN", "Corrected VIN", "Vehicle Status", "Mileage", "Driver License #",
    "Inventory Preparation Status", "Inventory Preparation Status Changed On",
    "Inventory Preparation Status Changed By", "Physical Location", "Physical Location Last Changed on",
    "ENTITY", "Retail Price On Contract", "Cash Down", "Total due on Deal", "Amount",
    "Reg. Contract Payment", "Payment Schedule", "Total Payments in Months",
    "Number OF Schedule Remaining", "Lead Source", "Date of Birth", "TAM Legacy Created Date",
    "Payment Schedule Start", "Last Payment Date", "TAM Legacy Stock #", "Trade In VIN",
    "Trade In Amount", "Sales Person", "Subsidiary", "Location", "Lease End Date", "Bucket",
    "Bucket Sub Type", "Payment Schedule_1", "Lease Term", "Regular Amount",
    "Total Contract Scheduled Amount", "Inventory Valuation Value", "Sales Channel", "Partner Name",
    "Remaining Scheduled Payments To Invoice", "Deposit", "PassTime Serial No",
    "PassTime Vehicle Status", "EFT Available", "Primary Payment Mode", "Secondary Payment Mode",
    "Plate Number", "Mobile Phone", "Encore Serial Number", "Encore Serial #2", "GPS Serial No",
    "Plate Number_1", "Current Title Number", "Current Title Subsidiary",
    "Current Title Physical Location", "Title In Date", "Title Out Date", "Financing Company",
    "Broker", "Return Type", "Actual System Return Date", "Returned By",
    "Number OF Schedule Remaining_1", "Unit Type", "Open Balance", "id", "Last Deal",
    "Oldest Invoice (Open)", "Calc.End", "gps_status", "gps_status_updated_at", "gps_review_flag",
    "Deal Completion",
])

PT_LASTPING_COLUMNS = make_set([
    "Serial", "Year", "Make", "Model", "Color", "Customer", "Vehicle Status", "VIN", "Date", "address",
    "Lat", "Long", "city_bucket", "moved", "days_stationary", "read_day", "city_previous",
    "vehicle_id", "id", "day_half", "moved_v2", "days_stationary_v2",
])

SERVICES_COLUMNS = make_set([
    "company_name", "region", "phone", "contact", "email", "website", "availability", "notes", "city",
    "state", "zip", "category", "type", "authorization", "address", "status", "lat", "long", "id",
    "verified",
])

HOTSPOT_COLUMNS = make_set(["id", "created_at", "State", "City", "Zip", "Lat", "Long", "Radius"])

SERVICES_BLACKLIST_COLUMNS = make_set([
    "id", "created_at", "company_name", "category", "lat", "long", "Assoc.Unit", "Note", "State",
    "City", "Zip", "Event date", "Alarm", "address",
])

GPS_BLACKLIST_COLUMNS = make_set(["serial", "reason", "is_active", "added_at", "added_by", "uuid", "effective_from"])

USER_TABLE_CONFIG_COLUMNS = make_set(["id", "user_id", "table_key", "table_name", "config", "created_at", "updated_at"])

SERVICES_REQUEST_COLUMNS = make_set([
    "id", "company_name", "company phone", "doc", "unittype", "brand", "model", "model year", "shortvin",
    "status", "quote", "request date", "workdate", "shipping date", "poc name", "poc phone", "confirmed",
    "state", "city", "zip", "address", "Service_category", "Notes", "POC email", "created_at", "updated_at",
])

SERVICES_CATEGORIES_COLUMNS = make_set(["id", "category", "created_at", "updated_at"])

VEHICLE_PUBLIC_READ_COLUMNS = without_columns(VEHICLE_COLUMNS, [
    "CDL State", "Real ID?", "CDL Note", "Visit Exp.", "CDL Exp Date", "SSN", "Green Card",
    "Passport", "Work Permit Expires",
])

DEALSJP1_PUBLIC_READ_COLUMNS = without_columns(DEALSJP1_COLUMNS, [
    "Driver License #", "Date of Birth", "Mobile Phone",
])

TABLE_ACCESS_POLICIES = {
    "app_settings": {
        "methods": {"GET": ROLE_ACTIVE_USER, "HEAD": ROLE_ACTIVE_USER},
        "readable_columns": make_set(["key", "settings", "updated_at", "created_at"]),
    },
    "services": {
        "methods": {"GET": ROLE_ACTIVE_USER, "HEAD": ROLE_ACTIVE_USER},
        "readable_columns": SERVICES_COLUMNS,
    },
    "hotspots": {
        "methods": {"GET": ROLE_ACTIVE_USER, "HEAD": ROLE_ACTIVE_USER},
        "readable_columns": HOTSPOT_COLUMNS,
    },
    "services_blacklist": {
        "methods": {"GET": ROLE_ACTIVE_USER, "HEAD": ROLE_ACTIVE_USER},
        "readable_columns": SERVICES_BLACKLIST_COLUMNS,
    },
    "gps_blacklist": {
        "methods": {"GET": ROLE_ACTIVE_USER, "HEAD": ROLE_ACTIVE_USER},
        "readable_columns": GPS_BLACKLIST_COLUMNS,
    },
    "control_map_vehicle_clicks": {
        "methods": {"GET": ROLE_ACTIVE_USER, "HEAD": ROLE_ACTIVE_USER, "POST": ROLE_ACTIVE_USER},
        "readable_columns": make_set(["id", "user_id", "vin", "clicked_at", "source", "page", "action", "metadata", "created_at"]),
        "writable_columns": make_set(["user_id", "vin", "clicked_at", "source", "page", "action", "metadata"]),
    },
    "user_table_configs": {
        "methods": {
            "GET": ROLE_ACTIVE_USER,
            "HEAD": ROLE_ACTIVE_USER,
            "POST": ROLE_ACTIVE_USER,
            "PATCH": ROLE_ACTIVE_USER,
            "DELETE": ROLE_ACTIVE_USER,
        },
        "readable_columns": USER_TABLE_CONFIG_COLUMNS,
        "writable_columns": USER_TABLE_CONFIG_COLUMNS,
    },
    "titles": {
        "methods": {
            "GET": ROLE_ADMINISTRATOR,
            "HEAD": ROLE_ADMINISTRATOR,
            "POST": ROLE_ADMINISTRATOR,
            "PATCH": ROLE_ADMINISTRATOR,
            "DELETE": ROLE_ADMINISTRATOR,
        },
        "allow_wildcard_read": True,
        "allow_wildcard_write": True,
    },
    "services_request": {
        "methods": {
            "GET": ROLE_ACTIVE_USER,
            "HEAD": ROLE_ACTIVE_USER,
            "POST": ROLE_ACTIVE_USER,
            "PATCH": ROLE_ACTIVE_USER,
            "DELETE": ROLE_ACTIVE_USER,
        },
        "readable_columns": SERVICES_REQUEST_COLUMNS,
        "writable_columns": SERVICES_REQUEST_COLUMNS,
    },
    "services_categories": {
        "methods": {
            "GET": ROLE_ACTIVE_USER,
            "HEAD": ROLE_ACTIVE_USER,
            "POST": ROLE_ADMINISTRATOR,
            "PATCH": ROLE_ADMINISTRATOR,
            "DELETE": ROLE_ADMINISTRATOR,
        },
        "readable_columns": SERVICES_CATEGORIES_COLUMNS,
        "writable_columns": SERVICES_CATEGORIES_COLUMNS,
    },
    "vehicles": {
        "methods": {
            "GET": ROLE_ACTIVE_USER,
            "HEAD": ROLE_ACTIVE_USER,
            "POST": ROLE_ADMINISTRATOR,
            "PATCH": ROLE_ADMINISTRATOR,
            "DELETE": ROLE_ADMINISTRATOR,
        },
        "readable_columns": VEHICLE_PUBLIC_READ_COLUMNS,
        "admin_readable_columns": VEHICLE_COLUMNS,
        "writable_columns": VEHICLE_COLUMNS,
    },
    "dealsjp1": {
        "methods": {
            "GET": ROLE_ACTIVE_USER,
            "HEAD": ROLE_ACTIVE_USER,
            "POST": ROLE_ADMINISTRATOR,
            "PATCH": ROLE_ADMINISTRATOR,
            "DELETE": ROLE_ADMINISTRATOR,
        },
        "readable_columns": DEALSJP1_PUBLIC_READ_COLUMNS,
        "admin_readable_columns": DEALSJP1_COLUMNS,
        "writable_columns": DEALSJP1_COLUMNS,
    },
    "pt-lastping": {
        "methods": {
            "GET": ROLE_ACTIVE_USER,
            "HEAD": ROLE_ACTIVE_USER,
            "POST": ROLE_ADMINISTRATOR,
            "PATCH": ROLE_ADMINISTRATOR,
            "DELETE": ROLE_ADMINISTRATOR,
        },
        "readable_columns": PT_LASTPING_COLUMNS,
        "writable_columns": PT_LASTPING_COLUMNS,
    },
    "profiles": {
        "methods": {"GET": ROLE_ADMINISTRATOR, "HEAD": ROLE_ADMINISTRATOR, "PATCH": ROLE_ADMINISTRATOR},
        "readable_columns": PROFILE_PUBLIC_COLUMNS,
        "writable_columns": make_set(["email", "name", "role", "status", "map_category", "background_mode"]),
    },
    "admin_change_log": {
        "methods": {"GET": ROLE_ADMINISTRATOR, "HEAD": ROLE_ADMINISTRATOR, "POST": ROLE_ADMINISTRATOR},
        "readable_columns": make_set(["id", "table_name", "action", "summary", "actor", "record_id", "column_name", "previous_value", "new_value", "profile_email", "profile_role", "profile_status", "page_path", "source", "details", "created_at"]),
        "writable_columns": make_set(["table_name", "action", "summary", "actor", "record_id", "column_name", "previous_value", "new_value", "profile_email", "profile_role", "profile_status", "page_path", "source", "details", "created_at"]),
    },
    "repair_history": {
        "methods": {
            "GET": ROLE_ACTIVE_USER,
            "HEAD": ROLE_ACTIVE_USER,
            "POST": ROLE_ACTIVE_USER,
            "PATCH": ROLE_ACTIVE_USER,
            "DELETE": ROLE_ACTIVE_USER,
        },
        "allow_wildcard_read": True,
        "writable_columns": ALLOWED_REPAIR_FIELDS,
    },
}

RPC_ACCESS_POLICIES = {
    "update_vehicle_gps_fields": {
        "role": ROLE_ADMINISTRATOR,
        "args": make_set(["p_vehicle_id", "p_gps_fix", "p_gps_fix_reason"]),
    },
    "refresh_vehicle_movement_v2": {
        "role": ROLE_ADMINISTRATOR,
        "args": make_set(["p_vin"]),
    },
    "finalize_pt_lastping_upload": {
        "role": ROLE_ADMINISTRATOR,
        "args": make_set(["p_vins", "p_min_id_exclusive"]),
    },
    "recalc_dealsjp1_last_deal": {
        "role": ROLE_ADMINISTRATOR,
        "args": set(),
    },
    "sync_vehicles_from_dealsjp1_lastdeal": {
        "role": ROLE_ADMINISTRATOR,
        "args": set(),
    },
}


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


def normalize_access_name(value):
    return str(value or "").strip().lower()


def has_required_role(auth, required_role):
    auth = auth or {}
    role = str(auth.get("role") or "user").lower()
    status = str(auth.get("status") or "active").lower()
    if required_role == ROLE_ADMINISTRATOR:
        return role == "administrator" and status == "active"
    return status != "suspended"


def collect_body_columns(body):
    if isinstance(body, list):
        columns = []
        for row in body:
            if isinstance(row, dict):
                columns.extend(row.keys())
        return sorted(set(columns))
    if isinstance(body, dict):
        return list(body.keys())
    return []


def collect_body_rows(body):
    if isinstance(body, list):
        return [row for row in body if isinstance(row, dict)]
    if isinstance(body, dict):
        return [body]
    return []


def validate_allowed_columns(columns, allowed_columns=None, allow_wildcard=False, label="Column"):
    allowed_columns = allowed_columns or set()
    for column in columns:
        if column == "*" and allow_wildcard:
            continue
        if column == "*" or column not in allowed_columns:
            raise PermissionError(f"{label} is not allowed: {column}")


def quote_select_column(column):
    if IDENTIFIER_RE.match(column):
        return column
    return '"' + str(column).replace('"', '""') + '"'


def build_allowed_select_clause(columns):
    return ",".join(quote_select_column(column) for column in columns)


def get_readable_columns_for_policy(policy, auth):
    auth = auth or {}
    role = str(auth.get("role") or "user").lower()
    status = str(auth.get("status") or "active").lower()
    if role == "administrator" and status == "active" and policy.get("admin_readable_columns"):
        return policy.get("admin_readable_columns")
    return policy.get("readable_columns", set())


def require_table_policy(payload, table, method, body, select_clause):
    policy = TABLE_ACCESS_POLICIES.get(normalize_access_name(table))
    if not policy:
        raise PermissionError(f"Table is not allowed through this API: {table}")
    required_role = policy.get("methods", {}).get(method)
    if not required_role:
        raise PermissionError(f"{method} is not allowed for table {table}")
    if not has_required_role(payload.get("auth"), required_role):
        if required_role == ROLE_ADMINISTRATOR:
            raise PermissionError("Active administrator role is required.")
        raise PermissionError("Active session is required.")
    if normalize_access_name(table) == "user_table_configs":
        auth_user_id = str((payload.get("auth") or {}).get("userId") or "").strip()
        query_params = payload.get("query") or {}
        user_filters = query_params.get("user_id") or []
        if isinstance(user_filters, str):
            user_filters = [user_filters]
        expected_filter = f"eq.{auth_user_id}"
        if method in {"GET", "HEAD", "PATCH", "DELETE"} and expected_filter not in user_filters:
            raise PermissionError("User table config access must be scoped to the current user.")
        if method not in {"GET", "HEAD", "DELETE"}:
            rows = collect_body_rows(body)
            if not rows or any(str(row.get("user_id") or "").strip() != auth_user_id for row in rows):
                raise PermissionError("User table config writes must be scoped to the current user.")
    if method in {"GET", "HEAD"}:
        readable_columns = get_readable_columns_for_policy(policy, payload.get("auth"))
        if (not select_clause or select_clause == "*") and not policy.get("allow_wildcard_read") and readable_columns:
            return policy
        validate_allowed_columns(
            parse_columns(select_clause) or ["*"],
            readable_columns,
            bool(policy.get("allow_wildcard_read")),
            "Read column",
        )
    else:
        validate_allowed_columns(
            collect_body_columns(body),
            policy.get("writable_columns", set()),
            bool(policy.get("allow_wildcard_write")),
            "Write column",
        )
    return policy


def require_rpc_policy(payload, function_name, args):
    policy = RPC_ACCESS_POLICIES.get(normalize_access_name(function_name))
    if not policy:
        raise PermissionError(f"RPC is not allowed through this API: {function_name}")
    if not has_required_role(payload.get("auth"), policy.get("role")):
        raise PermissionError("Active administrator role is required.")
    validate_allowed_columns(list((args or {}).keys()), policy.get("args", set()), False, "RPC argument")
    return policy


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
          p.map_category,
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
          p.map_category,
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
    blocked_fields = [key for key in profile.keys() if key not in {"name", "background_mode", "last_connection"}]
    if blocked_fields:
        raise PermissionError(f"Profile field is not writable here: {blocked_fields[0]}")
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
    policy = require_table_policy(payload, table, method, body, select_clause)
    readable_columns = get_readable_columns_for_policy(policy, payload.get("auth"))
    if method in {"GET", "HEAD"} and (not select_clause or select_clause == "*") and not policy.get("allow_wildcard_read") and readable_columns:
        select_clause = build_allowed_select_clause(readable_columns)
    filters = {
        key: value
        for key, value in query_params.items()
        if key not in {"select", "limit", "offset", "order", "on_conflict"}
    }
    if method in {"PATCH", "DELETE"} and not filters:
        raise PermissionError(f"{method} requires at least one filter.")

    with db_connect() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        available_columns, column_lookup = load_table_columns(cur, table)
        if method in {"GET", "HEAD"}:
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
            return {"rows": [] if method == "HEAD" else [dict(row) for row in rows], "count": count}

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
    require_rpc_policy(payload, function_name, args)
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
    try:
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
        emit({"error": {"message": "Unsupported action", "status": 400}})
    except PermissionError as error:
        emit({"error": {"message": str(error), "status": 403}})
    except ValueError as error:
        emit({"error": {"message": str(error), "status": 400}})


if __name__ == "__main__":
    main()
