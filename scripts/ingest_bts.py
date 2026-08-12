#!/usr/bin/env python3
"""Download and normalize FAA + BTS extracts into data/normalized/dataset.json.

OTP and T-100 use a multi-month window starting at 2025-01 through the latest
publicly available month for each table (publication lag differs). Metrics are
aggregated across that window into a single onTime/traffic snapshot per airport.
"""

from __future__ import annotations

import csv
import io
import json
import os
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Iterable

import openpyxl
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
NORM = ROOT / "data" / "normalized"
LONG_HAUL_MILES = 1500
NEW_ENGLAND = {"CT", "ME", "MA", "NH", "RI", "VT"}
REGION_BY_STATE = {
    "CT": "New England",
    "ME": "New England",
    "MA": "New England",
    "NH": "New England",
    "RI": "New England",
    "VT": "New England",
    "NY": "Northeast",
    "NJ": "Northeast",
    "PA": "Northeast",
    "DE": "Northeast",
    "MD": "Northeast",
    "DC": "Northeast",
    "CA": "West",
    "OR": "West",
    "WA": "West",
    "NV": "West",
    "AZ": "West",
    "HI": "West",
    "AK": "Alaska",
    "TX": "South",
    "FL": "South",
    "GA": "South",
    "NC": "South",
    "SC": "South",
    "VA": "South",
    "TN": "South",
    "AL": "South",
    "MS": "South",
    "LA": "South",
    "AR": "South",
    "OK": "South",
    "KY": "South",
    "WV": "South",
    "IL": "Midwest",
    "OH": "Midwest",
    "MI": "Midwest",
    "IN": "Midwest",
    "WI": "Midwest",
    "MN": "Midwest",
    "IA": "Midwest",
    "MO": "Midwest",
    "ND": "Midwest",
    "SD": "Midwest",
    "NE": "Midwest",
    "KS": "Midwest",
    "CO": "Mountain",
    "UT": "Mountain",
    "NM": "Mountain",
    "MT": "Mountain",
    "ID": "Mountain",
    "WY": "Mountain",
}
FOCUS = {
    "BOS",
    "PVD",
    "MHT",
    "BTV",
    "BGR",
    "PWM",
    "BDL",
    "LAX",
    "SNA",
    "SFO",
    "ANC",
    "JFK",
    "EWR",
    "LGA",
}

# Window starts at full calendar 2025; end months are the latest verified public extracts.
# OTP PREZIP through 2026-06; T-100 U.S. Carriers form download through 2026-04 (Aug 2026).
WINDOW_START_YEAR = int(os.environ.get("BTS_WINDOW_START_YEAR", "2025"))
WINDOW_START_MONTH = int(os.environ.get("BTS_WINDOW_START_MONTH", "1"))
DEFAULT_OTP_END_YEAR = int(os.environ.get("BTS_OTP_YEAR", "2026"))
DEFAULT_OTP_END_MONTH = int(os.environ.get("BTS_OTP_MONTH", "6"))
DEFAULT_T100_END_YEAR = int(os.environ.get("BTS_T100_YEAR", "2026"))
DEFAULT_T100_END_MONTH = int(os.environ.get("BTS_T100_MONTH", "4"))
# Proceed if at least this many months land successfully (full CY2025 = 12).
MIN_MONTHS_OK = int(os.environ.get("BTS_MIN_MONTHS", "12"))


def session() -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": "Mozilla/5.0 (compatible; AirportInvestmentAgent/1.0)",
            "Accept-Language": "en-US,en;q=0.9",
        }
    )
    return s


