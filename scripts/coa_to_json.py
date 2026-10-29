"""Convert the approved Chart of Accounts workbook into normalized JSON (data/chart-of-accounts.json)."""
import json
import sys

import openpyxl

src, out = sys.argv[1], sys.argv[2]
ws = openpyxl.load_workbook(src, data_only=True)["Chart of Accounts"]

rows = []
for r in ws.iter_rows(min_row=5, values_only=True):
    if r[0] is None:
        continue
    code = str(int(r[0]))
    rows.append({
        "code": code,
        "name": r[1],
        "type": r[2],
        "normalBalance": r[3],
        "book": r[4],
        "profitCenterRule": r[5],
        "subLedger": r[6],
        "cashFlowGroup": r[7],
        "description": r[8],
        "coaStatus": r[9],
        "changeNote": r[10],
    })


def header_range(code):
    n = int(code)
    zeros = len(code) - len(code.rstrip("0"))
    if zeros == 0:
        # e.g. 1155 "Cash - The Nest" covers 1155-1159
        return n, n + 4
    return n, n + 10 ** zeros - 1


headers = [(r["code"], r["name"], *header_range(r["code"])) for r in rows if r["type"] == "Header"]

# Headers whose code falls inside another header's range but are not part of that group
# (6550 Platform & Card Fees is numbered inside Marketing 6500-6599 but is its own group).
PARENT_OVERRIDES = {"6550": "6000"}

for r in rows:
    n = int(r["code"])
    parents = [h for h in headers if h[0] != r["code"] and h[2] <= n <= h[3]]
    if r["code"] in PARENT_OVERRIDES:
        parents = [h for h in headers if h[0] == PARENT_OVERRIDES[r["code"]]]
    # deepest = narrowest range
    parent = min(parents, key=lambda h: h[3] - h[2]) if parents else None
    r["parentCode"] = parent[0] if parent else None
    # Accounts sitting directly under a top-level header (e.g. 1300, 2100) are their own statement line
    top_level = parent is None or parent[0].endswith("000")
    r["statementLine"] = r["name"] if top_level and not r["type"] == "Header" else (parent[1] if parent else r["name"])
    r["statement"] = "Balance Sheet" if r["code"][0] in "123" else "Income Statement"
    r["isHeader"] = r["type"] == "Header"
    r["isCashAccount"] = r["cashFlowGroup"] == "Cash"

# Management decisions made after the workbook was exported (see docs/DECISIONS.md)
CASH_FLOW_OVERRIDES = {"1220": "Financing", "1230": "Financing", "2170": "Financing"}
for r in rows:
    if r["code"] in CASH_FLOW_OVERRIDES:
        r["cashFlowGroup"] = CASH_FLOW_OVERRIDES[r["code"]]

json.dump(rows, open(out, "w"), indent=2, ensure_ascii=False)
print(len(rows), "accounts,", len(headers), "headers")
