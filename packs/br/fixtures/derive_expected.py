#!/usr/bin/env python3
"""Derive expected.json from portfolio.json — INDEPENDENTLY of lib/calc.

MILESTONES.md §2 decision 12: this script is the hand derivation, checked in
so its independence is auditable and re-runnable. It uses only the Python
standard library (`decimal` at 50 digits), takes its closed days from the
published ANBIMA calendar as a LITERAL list (never from packs/br/calendar.ts),
and solves XIRR by bisection (never Newton), so nothing here shares code or
method with the kernel.

Every convention it applies is stated in docs/milestone-2-plan.md and
MILESTONES.md §2 decisions 1, 2, 9, 10, 13, 16, 17:

  * FIFO lots in (tradeDate, rank, id) order, rank buy < dividend/interest/fee < sell.
  * market_price: quantity × latest price ≤ D; fresh on D, carried forward up to
    WINDOW days (BR 2026: Carnival's four closed days + 1 = 5), stale beyond.
    nav_unit_price tolerates two more calendar days.
  * accrual, daily on BUS/252: n = business days in (openedOn, D].
      plain               (1 + rate) ** (n / 252)
      percent_of_index    Π over those days of (1 + rate × cdi_d)
      index_plus_spread   level(D) / level(openedOn) × (1 + rate) ** (n / 252),
                          level linear on calendar days between month-end anchors
  * Confident total = ok + carried_forward rows; stale/unpriced excluded.
  * TWR: r = V_D / (V_{D-1} + CF_D) − 1 with START-OF-DAY flows; flows ≤ the
    first valuation date are part of V₀; non-positive denominators are skipped.
  * MWR: XIRR over −V(first) at first, each flow in (first, asOf] negated,
    +V(asOf) at asOf; t in ACT/365 years from the earliest date.
  * Contribution: gain_i = V_i(asOf) − V_i(first) − netInvested_i((first, asOf]),
    D = V(first) + Σ flows in (first, asOf], c_i = gain_i / D.

This script implements ONLY the conventions the fixture exercises: fresh and
carried-forward prices, daily BUS/252 accrual in three modes, IPCA linear
interpolation between bracketing anchors (no 62-day carry), same-currency
holdings (no FX). Extend it deliberately when the fixture grows — an
unhandled case raises rather than guessing.

Run:  python3 packs/br/fixtures/derive_expected.py
A mismatch with `pnpm test:packs` is a bug in this script OR in lib/calc,
resolved by rederiving by hand — never by editing expected.json to match.
"""
import json
from datetime import date, timedelta
from decimal import Decimal, getcontext
from pathlib import Path

getcontext().prec = 50

HERE = Path(__file__).resolve().parent
PORTFOLIO = HERE / "portfolio.json"
EXPECTED = HERE / "expected.json"

# Closed days touching the fixture's range, from the published ANBIMA 2026
# calendar: Carnival Monday and Tuesday. Weekends are closed by weekday().
CLOSED = {date(2026, 1, 1), date(2026, 2, 16), date(2026, 2, 17)}
# Longest closure run touching 2026 (Sat 14 – Tue 17 Feb = 4 days) + 1.
WINDOW = 5
NAV_EXTRA = 2
RANK = {"buy": 0, "dividend": 1, "interest": 1, "fee": 1, "sell": 2}

D = Decimal
ZERO, ONE = D(0), D(1)


def iso(dt: date) -> str:
    return dt.isoformat()


def parse(s: str) -> date:
    return date.fromisoformat(s)


