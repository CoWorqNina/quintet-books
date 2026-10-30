#!/usr/bin/env bash
# Runs the ledger behaviour tests against a scratch database.
# Needs a local Postgres; set PGHOST/PGPORT/PGUSER as needed.
set -euo pipefail
cd "$(dirname "$0")"
psql -X -q -c 'drop database if exists ledger_test' -c 'create database ledger_test'
psql -X -qAt -d ledger_test -v ON_ERROR_STOP=1 \
  -f local_stub.sql -f ../migrations/0001_ledger.sql -f ../migrations/0002_daily_reports.sql -f ../migrations/0003_registers.sql \
  -f ledger_test.sql -f daily_reports_test.sql -f registers_test.sql 2>&1 | grep -E 'ok:|ERROR|PASSED'