def period_label(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


def range_label(start: tuple[int, int], end: tuple[int, int]) -> str:
    return f"{period_label(*start)}..{period_label(*end)}"


def iter_months(
    start_year: int, start_month: int, end_year: int, end_month: int
) -> Iterable[tuple[int, int]]:
    y, m = start_year, start_month
    while (y, m) <= (end_year, end_month):
        yield y, m
        m += 1
        if m > 12:
            m = 1
            y += 1


def download_faa(s: requests.Session) -> Path:
    RAW.mkdir(parents=True, exist_ok=True)
    url = "https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger/arp-cy2024-commercial-service-enplanements.xlsx"
    path = RAW / "cy2024-commercial-service-enplanements.xlsx"
    resp = s.get(url, timeout=120)
    resp.raise_for_status()
    path.write_bytes(resp.content)
    return path


def parse_viewstate(html: str):
    soup = BeautifulSoup(html, "lxml")

    def val(name: str) -> str:
        el = soup.find("input", {"name": name})
        return el["value"] if el and el.has_attr("value") else ""

    return soup, val("__VIEWSTATE"), val("__VIEWSTATEGENERATOR"), val("__EVENTVALIDATION")


def download_otp_prezip(s: requests.Session, year: int, month: int, out: Path) -> Path:
    """Prefer BTS PREZIP mirrors when available (faster than the ASP download form)."""
    url = (
        "https://transtats.bts.gov/PREZIP/"
        f"On_Time_Reporting_Carrier_On_Time_Performance_1987_present_{year}_{month}.zip"
    )
    print(f"Downloading OTP PREZIP {period_label(year, month)}...")
    s.get("https://www.transtats.bts.gov/", timeout=60)
    resp = s.get(url, timeout=300)
    resp.raise_for_status()
    if resp.content[:2] != b"PK":
        raise RuntimeError(f"OTP PREZIP not available for {year}-{month}: {url}")
    out.write_bytes(resp.content)
    return out


def download_transtats_zip(
    s: requests.Session, url: str, year: str, period: str, out: Path
) -> Path:
    r = s.get(url, timeout=60)
    r.raise_for_status()
    soup, vs, vg, ev = parse_viewstate(r.text)
    r2 = s.post(
        url,
        data={
            "__EVENTTARGET": "cboYear",
            "__EVENTARGUMENT": "",
            "__LASTFOCUS": "",
            "__VIEWSTATE": vs,
            "__VIEWSTATEGENERATOR": vg,
            "__EVENTVALIDATION": ev,
            "txtSearch": "",
            "cboGeography": "All",
            "cboYear": year,
            "cboPeriod": period,
        },
        timeout=60,
    )
    r2.raise_for_status()
    _, vs, vg, ev = parse_viewstate(r2.text)
    resp = s.post(
        url,
        data={
            "__EVENTTARGET": "",
            "__EVENTARGUMENT": "",
            "__LASTFOCUS": "",
            "__VIEWSTATE": vs,
            "__VIEWSTATEGENERATOR": vg,
            "__EVENTVALIDATION": ev,
            "txtSearch": "",
            "btnDownload": "Download",
            "cboGeography": "All",
            "cboYear": year,
            "cboPeriod": period,
            "chkDownloadZip": "on",
            "chkAllVars": "on",
        },
        timeout=300,
    )
    resp.raise_for_status()
    if resp.content[:2] != b"PK":
        raise RuntimeError(
            f"Expected zip from {url} for {year}-{period}, got {resp.headers.get('content-type')}"
        )
    out.write_bytes(resp.content)
    return out


def build_airports(faa_path: Path):
    wb = openpyxl.load_workbook(faa_path, data_only=True)
    rows = list(wb.active.iter_rows(values_only=True))[1:]
    airports = []
    for r in rows:
        if not r or r[3] is None:
            continue
        code = str(r[3]).strip().upper()
        state = str(r[2]).strip().upper() if r[2] else None
        hub = str(r[7]).strip() if r[7] else None
        keep = (state in NEW_ENGLAND) or (code in FOCUS) or (hub in {"L", "M"})
        if not keep:
            continue
        chg = r[10]
        airports.append(
            {
                "iata": code,
                "name": str(r[5]).strip() if r[5] else code,
                "city": str(r[4]).strip() if r[4] else None,
                "state": state,
                "region": REGION_BY_STATE.get(state, "Other") if state else "Other",
                "hub": hub,
                "serviceLevel": str(r[6]).strip() if r[6] else None,
                "enplanementsCy2024": int(r[8]) if r[8] is not None else None,
                "enplanementsCy2023": int(r[9]) if r[9] is not None else None,
                "enplanementGrowthPct": float(chg) * 100 if isinstance(chg, (int, float)) else None,
                "faaRankCy2024": int(r[0]) if r[0] is not None else None,
            }
        )
    return airports


def _new_otp_bucket():
    return {
        "flights": 0,
        "cancelled": 0,
        "depDelaySum": 0.0,
        "depDelayN": 0,
        "depDel15": 0,
        "arrDel15": 0,
        "arrDelaySum": 0.0,
        "arrDelayN": 0,
        "longHaul": 0,
        "distanceSum": 0.0,
        "distanceN": 0,
    }


def accumulate_otp(zip_path: Path, airport_codes: set[str], agg: dict) -> None:
    with zipfile.ZipFile(zip_path) as z:
        name = next(
            n
            for n in z.namelist()
            if n.lower().endswith(".csv") and "readme" not in n.lower()
        )
        with z.open(name) as f:
            reader = csv.DictReader(
                io.TextIOWrapper(f, encoding="utf-8", errors="replace", newline="")
            )
            for row in reader:
                origin = (row.get("Origin") or "").strip().upper()
                if origin not in airport_codes:
                    continue
                a = agg[origin]
                a["flights"] += 1
                if float(row.get("Cancelled") or 0) >= 1:
                    a["cancelled"] += 1
                for key, sumk, nk in [
                    ("DepDelay", "depDelaySum", "depDelayN"),
                    ("ArrDelay", "arrDelaySum", "arrDelayN"),
                ]:
                    val = row.get(key)
                    if val not in (None, ""):
                        a[sumk] += float(val)
                        a[nk] += 1
                for flag, flagk in [("DepDel15", "depDel15"), ("ArrDel15", "arrDel15")]:
                    fv = row.get(flag)
                    if fv not in (None, "") and float(fv) >= 1:
                        a[flagk] += 1
                dist = row.get("Distance")
                if dist not in (None, ""):
                    d = float(dist)
                    a["distanceSum"] += d
                    a["distanceN"] += 1
                    if d >= LONG_HAUL_MILES:
                        a["longHaul"] += 1


def finalize_otp(agg: dict, period: str) -> dict:
    out = {}
    for code, a in agg.items():
        flights = a["flights"]
        if not flights:
            continue
        out[code] = {
            "period": period,
            "flightCount": flights,
            "cancellationRate": round(a["cancelled"] / flights, 6),
            "depDelay15Rate": round(a["depDel15"] / flights, 6),
            "arrDelay15Rate": round(a["arrDel15"] / flights, 6),
            "avgDepDelayMinutes": round(a["depDelaySum"] / a["depDelayN"], 3)
            if a["depDelayN"]
            else None,
            "avgArrDelayMinutes": round(a["arrDelaySum"] / a["arrDelayN"], 3)
            if a["arrDelayN"]
            else None,
            "longHaulDepartures": a["longHaul"],
            "longHaulDepartureShare": round(a["longHaul"] / flights, 6),
            "avgDistanceMiles": round(a["distanceSum"] / a["distanceN"], 2)
            if a["distanceN"]
            else None,
            "longHaulThresholdMiles": LONG_HAUL_MILES,
        }
    return out


def _new_t100_bucket():
    return {
        "passengers": 0.0,
        "seats": 0.0,
        "depPerformed": 0.0,
        "depScheduled": 0.0,
        "distanceWeighted": 0.0,
        "depForDist": 0.0,
        "longHaulDep": 0.0,
    }


def accumulate_t100(zip_path: Path, airport_codes: set[str], agg: dict) -> None:
    with zipfile.ZipFile(zip_path) as z:
        name = next(n for n in z.namelist() if n.endswith(".csv") and "Document" not in n)
        with z.open(name) as f:
            reader = csv.DictReader(
                io.TextIOWrapper(f, encoding="utf-8", errors="replace", newline="")
            )
            for row in reader:
                origin = (row.get("ORIGIN") or "").strip().upper()
                if origin not in airport_codes:
                    continue
                a = agg[origin]
                pax = float(row.get("PASSENGERS") or 0)
                seats = float(row.get("SEATS") or 0)
                dep = float(row.get("DEPARTURES_PERFORMED") or 0)
                sched = float(row.get("DEPARTURES_SCHEDULED") or 0)
                dist = float(row.get("DISTANCE") or 0)
                a["passengers"] += pax
                a["seats"] += seats
                a["depPerformed"] += dep
                a["depScheduled"] += sched
                if dep > 0 and dist > 0:
                    a["distanceWeighted"] += dist * dep
                    a["depForDist"] += dep
                    if dist >= LONG_HAUL_MILES:
                        a["longHaulDep"] += dep


def finalize_t100(agg: dict, period: str) -> dict:
    out = {}
    for code, a in agg.items():
        dep = a["depPerformed"]
        seats = a["seats"]
        if dep <= 0 and seats <= 0 and a["passengers"] <= 0:
            continue
        out[code] = {
            "period": period,
            "passengers": int(round(a["passengers"])),
            "seats": int(round(seats)),
            "loadFactor": round(a["passengers"] / seats, 6) if seats > 0 else None,
            "departuresPerformed": int(round(dep)),
            "departuresScheduled": int(round(a["depScheduled"])),
            "performanceRatio": round(dep / a["depScheduled"], 6)
            if a["depScheduled"] > 0
            else None,
            "longHaulDepartures": int(round(a["longHaulDep"])),
            "longHaulDepartureShare": round(a["longHaulDep"] / dep, 6) if dep > 0 else None,
            "avgDistanceMiles": round(a["distanceWeighted"] / a["depForDist"], 2)
            if a["depForDist"] > 0
            else None,
            "longHaulThresholdMiles": LONG_HAUL_MILES,
        }
    return out


def ensure_otp_month(
    s: requests.Session, year: int, month: int
) -> Path | None:
    out = RAW / f"otp_{year}_{month:02d}.zip"
    if out.exists() and out.stat().st_size > 1000:
        print(f"Reusing cached {out.name}")
        return out
    try:
        download_otp_prezip(s, year, month, out)
        return out
    except Exception as exc:  # noqa: BLE001 - continue window with partial months
        print(f"WARNING: OTP {period_label(year, month)} failed: {exc}")
        if out.exists():
            out.unlink(missing_ok=True)
        return None


def ensure_t100_month(
    s: requests.Session, url: str, year: int, month: int
) -> Path | None:
    out = RAW / f"t100_{year}_{month:02d}.zip"
    if out.exists() and out.stat().st_size > 1000:
        print(f"Reusing cached {out.name}")
        return out
    try:
        print(f"Downloading BTS T-100 {period_label(year, month)}...")
        download_transtats_zip(s, url, str(year), str(month), out)
        return out
    except Exception as exc:  # noqa: BLE001
        print(f"WARNING: T-100 {period_label(year, month)} failed: {exc}")
        if out.exists():
            out.unlink(missing_ok=True)
        return None


def main() -> None:
    start = (WINDOW_START_YEAR, WINDOW_START_MONTH)
    otp_end = (DEFAULT_OTP_END_YEAR, DEFAULT_OTP_END_MONTH)
    t100_end = (DEFAULT_T100_END_YEAR, DEFAULT_T100_END_MONTH)
    otp_period = range_label(start, otp_end)
    t100_period = range_label(start, t100_end)

    s = session()
    RAW.mkdir(parents=True, exist_ok=True)
    print("Downloading FAA enplanements (latest published CY2024 file)...")
    faa_path = download_faa(s)
    airports = build_airports(faa_path)
    codes = {a["iata"] for a in airports}
    print(f"Airports kept: {len(airports)}")

    otp_url = "https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FGJ&QO_fu146_anzr=b0-gvzr"
    t100_url = "https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FIM&QO_fu146_anzr=Nv4%20Pn44vr45"

    otp_agg: dict = defaultdict(_new_otp_bucket)
    otp_ok: list[str] = []
    otp_missing: list[str] = []
    for year, month in iter_months(*start, *otp_end):
        path = ensure_otp_month(s, year, month)
        label = period_label(year, month)
        if path is None:
            otp_missing.append(label)
            continue
        accumulate_otp(path, codes, otp_agg)
        otp_ok.append(label)
    if len(otp_ok) < MIN_MONTHS_OK:
        raise RuntimeError(
            f"OTP window too thin: got {len(otp_ok)} months (need >= {MIN_MONTHS_OK}). "
            f"ok={otp_ok} missing={otp_missing}"
        )
    otp = finalize_otp(otp_agg, otp_period)

    t100_agg: dict = defaultdict(_new_t100_bucket)
    t100_ok: list[str] = []
    t100_missing: list[str] = []
    for year, month in iter_months(*start, *t100_end):
        path = ensure_t100_month(s, t100_url, year, month)
        label = period_label(year, month)
        if path is None:
            t100_missing.append(label)
            continue
        accumulate_t100(path, codes, t100_agg)
        t100_ok.append(label)
    if len(t100_ok) < MIN_MONTHS_OK:
        raise RuntimeError(
            f"T-100 window too thin: got {len(t100_ok)} months (need >= {MIN_MONTHS_OK}). "
            f"ok={t100_ok} missing={t100_missing}"
        )
    t100 = finalize_t100(t100_agg, t100_period)

    NORM.mkdir(parents=True, exist_ok=True)
    merged = []
    for a in airports:
        merged.append({**a, "traffic": t100.get(a["iata"]), "onTime": otp.get(a["iata"])})

    dataset = {
        "meta": {
            "sources": [
                {
                    "name": "FAA CY2024 Commercial Service Enplanements",
                    "url": "https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger",
                    "period": "CY2023-CY2024",
                    "notes": "Latest published FAA annual commercial-service enplanements file at ingest time (CY2025 not published yet).",
                },
                {
                    "name": "BTS Airline On-Time Performance (Reporting Carriers)",
                    "url": otp_url,
                    "period": otp_period,
                    "notes": (
                        f"Multi-month OTP window aggregated by origin "
                        f"({len(otp_ok)} months: {otp_ok[0]}..{otp_ok[-1]}"
                        + (f"; missing {otp_missing}" if otp_missing else "")
                        + ")."
                    ),
                    "monthsIncluded": otp_ok,
                    "monthsMissing": otp_missing,
                },
                {
                    "name": "BTS T-100 Domestic Segment (U.S. Carriers)",
                    "url": t100_url,
                    "period": t100_period,
                    "notes": (
                        f"Multi-month T-100 window aggregated by origin "
                        f"({len(t100_ok)} months: {t100_ok[0]}..{t100_ok[-1]}"
                        + (f"; missing {t100_missing}" if t100_missing else "")
                        + ")."
                    ),
                    "monthsIncluded": t100_ok,
                    "monthsMissing": t100_missing,
                },
            ],
            "generatedAt": date.today().isoformat(),
            "coverageNotes": (
                f"FAA enplanements are annual CY2023/CY2024. "
                f"OTP aggregates {otp_period} ({len(otp_ok)} months). "
                f"T-100 aggregates {t100_period} ({len(t100_ok)} months). "
                "Window starts at 2025-01 (full calendar 2025) through each table's latest public month; "
                "publication lag means end months may differ across tables."
            ),
        },
        "config": {
            "longHaulThresholdMiles": LONG_HAUL_MILES,
            "scoringWeights": {
                "capacityPressure": 0.30,
                "passengerGrowth": 0.25,
                "congestionPressure": 0.20,
                "marketScale": 0.15,
                "routeOpportunity": 0.10,
            },
        },
        "airports": merged,
    }
    out = NORM / "dataset.json"
    out.write_text(json.dumps(dataset, indent=2))
    with_otp = sum(1 for a in merged if a.get("onTime"))
    with_t100 = sum(1 for a in merged if a.get("traffic"))
    print(f"Wrote {out} ({len(merged)} airports, OTP={with_otp}, T100={with_t100})")
    print(f"Periods: FAA=CY2023-CY2024 OTP={otp_period} ({len(otp_ok)} mo) T100={t100_period} ({len(t100_ok)} mo)")
    if otp_missing:
        print(f"OTP missing months: {otp_missing}")
    if t100_missing:
        print(f"T-100 missing months: {t100_missing}")


if __name__ == "__main__":
    main()