def fmt(x: Decimal) -> str:
    """Plain decimal text with 24 fractional digits, trailing zeros stripped."""
    s = format(x.quantize(D("1e-24")), "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def is_business(dt: date) -> bool:
    return dt.weekday() < 5 and dt not in CLOSED


def business_days(a: date, b: date) -> list[date]:
    """Business days in (a, b]."""
    out, cur = [], a + timedelta(days=1)
    while cur <= b:
        if is_business(cur):
            out.append(cur)
        cur += timedelta(days=1)
    return out


# --------------------------------------------------------------------------- inputs
fixture = json.loads(PORTFOLIO.read_text())
BASE = fixture["baseCurrency"]
AS_OF = parse(fixture["asOf"])
DATES = sorted(parse(d) for d in fixture["valuationDates"])
FIRST = DATES[0]
assets = {a["id"]: a for a in fixture["assets"]}
kinds = {
    "br.fii": ("market", None),
    "br.tesouro_direto": ("nav", None),
    "br.cdb": ("accrual", ("percent_of_index", "br.cdi")),
    "br.lci_lca": ("accrual", ("percent_of_index", "br.cdi")),
    "br.cdb_prefixado": ("accrual", ("plain", None)),
    "br.cdb_ipca": ("accrual", ("index_plus_spread", "br.ipca")),
}
prices = {ident: {parse(p["date"]): D(p["price"]) for p in rows} for ident, rows in fixture["prices"].items()}
series = {sid: {parse(p["date"]): D(p["value"]) for p in rows} for sid, rows in fixture["series"].items()}
txns = sorted(fixture["transactions"], key=lambda t: (t["tradeDate"], RANK[t["type"]], t["id"]))
flows = [(parse(f["date"]), D(f["amount"])) for f in fixture["cashFlows"]]


# --------------------------------------------------------------------------- positions
def lots_at(asset_id: str, day: date):
    """FIFO open lots [(openedOn, quantity, unitPrice)] as of `day`."""
    lots = []
    for t in txns:
        if t["assetId"] != asset_id or parse(t["tradeDate"]) > day:
            continue
        q = D(t["quantity"])
        if t["type"] == "buy":
            lots.append([parse(t["tradeDate"]), q, D(t["unitPrice"])])
        elif t["type"] == "sell":
            remaining = -q
            while remaining > 0:
                head = lots[0]
                if head[1] <= remaining:
                    remaining -= head[1]
                    lots.pop(0)
                else:
                    head[1] -= remaining
                    remaining = ZERO
    return lots


def net_invested(asset_id: str, a: date, b: date) -> Decimal:
    """Σ over (a, b]: buy cost + fees; − sell proceeds (|q|·p − fees); − dividend/interest; + fee."""
    total = ZERO
    for t in txns:
        if t["assetId"] != asset_id:
            continue
        day = parse(t["tradeDate"])
        if not (a < day <= b):
            continue
        q, p, fees = D(t["quantity"]), D(t["unitPrice"]), D(t.get("fees", "0"))
        if t["type"] == "buy":
            total += q * p + fees
        elif t["type"] == "sell":
            total -= abs(q) * p - fees
        elif t["type"] in ("dividend", "interest"):
            total -= p
        else:
            total += p
    return total


# --------------------------------------------------------------------------- series
def latest_at_or_before(table: dict, day: date):
    candidates = [d for d in table if d <= day]
    return max(candidates) if candidates else None


def ipca_level(day: date) -> Decimal:
    """linear_daily between the two month-end anchors bracketing `day`."""
    anchors = sorted(series["br.ipca"])
    prev = max(d for d in anchors if d <= day)
    if prev == day:
        return series["br.ipca"][prev]
    nxt = min(d for d in anchors if d > day)  # the fixture brackets every date it needs
    span = D((nxt - prev).days)
    elapsed = D((day - prev).days)
    lo, hi = series["br.ipca"][prev], series["br.ipca"][nxt]
    return lo + (hi - lo) * elapsed / span


# --------------------------------------------------------------------------- valuation
derivation = {"businessDays": {}, "accrualFactors": {}, "ipcaLevels": {}, "perDate": {}}


def value_asset(asset_id: str, day: date):
    """→ (native value, status) or (None, reason)."""
    a = assets[asset_id]
    lots = lots_at(asset_id, day)
    if not lots:
        return None, "no_position"
    strategy, index = kinds[a["instrumentKind"]]
    quantity = sum(l[1] for l in lots)

    if strategy in ("market", "nav"):
        table = prices[a["identifier"]]
        observed = latest_at_or_before(table, day)
        if observed is None:
            return None, "no_price"
        age = (day - observed).days
        window = WINDOW + (NAV_EXTRA if strategy == "nav" else 0)
        status = "ok" if age == 0 else ("carried_forward" if age <= window else "stale")
        return quantity * table[observed], status

    mode, sid = index
    rate = D(a["metadata"]["rate"])
    total = ZERO
    for opened, q, unit in lots:
        days = business_days(opened, day)
        n = len(days)
        derivation["businessDays"].setdefault(asset_id, {})[f"({iso(opened)}, {iso(day)}]"] = n
        if mode == "plain":
            factor = (ONE + rate) ** (D(n) / D(252))
        elif mode == "percent_of_index":
            factor = ONE
            for d in days:
                if d not in series[sid]:
                    return None, "series_gap"
                factor *= ONE + rate * series[sid][d]
        else:  # index_plus_spread
            lo, hi = ipca_level(opened), ipca_level(day)
            derivation["ipcaLevels"][iso(opened)] = fmt(lo)
            derivation["ipcaLevels"][iso(day)] = fmt(hi)
            factor = hi / lo * (ONE + rate) ** (D(n) / D(252))
        derivation["accrualFactors"].setdefault(asset_id, {})[iso(day)] = fmt(factor)
        total += q * unit * factor
    return total, "ok"


valuations = {}
for day in DATES:
    rows, excluded, total, carried = {}, [], ZERO, []
    for asset_id in assets:
        value, status = value_asset(asset_id, day)
        if value is None:
            if status != "no_position":
                excluded.append({"assetId": asset_id, "status": "unpriced", "reason": status})
            continue
        rows[asset_id] = {"native": fmt(value), "base": fmt(value), "status": status}
        if status == "stale":
            excluded.append({"assetId": asset_id, "status": "stale"})
        else:
            total += value
            if status == "carried_forward":
                carried.append(asset_id)
    valuations[day] = {"total": total, "assets": rows, "excluded": excluded, "carried": carried}
    derivation["perDate"][iso(day)] = {"total": fmt(total), "assets": {k: v["base"] for k, v in rows.items()}}

# --------------------------------------------------------------------------- TWR
sub_periods, skipped, growth = [], [], ONE
for prev, cur in zip(DATES, DATES[1:]):
    # Flows attach to the first valuation date ≥ their date; those ≤ FIRST are in V₀.
    cf = sum((amt for d, amt in flows if prev < d <= cur), ZERO)
    v_prev, v_cur = valuations[prev]["total"], valuations[cur]["total"]
    denominator = v_prev + cf
    if denominator <= 0:
        skipped.append(f"({iso(prev)}, {iso(cur)}]")
        continue
    r = v_cur / denominator - ONE
    growth *= ONE + r
    sub_periods.append({"from": iso(prev), "to": iso(cur), "start": fmt(v_prev), "flow": fmt(cf), "end": fmt(v_cur), "return": fmt(r)})
twr = growth - ONE if sub_periods else None
derivation["twr"] = {"subPeriods": sub_periods, "skipped": skipped}

# --------------------------------------------------------------------------- MWR (bisection XIRR)
stream = []
v0, v_end = valuations[FIRST]["total"], valuations[AS_OF]["total"]
if v0 > 0:
    stream.append((FIRST, -v0))
for d, amt in flows:
    if FIRST < d <= AS_OF:
        stream.append((d, -amt))
stream.append((AS_OF, v_end))
origin = min(d for d, _ in stream)


def npv(rate: Decimal) -> Decimal:
    return sum((amt * (ONE + rate) ** (-D((d - origin).days) / D(365)) for d, amt in stream), ZERO)


mwr = None
if any(a < 0 for _, a in stream) and any(a > 0 for _, a in stream):
    lo, hi = D("-0.999999"), D("10")
    f_lo = npv(lo)
    if (f_lo < 0) != (npv(hi) < 0):
        for _ in range(400):
            mid = (lo + hi) / 2
            if (npv(mid) < 0) == (f_lo < 0):
                lo, f_lo = mid, npv(mid)
            else:
                hi = mid
        mwr = (lo + hi) / 2
derivation["mwr"] = {
    "stream": [{"date": iso(d), "amount": fmt(a), "years": fmt(D((d - origin).days) / D(365))} for d, a in stream],
    "npvAtSolution": fmt(npv(mwr)) if mwr is not None else None,
}

# --------------------------------------------------------------------------- contribution
denominator = v0 + sum((amt for d, amt in flows if FIRST < d <= AS_OF), ZERO)
contrib, contrib_total = {}, ZERO
for asset_id in assets:
    start_row = valuations[FIRST]["assets"].get(asset_id)
    end_row = valuations[AS_OF]["assets"].get(asset_id)
    if (start_row and start_row["status"] == "stale") or (end_row and end_row["status"] == "stale"):
        contrib[asset_id] = None
        continue
    v_start = D(start_row["base"]) if start_row else ZERO
    v_finish = D(end_row["base"]) if end_row else ZERO
    gain = v_finish - v_start - net_invested(asset_id, FIRST, AS_OF)
    c = gain / denominator
    contrib[asset_id] = fmt(c)
    contrib_total += c
    derivation.setdefault("contribution", {})[asset_id] = {"start": fmt(v_start), "end": fmt(v_finish), "netInvested": fmt(net_invested(asset_id, FIRST, AS_OF)), "gain": fmt(gain)}
derivation["contribution"]["denominator"] = fmt(denominator)

# --------------------------------------------------------------------------- output
expected = {
    "$comment": (
        "Hand-derived by derive_expected.py (standard-library decimal, prec 50; ANBIMA closures as a "
        "literal list; bisection XIRR). Kernel output must match to 1e-8. Never edited to fit lib/calc."
    ),
    "asOf": iso(AS_OF),
    "valuation": {
        "total": fmt(valuations[AS_OF]["total"]),
        "assets": valuations[AS_OF]["assets"],
        "excluded": valuations[AS_OF]["excluded"],
    },
    "valuations": {iso(d): fmt(v["total"]) for d, v in valuations.items()},
    "carriedForward": {iso(d): v["carried"] for d, v in valuations.items() if v["carried"]},
    "twr": fmt(twr) if twr is not None else None,
    "mwr": fmt(mwr) if mwr is not None else None,
    "contribution": {"assets": contrib, "total": fmt(contrib_total)},
    "$derivation": derivation,
}
EXPECTED.write_text(json.dumps(expected, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {EXPECTED.relative_to(HERE.parent.parent.parent)}")
print(f"  total {expected['valuation']['total']}  twr {expected['twr']}  mwr {expected['mwr']}")
