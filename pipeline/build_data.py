"""올팍예보 데이터 파이프라인.

data/raw (한국체육산업개발 공공데이터 CSV) + data/ext (공연 일정, 날씨)를 읽어
웹 서비스가 쓰는 site/data/app.json 과 분석 요약 docs/findings.json 을 만든다.

사용: python pipeline/build_data.py [기준일 YYYY-MM-DD]
"""
from __future__ import annotations

import datetime as dt
import html
import json
import pathlib
import re
import sys

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW, EXT = ROOT / "data" / "raw", ROOT / "data" / "ext"
TODAY = pd.Timestamp(sys.argv[1]) if len(sys.argv) > 1 else pd.Timestamp(dt.date.today())
GRADES = ((0, 0.15, "여유"), (0.15, 0.45, "보통"), (0.45, 1.01, "혼잡"))
CAPACITY = 2800  # FAQ 데이터(15089962): "2800여대의 차량이 주차할 수 있는..."
# 장애인 전용 주차구획은 일반 차량이 쓸 수 없으므로 여유를 따질 때 뺀다.
# 실제 면수는 공개 데이터에 없어, 법정 설치 비율(주차대수의 2~4%, 조례로 정함)의 중간값 3%로 추정한다.
ACCESSIBLE_RATIO = 0.03
CAPACITY_GENERAL = round(CAPACITY * (1 - ACCESSIBLE_RATIO))
FEE_PER_10MIN = 600  # FAQ 데이터: 일반 승용차 10분당 600원
DOW_KO = "월화수목금토일"


def read_csv(pk: str) -> pd.DataFrame:
    return pd.read_csv(RAW / f"{pk}.csv", encoding="cp949", low_memory=False)


def r(x, n=0):
    v = round(float(x), n)
    return int(v) if n == 0 else v


# ---------------------------------------------------------------------------
# 0. 공휴일 (프로토타입: 내장 목록 / 운영: 한국천문연구원 특일 정보 API)
# ---------------------------------------------------------------------------
HOLIDAYS = {
    "2024-07-17": None,  # 제헌절은 공휴일 아님(표시만 제외)
    "2025-01-01": "신정", "2025-01-27": "임시공휴일", "2025-01-28": "설 연휴", "2025-01-29": "설날",
    "2025-01-30": "설 연휴", "2025-03-01": "삼일절", "2025-03-03": "대체공휴일", "2025-05-05": "어린이날·부처님오신날",
    "2025-05-06": "대체공휴일", "2025-06-03": "대통령선거일", "2025-06-06": "현충일", "2025-08-15": "광복절",
    "2025-10-03": "개천절", "2025-10-05": "추석 연휴", "2025-10-06": "추석", "2025-10-07": "추석 연휴",
    "2025-10-08": "대체공휴일", "2025-10-09": "한글날", "2025-12-25": "성탄절",
    "2026-01-01": "신정", "2026-02-16": "설 연휴", "2026-02-17": "설날", "2026-02-18": "설 연휴",
    "2026-03-01": "삼일절", "2026-03-02": "대체공휴일", "2026-05-05": "어린이날", "2026-05-24": "부처님오신날",
    "2026-05-25": "대체공휴일", "2026-06-03": "지방선거일", "2026-06-06": "현충일", "2026-08-15": "광복절",
    "2026-08-17": "대체공휴일", "2026-09-24": "추석 연휴", "2026-09-25": "추석", "2026-09-26": "추석 연휴",
    "2026-10-03": "개천절", "2026-10-05": "대체공휴일", "2026-10-09": "한글날", "2026-12-25": "성탄절",
    "2027-01-01": "신정",
}
HOLIDAYS = {k: v for k, v in HOLIDAYS.items() if v}

# ---------------------------------------------------------------------------
# 1. 공연 일정 정규화
# ---------------------------------------------------------------------------
TIER_LABEL = {
    "DOME": "KSPO DOME", "ARENA": "핸드볼경기장(티켓링크 라이브 아레나)", "HALL": "올림픽홀",
    "OUTDOOR": "88잔디마당·수변무대(야외)", "SMALL": "우리금융아트홀·뮤즈라이브 등",
}


def venue_tiers(plc: str) -> list[str]:
    s = plc.upper().replace(" ", "")
    t = []
    if "DOME" in s or "체조" in s:
        t.append("DOME")
    if "핸드볼" in s or "라이브아레나" in s:
        t.append("ARENA")
    if "올림픽홀" in s:
        t.append("HALL")
    if "잔디마당" in s or "수변무대" in s:
        t.append("OUTDOOR")
    if "우리금융" in s or "뮤즈" in s or "아트홀" in s or "역도" in s:
        t.append("SMALL")
    return t or ["SMALL"]


EN_DOW = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6}
TOKEN = re.compile(
    r"\((?P<p>[월화수목금토일])\)"
    r"|(?P<y>[월화수목금토일])요일"
    r"|(?<![가-힣\d])(?P<b>[월화수목금토일]{1,5})(?=\s*(?:오전|오후|낮|저녁|\d))"
    r"|(?P<e>MON|TUE|WED|THU|FRI|SAT|SUN)"
    r"|(?P<t>(?P<ap1>오전|오후|낮|저녁|AM|PM)?\s*(?P<h>\d{1,2})\s*(?::|시)\s*(?P<m>\d{1,2})?\s*분?\s*(?P<ap2>AM|PM)?)"
    r"|(?P<t2>(?P<h2>\d{1,2})\s*(?P<ap3>AM|PM))"
)


def parse_times(tm: str) -> tuple[dict[int, list[float]], list[float]]:
    """자유 서술형 공연시간 문자열 → {요일: [시작시각,...]}, 요일 미지정 시각 목록."""
    s = html.unescape(tm or "").upper().replace("：", ":")
    by_dow: dict[int, list[float]] = {}
    default: list[float] = []
    cur: list[int] = []
    had_time = False
    for m in TOKEN.finditer(s):
        days = None
        if m.group("p"):
            days = [DOW_KO.index(m.group("p"))]
        elif m.group("y"):
            days = [DOW_KO.index(m.group("y"))]
        elif m.group("b"):
            days = [DOW_KO.index(c) for c in m.group("b")]
        elif m.group("e"):
            days = [EN_DOW[m.group("e")]]
        if days is not None:
            if had_time:
                cur, had_time = [], False
            cur += days
            continue
        if m.group("t"):
            h, mi = int(m.group("h")), int(m.group("m") or 0)
            ap = m.group("ap1") or m.group("ap2")
        else:
            h, mi, ap = int(m.group("h2")), 0, m.group("ap3")
        if h > 24 or mi > 59:
            continue
        if ap in ("오후", "PM", "저녁") and h < 12:
            h += 12
        elif ap is None and h < 10:
            h += 12  # '7:00' 처럼 오전/오후 표기 없는 한 자릿수 시각은 저녁 공연으로 해석
        val = h + mi / 60
        if not 9 <= val <= 23.5:
            continue
        had_time = True
        if cur:
            for d in cur:
                by_dow.setdefault(d, []).append(val)
        else:
            default.append(val)
    return by_dow, default


def load_events() -> pd.DataFrame:
    raw = json.loads((EXT / "events.json").read_text(encoding="utf-8"))
    rows = []
    for it in raw:
        title = html.unescape(it["title"]).strip()
        b, e = pd.Timestamp(it["beginDt"]), pd.Timestamp(it["endDt"])
        by_dow, default = parse_times(it.get("tm") or "")
        dur = None
        m = re.search(r"(\d{2,3})\s*분", it.get("ndTm") or "")
        if m and 30 <= int(m.group(1)) <= 600:
            dur = int(m.group(1))
        rows.append(
            dict(id=int(it["evtSeq"]), title=title, venue=(it.get("plc") or "").strip(), tiers=venue_tiers(it.get("plc") or ""),
                 begin=b, end=e, days=(e - b).days + 1, by_dow=by_dow, default=default, dur=dur,
                 tm=html.unescape(it.get("tm") or "").strip(), img=it.get("fileNm") or "", reg=(it.get("regDate") or "")[:10],
                 link=(it.get("evtLink") or "").strip())
        )
    return pd.DataFrame(rows).drop_duplicates("id")


def event_days(ev: pd.DataFrame) -> pd.DataFrame:
    """공연을 날짜 단위로 전개. 장기 공연(상설 뮤지컬 등)은 요일 표기가 있는 날만 공연일로 본다."""
    out = []
    for _, e in ev.iterrows():
        for d in pd.date_range(e["begin"], e["end"]):
            starts = e["by_dow"].get(d.dayofweek)
            known = True
            if starts is None:
                if e["by_dow"] and e["days"] > 3:
                    continue  # 요일별 시간표가 있는데 해당 요일이 없으면 공연 없는 날
                starts = e["default"] or [t for v in e["by_dow"].values() for t in v]
                known = bool(e["default"])
            if not starts:
                starts, known = [18.0], False
            out.append(dict(date=d, id=e["id"], tiers=e["tiers"], starts=sorted(set(starts)), known=known, dur=e["dur"]))
    return pd.DataFrame(out)


# ---------------------------------------------------------------------------
# 2. 입출차 원시 로그(2024-07) 분석
# ---------------------------------------------------------------------------
def analyze_parking(evd: pd.DataFrame) -> tuple[dict, dict]:
    p = read_csv("15138735")
    p["in"] = pd.to_datetime(p["입차일시"])
    p["out"] = pd.to_datetime(p["출차일시"])
    p["dw"] = (p["out"] - p["in"]).dt.total_seconds() / 60
    p["d"] = p["in"].dt.normalize()
    n = len(p)

    # 체류시간 유형
    seg_def = [("회차·승하차", 0, 10), ("단기 용무", 10, 60), ("운동·산책", 60, 180), ("공연·장시간", 180, 720), ("장기 주차", 720, 1e9)]
    segs = []
    for name, lo, hi in seg_def:
        g = p[(p["dw"] > lo if lo else p["dw"] >= 0) & (p["dw"] <= hi)]
        segs.append(dict(name=name, range=f"{lo}~{int(hi) if hi < 1e8 else '∞'}분", n=len(g), share=r(len(g) / n * 100, 1)))
    hist_edges = [0, 5, 10, 20, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 720]
    hist = np.histogram(p["dw"].clip(upper=719.9), bins=hist_edges)[0].tolist()

    # 5분 단위 재차 대수(입차 누계 - 출차 누계)
    idx = pd.date_range("2024-07-01", "2024-07-31 23:55", freq="5min")
    occ = pd.Series(
        np.searchsorted(np.sort(p["in"].values), idx.values, side="right")
        - np.searchsorted(np.sort(p["out"].values), idx.values, side="right"),
        index=idx,
    )
    in5 = p.set_index("in").resample("5min").size().reindex(idx, fill_value=0)
    out5 = p[p["out"] <= idx[-1]].set_index("out").resample("5min").size().reindex(idx, fill_value=0)

    july = evd[(evd["date"] >= "2024-07-01") & (evd["date"] <= "2024-07-31")]
    dome_days = {d: g for d, g in july[july["tiers"].apply(lambda t: "DOME" in t)].groupby("date")}
    big_days = set(july[july["tiers"].apply(lambda t: bool({"DOME", "ARENA", "HALL", "OUTDOOR"} & set(t)))]["date"])

    daily = []
    for d, g in p.groupby("d"):
        o = occ[d : d + pd.Timedelta("23:55:00")]
        daily.append(
            dict(date=d.strftime("%Y-%m-%d"), dow=DOW_KO[d.dayofweek], entries=len(g), peak=int(o.max()),
                 peakTime=o.idxmax().strftime("%H:%M"), short=int((g["dw"] <= 10).sum()), long3h=int((g["dw"] >= 180).sum()),
                 events=sorted(set(july[july["date"] == d]["id"].tolist())))
        )
    dd = pd.DataFrame(daily)
    dd["date_ts"] = pd.to_datetime(dd["date"])
    dd["weekend"] = dd["date_ts"].dt.dayofweek >= 5
    dd["big"] = dd["date_ts"].isin(big_days)
    dd["dome"] = dd["date_ts"].isin(dome_days.keys())

    # 시간대별 평균 재차(공연 없는 평일/주말)
    def hourly(mask_days) -> list[int]:
        sel = occ[occ.index.normalize().isin(mask_days)]
        return [r(v) for v in sel.groupby(sel.index.hour).mean().reindex(range(24), fill_value=0)]

    base_wd_days = dd[(~dd["weekend"]) & (~dd["big"])]["date_ts"]
    base_we_days = dd[(dd["weekend"]) & (~dd["big"])]["date_ts"]
    if len(base_we_days) < 2:  # 표본 부족 시 DOME 공연만 없는 주말로 완화
        base_we_days = dd[(dd["weekend"]) & (~dd["dome"])]["date_ts"]
    prof = dict(weekday=hourly(base_wd_days), weekend=hourly(base_we_days))
    prof["n_weekday"], prof["n_weekend"] = len(base_wd_days), len(base_we_days)

    # 30분 단위 기준선(요일 유형별) → 공연일 초과분 계산용
    occ30 = occ.resample("30min").mean()
    tod = occ30.index.hour * 2 + occ30.index.minute // 30
    base30 = {
        False: occ30[occ30.index.normalize().isin(base_wd_days)].groupby(tod[occ30.index.normalize().isin(base_wd_days)]).mean(),
        True: occ30[occ30.index.normalize().isin(base_we_days)].groupby(tod[occ30.index.normalize().isin(base_we_days)]).mean(),
    }

    # KSPO DOME 공연일: 공연 시작시각 기준 정렬(이벤트 스터디)
    REL = np.arange(-12, 11)  # -6h ~ +5h, 30분 단위
    dome_rows = []
    for d, g in dome_days.items():
        start = max(s for ss in g["starts"] for s in ss)  # 당일 마지막(저녁) 회차 기준
        row = dd[dd["date_ts"] == d].iloc[0]
        we = bool(d.dayofweek >= 5)
        base_set = dd[dd["date_ts"].isin(base_we_days if we else base_wd_days)]
        base_short = base_set["short"].mean()
        base_peak = base_set["peak"].mean()
        s_idx = int(start * 2)
        excess = []
        for k in REL:
            t = d + pd.Timedelta(minutes=30 * int(s_idx + k))
            excess.append(float(occ30.get(t, np.nan) - base30[we].get((s_idx + k) % 48, np.nan)) if 0 <= s_idx + k < 48 else np.nan)
        # 공연 주차 추정 차량: 시작 6시간 전~시작 30분 후 입차 & 3시간 이상 체류
        day = p[p["d"] == d]
        st = d + pd.Timedelta(hours=start)
        cp = day[(day["in"] >= st - pd.Timedelta(hours=6)) & (day["in"] <= st + pd.Timedelta(minutes=30)) & (day["dw"] >= 180)]
        arr = ((st - cp["in"]).dt.total_seconds() / 60).values
        dep = ((cp["out"] - st).dt.total_seconds() / 60).values
        o5 = out5[d + pd.Timedelta(hours=start + 2) : d + pd.Timedelta("23:55:00")]
        roll = o5.rolling(6).sum()
        cp_out = cp[cp["out"] >= st + pd.Timedelta(hours=2)].set_index("out").resample("5min").size().rolling(6).sum()
        exit_share30 = r(cp_out.max() / len(cp) * 100) if len(cp) > 30 else None
        titles = sorted(set(g["id"].tolist()))
        dome_rows.append(
            dict(date=d.strftime("%Y-%m-%d"), dow=DOW_KO[d.dayofweek], start=start, ids=titles, peak=int(row["peak"]),
                 peakVsBase=r(row["peak"] / base_peak, 2), short=int(row["short"]), shortVsBase=r(row["short"] / base_short, 2),
                 shortExcess=r(row["short"] - base_short), peakExcess=r(row["peak"] - base_peak), excess=[None if np.isnan(v) else r(v) for v in excess],
                 concertCars=len(cp), arrP=[r(np.percentile(arr, q)) for q in (90, 75, 50, 25, 10)] if len(cp) > 30 else None,
                 depP=[r(np.percentile(dep, q)) for q in (10, 25, 50, 75, 90)] if len(cp) > 30 else None,
                 exitPeak5=int(o5.max()), exitPeakTime=o5.idxmax().strftime("%H:%M"),
                 exitPeak30=int(roll.max()), exitPeak30End=roll.idxmax().strftime("%H:%M"), exitShare30=exit_share30,
                 medianFee=r(np.ceil(np.median(cp["dw"]) / 10) * FEE_PER_10MIN) if len(cp) > 30 else None,
                 medianDwell=r(np.median(cp["dw"])) if len(cp) > 30 else None)
        )
    dome_df = pd.DataFrame(dome_rows)
    # 유형 분류: 재차 피크가 기준선의 1.5배 이상이면 '주차형', 아니면 '승하차(드롭오프)형'
    dome_df["type"] = np.where(dome_df["peakVsBase"] >= 1.5, "parking", "dropoff")
    tmpl = {}
    for typ, g in dome_df.groupby("type"):
        arrs = np.array([[np.nan if v is None else v for v in e] for e in g["excess"]], dtype=float)
        tmpl[typ] = [r(v) for v in np.nanmean(arrs, axis=0)]

    # 평일 새벽 운동 리듬
    wd = p[p["in"].dt.dayofweek < 5]
    dawn = wd[(wd["in"].dt.hour >= 5) & (wd["in"].dt.hour < 7)]
    n_wd = wd["d"].nunique()

    hourly_in = p.groupby([p["in"].dt.dayofweek >= 5, p["in"].dt.hour]).size().unstack(0, fill_value=0)
    n_we = p[p["in"].dt.dayofweek >= 5]["d"].nunique()

    ins = dict(
        rows=n, period="2024-07-01 ~ 2024-07-31", segments=segs, histEdges=hist_edges, hist=hist,
        medianDwell=r(p["dw"].median()), meanEntries=r(dd["entries"].mean()),
        profile=prof, daily=daily, dome=dome_df.drop(columns=["excess"]).to_dict("records"),
        template=dict(rel=[int(k) * 30 for k in REL], **tmpl),
        hourlyIn=dict(weekday=[r(hourly_in.get(False, pd.Series(dtype=float)).get(h, 0) / n_wd) for h in range(24)],
                      weekend=[r(hourly_in.get(True, pd.Series(dtype=float)).get(h, 0) / n_we) for h in range(24)]),
        dawn=dict(perDay=r(len(dawn) / n_wd), medianDwell=r(dawn["dw"].median()), shortShare=r((dawn["dw"] <= 10).mean() * 100, 1)),
        peakAll=dict(value=int(occ.max()), time=occ.idxmax().strftime("%Y-%m-%d %H:%M"), capShare=r(occ.max() / CAPACITY * 100), capShareGeneral=r(occ.max() / CAPACITY_GENERAL * 100)),
        basePeak=dict(weekday=max(prof["weekday"]), weekend=max(prof["weekend"])),
        capacity=CAPACITY, fee=FEE_PER_10MIN,
    )
    model_bits = dict(profile=prof, template=tmpl, rel=[int(k) * 30 for k in REL])
    return ins, model_bits


# ---------------------------------------------------------------------------
# 3. 주차장 혼잡도 기록(2025-02~) 분석
# ---------------------------------------------------------------------------
def analyze_congestion() -> tuple[dict, pd.DataFrame]:
    c = read_csv("15164156")
    c["date"] = pd.to_datetime(c["등록일"])
    t = c["등록시간"].str.split(":", expand=True).astype(int)
    c["hour"] = t[0]
    fmt_bug = float(((t[1] == c["date"].dt.month) & (t[2] == c["date"].dt.day)).mean())
    c = c.sort_values("일련번호")
    bad = c[c["혼잡도"].isin(["혼잡", "만차"])]

    zones = []
    order = ["P1A", "P1B", "P2", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11"]
    n_days = bad["date"].nunique()
    for z in order:
        g = bad[bad["주차구역"] == z]
        if g.empty:
            continue
        hh = g.groupby("hour").size()
        first = g.groupby("date")["hour"].min()
        zones.append(dict(zone=z, days=int(g["date"].nunique()), dayShare=r(g["date"].nunique() / n_days * 100), full=int((g["혼잡도"] == "만차").sum()),
                          busy=int((g["혼잡도"] == "혼잡").sum()), firstHour=r(first.median(), 1),
                          hours=[int(hh.get(h, 0)) for h in range(8, 22)]))
    # 만차 도미노: 같은 날 처음 기록된 순서(일련번호)의 평균 순위
    ranks: dict[str, list[float]] = {}
    for _, g in bad.groupby("date"):
        seq = g.drop_duplicates("주차구역")["주차구역"].tolist()
        if len(seq) >= 4:
            for i, z in enumerate(seq):
                ranks.setdefault(z, []).append(i / (len(seq) - 1))
    domino = sorted(((z, r(np.mean(v), 2), len(v)) for z, v in ranks.items() if len(v) >= 8), key=lambda x: x[1])
    # 해소 소요: 같은 날 같은 구역 '만차/혼잡' → '원활' (시간 단위)
    rel = []
    for (_, z), g in c.groupby(["date", "주차구역"]):
        b = g[g["혼잡도"].isin(["혼잡", "만차"])]
        ok = g[g["혼잡도"] == "원활"]
        if len(b) and len(ok) and ok["hour"].max() > b["hour"].min():
            rel.append(ok["hour"].max() - b["hour"].min())
    dense = bad[(bad["date"] >= "2025-02-12") & (bad["date"] <= "2026-01-31")]
    ins = dict(
        rows=len(c), period=f"{c['date'].min():%Y-%m-%d} ~ {c['date'].max():%Y-%m-%d}", days=int(c["date"].nunique()),
        levels=c["혼잡도"].value_counts().to_dict(), zones=zones, domino=[dict(zone=z, rank=k, n=m) for z, k, m in domino],
        hourHist=[int(bad.groupby("hour").size().get(h, 0)) for h in range(8, 22)],
        dowHist=[int(dense.drop_duplicates("date")["date"].dt.dayofweek.value_counts().get(i, 0)) for i in range(7)],
        monthHist={f"{k}": int(v) for k, v in dense.drop_duplicates("date").groupby(dense["date"].dt.strftime("%Y-%m")).size().items()},
        relief=dict(n=len(rel), medianHours=r(np.median(rel), 1) if rel else None),
        timeFormatBugShare=r(fmt_bug * 100),
    )
    day = bad.groupby("date").agg(n=("혼잡도", "size"), full=("혼잡도", lambda s: int((s == "만차").sum())), zones=("주차구역", "nunique"))
    return ins, day


# ---------------------------------------------------------------------------
# 4. 일 단위 혼잡 발생 확률 모델(로지스틱 회귀, numpy 구현)
# ---------------------------------------------------------------------------
FEATS = ["토요일", "일요일", "공휴일", "주말·휴일 × 나들이 기온(최고 10~28℃)", "주말·휴일 × 비(5mm 이상)", "대·중형 공연장 공연 수"]
BIG_TIERS = ("DOME", "ARENA", "HALL", "OUTDOOR")


def season_index() -> dict[int, float]:
    m = read_csv("15131671")
    m = m[m["주차장소"] == "올림픽공원"].copy()
    m["mon"] = m["월"].str.replace("월", "").astype(int)
    avg = m.groupby("mon")["주차대수"].mean()
    return (avg / avg.mean()).to_dict()


def tiers_by_day(evd: pd.DataFrame) -> dict:
    out: dict[pd.Timestamp, set] = {}
    for _, e in evd.iterrows():
        out.setdefault(e["date"], set()).update(e["tiers"])
    return out


def feature_frame(dates: pd.DatetimeIndex, evd: pd.DataFrame, wx: dict) -> pd.DataFrame:
    """wx: {'YYYY-MM-DD': (일 강수량 mm, 일 최고기온 ℃)}"""
    tbd = tiers_by_day(evd)
    X = pd.DataFrame(index=dates)
    key = X.index.strftime("%Y-%m-%d")
    hol = key.isin(HOLIDAYS.keys())
    X["토요일"] = ((X.index.dayofweek == 5) & ~hol).astype(float)
    X["일요일"] = ((X.index.dayofweek == 6) & ~hol).astype(float)
    X["공휴일"] = hol.astype(float)
    off = ((X.index.dayofweek >= 5) | hol).astype(float)
    rain = np.array([float((wx.get(k, (0, None))[0] or 0) >= 5) for k in key])
    tmax = np.array([wx.get(k, (0, np.nan))[1] if wx.get(k, (0, None))[1] is not None else np.nan for k in key], dtype=float)
    X[FEATS[3]] = off * ((tmax >= 10) & (tmax <= 28)).astype(float)
    X[FEATS[4]] = off * rain
    X[FEATS[5]] = [float(len(set(BIG_TIERS) & tbd.get(d, set()))) for d in X.index]
    X.attrs["off"], X.attrs["rain"], X.attrs["tmax"] = off, rain, tmax
    return X[FEATS]


def fit_logit(X: np.ndarray, y: np.ndarray, l2: float = 1.0, it: int = 60) -> np.ndarray:
    Xb = np.hstack([np.ones((len(X), 1)), X])
    w = np.zeros(Xb.shape[1])
    reg = np.eye(Xb.shape[1]) * l2
    reg[0, 0] = 0
    for _ in range(it):  # 뉴턴법(IRLS)
        pr = 1 / (1 + np.exp(-Xb @ w))
        W = pr * (1 - pr) + 1e-9
        w += np.linalg.solve(Xb.T @ (Xb * W[:, None]) + reg, Xb.T @ (y - pr) - reg @ w)
    return w


def predict(w: np.ndarray, X: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-(w[0] + X @ w[1:])))


def auc(y: np.ndarray, s: np.ndarray) -> float:
    rk = pd.Series(s).rank().values
    pos = y == 1
    return float((rk[pos].sum() - pos.sum() * (pos.sum() + 1) / 2) / (pos.sum() * (~pos).sum()))


def build_model(day_lab: pd.DataFrame, evd: pd.DataFrame, wx: dict) -> tuple[dict, np.ndarray]:
    dates = pd.date_range("2025-02-12", "2026-01-31")
    X = feature_frame(dates, evd, wx)
    y = pd.Series(dates.isin(day_lab.index), index=dates).astype(float)
    off = X.attrs["off"] > 0
    rainy = X.attrs["rain"] > 0
    nice = X[FEATS[3]].values > 0
    tbd = tiers_by_day(evd)
    dome = np.array(["DOME" in tbd.get(d, set()) for d in dates])
    zones = day_lab["zones"].reindex(dates).fillna(0).values
    mon = pd.DataFrame({"y": y.values[off], "m": dates[off].month}).groupby("m")["y"].agg(["size", "mean"])
    facts = dict(
        offDays=int(off.sum()), offRate=r(y.values[off].mean() * 100), workDays=int((~off).sum()), workRate=r(y.values[~off].mean() * 100, 1),
        domeShareOff=r(dome[off].mean() * 100), rainOff=dict(n=int((off & rainy).sum()), rate=r(y.values[off & rainy].mean() * 100)),
        dryOff=dict(n=int((off & ~rainy).sum()), rate=r(y.values[off & ~rainy].mean() * 100)),
        niceOff=dict(n=int((off & nice).sum()), rate=r(y.values[off & nice].mean() * 100), wide=r((zones[off & nice] >= 6).mean() * 100)),
        coldHotOff=dict(n=int((off & ~nice).sum()), rate=r(y.values[off & ~nice].mean() * 100), wide=r((zones[off & ~nice] >= 6).mean() * 100)),
        offMonthRate=[dict(month=int(m), n=int(v["size"]), rate=r(v["mean"] * 100)) for m, v in mon.iterrows()],
    )
    tr, te = dates <= "2025-09-30", dates > "2025-09-30"
    w_tr = fit_logit(X[tr].values, y[tr].values)
    p_te = predict(w_tr, X[te].values)
    # 비교 기준선: '주말·공휴일 여부'만 아는 경우
    base_cols = ["토요일", "일요일", "공휴일"]
    w_b = fit_logit(X[tr][base_cols].values, y[tr].values)
    p_b = predict(w_b, X[te][base_cols].values)
    # 월 단위 교차검증(해당 월을 빼고 학습 → 그 달 예측)
    cv = np.zeros(len(dates))
    months = dates.to_period("M")
    for mth in months.unique():
        msk = months == mth
        cv[msk] = predict(fit_logit(X[~msk].values, y[~msk].values), X[msk].values)
    w = fit_logit(X.values, y.values)  # 최종: 전체 기간 학습
    yt = y[te].values

    def at(th):
        pred = p_te >= th
        tp, fp, fn = int((pred & (yt == 1)).sum()), int((pred & (yt == 0)).sum()), int((~pred & (yt == 1)).sum())
        return dict(th=th, precision=r(tp / max(tp + fp, 1) * 100), recall=r(tp / max(tp + fn, 1) * 100), tp=tp, fp=fp, fn=fn)

    p_all = pd.Series(cv, index=dates)
    grade_cal = []
    for lo, hi, name in GRADES:
        msk = (p_all >= lo) & (p_all < hi)
        grade_cal.append(dict(grade=name, range=f"{int(lo * 100)}~{min(int(hi * 100), 100)}%", days=int(msk.sum()), actual=r(y[msk].mean() * 100) if msk.sum() else None))
    info = dict(
        facts=facts, aucOffOnly=r(auc(y.values[off], cv[off]), 3),
        period="2025-02-12 ~ 2026-01-31", nDays=len(dates), nPos=int(y.sum()), nTrain=int(tr.sum()), nTest=int(te.sum()), posTest=int(yt.sum()),
        aucTest=r(auc(yt, p_te), 3), aucBaseline=r(auc(yt, p_b), 3), aucCV=r(auc(y.values, cv), 3),
        thresholds=[at(0.4), at(0.5)], features=FEATS, coef=[r(v, 2) for v in w[1:]], intercept=r(w[0], 2),
        oddsRatio=[r(np.exp(v), 1) for v in w[1:]], gradeCalibration=grade_cal,
    )
    return info, w


# ---------------------------------------------------------------------------
# 5. 예보 생성
# ---------------------------------------------------------------------------
def grade_of(p: float) -> str:
    return next(name for lo, hi, name in GRADES if lo <= p < hi)


def build_forecast(ev: pd.DataFrame, evd: pd.DataFrame, w: np.ndarray, wx: dict, wx_src: dict, season: dict, bits: dict) -> list[dict]:
    end = min(evd["date"].max(), TODAY + pd.Timedelta(days=41))
    dates = pd.date_range(TODAY, end)
    X = feature_frame(dates, evd, wx)
    P = predict(w, X.values)
    july_idx = season[7]
    rel = bits["rel"]
    out = []
    for d, pr, (_, xr) in zip(dates, P, X.iterrows()):
        we = d.dayofweek >= 5 or d.strftime("%Y-%m-%d") in HOLIDAYS
        scale = season[d.month] / july_idx
        base = [v * scale for v in bits["profile"]["weekend" if we else "weekday"]]
        todays = evd[evd["date"] == d]
        lo, hi = base[:], base[:]
        shows = []
        for _, e in todays.iterrows():
            info = ev[ev["id"] == e["id"]].iloc[0]
            dur_known = pd.notna(e["dur"])
            dur = float(e["dur"]) if dur_known else 150.0
            for st in e["starts"]:
                shows.append(dict(id=int(e["id"]), start=r(st, 2), end=r(st + dur / 60, 2), durKnown=bool(dur_known), timeKnown=bool(e["known"]), tier=info["tiers"][0]))
            if "DOME" in e["tiers"]:
                st = max(e["starts"])
                for h in range(24):
                    k = (h - st) * 60
                    lo[h] += max(0.0, float(np.interp(k, rel, bits["template"].get("dropoff", [0] * len(rel)), left=0, right=0)))
                    hi[h] += max(0.0, float(np.interp(k, rel, bits["template"].get("parking", [0] * len(rel)), left=0, right=0)))
        out.append(
            dict(date=d.strftime("%Y-%m-%d"), dow=DOW_KO[d.dayofweek], holiday=HOLIDAYS.get(d.strftime("%Y-%m-%d")), p=r(pr * 100),
                 grade=grade_of(pr), lo=[r(v) for v in lo], hi=[r(v) for v in hi], shows=shows,
                 rain=wx.get(d.strftime("%Y-%m-%d"), (None, None))[0], tmax=wx.get(d.strftime("%Y-%m-%d"), (None, None))[1],
                 wxSrc=wx_src.get(d.strftime("%Y-%m-%d"), "평년"),
                 factors=[n_ for n_, f in (("토요일", FEATS[0]), ("일요일", FEATS[1]), ("공휴일", FEATS[2]), ("나들이하기 좋은 기온", FEATS[3]), ("비 예보", FEATS[4])) if xr[f] > 0]
                 + ([f"대·중형 공연 {int(xr[FEATS[5]])}곳"] if xr[FEATS[5]] > 0 else []),
                 season=r(season[d.month], 2))
        )
    return out


# ---------------------------------------------------------------------------
# 6. 분산 안내용 콘텐츠(기관 개방 데이터)
# ---------------------------------------------------------------------------
def build_content() -> dict:
    faq = read_csv("15089962")
    keep = faq[faq["제목"].str.contains("주차|대중교통|이용시간|분실|반려견|음수대|화장실|매점|자전거 이용|장미광장은|잔디지역", regex=True)
               & ~faq["카테고리"].str.contains("미사") & ~faq["제목"].str.contains("미사")]
    lawn = read_csv("15143220")
    crs = read_csv("15147992")
    crs = crs[crs["스포츠센터"].isin(["올림픽수영장", "올림픽공원스포츠센터", "올림픽테니스장"])]
    imm = read_csv("15127487")
    news = read_csv("15090715").sort_values("등록일", ascending=False)
    news["종료일"] = pd.to_datetime(news["종료일"], errors="coerce")
    live = news[news["종료일"] >= TODAY].head(6)
    return dict(
        faq=[dict(q=str(q).strip(), a=str(a).strip()) for q, a in zip(keep["제목"], keep["내용"])],
        lawn=[dict(place=p_, open=o) for p_, o in zip(lawn["장소"], lawn["개방내용"])],
        courses=[dict(center=c, name=n_, desc=str(dsc)[:90], link=l) for c, n_, dsc, l in zip(crs["스포츠센터"], crs["강좌명"], crs["강좌설명"], crs["링크주소"])],
        immersive=[dict(venue=v, kind=k, ext=e, file=f, link=l) for v, k, e, f, l in zip(imm["장소"], imm["구분"], imm["확장자"], imm["파일명"], imm["홈페이지주소"])],
        news=[dict(title=t, start=s, end=e.strftime("%Y-%m-%d"), link=l) for t, s, e, l in zip(live["제목"], live["시작일"], live["종료일"], live["홈페이지 주소"])],
    )


def main() -> None:
    ev = load_events()
    evd = event_days(ev)
    wd = json.loads((EXT / "weather_daily.json").read_text(encoding="utf-8"))["daily"]
    wx = {k: (p_, t_) for k, p_, t_ in zip(wd["time"], wd["precipitation_sum"], wd["temperature_2m_max"])}
    wx_src = {}
    # 예보가 없는 미래 날짜는 월별 평년값(관측 기간 평균 최고기온, 강수 0)으로 채운다
    hist = pd.DataFrame({"t": wd["temperature_2m_max"]}, index=pd.to_datetime(wd["time"]))
    normal = hist.groupby(hist.index.month)["t"].mean()
    for d in pd.date_range(TODAY, TODAY + pd.Timedelta(days=60)):
        wx.setdefault(d.strftime("%Y-%m-%d"), (0.0, r(normal[d.month], 1)))
    fc_path = EXT / "weather_forecast.json"
    if fc_path.exists():
        fc = json.loads(fc_path.read_text(encoding="utf-8"))["daily"]
        for k, p_, t_ in zip(fc["time"], fc["precipitation_sum"], fc["temperature_2m_max"]):
            if p_ is not None and t_ is not None:
                wx[k], wx_src[k] = (p_, t_), "예보"
    season = season_index()

    park, bits = analyze_parking(evd)
    cong, day_lab = analyze_congestion()
    model, w = build_model(day_lab, evd, wx)
    forecast = build_forecast(ev, evd, w, wx, wx_src, season, bits)

    m = read_csv("15131671")
    monthly = {}
    for (place, year), g in m.groupby(["주차장소", "연도"]):
        monthly.setdefault(place, {})[str(year)] = g.sort_values("월")["주차대수"].astype(int).tolist()

    used = set(e for f in forecast for s in f["shows"] for e in [s["id"]]) | set(i for dd_ in park["daily"] for i in dd_["events"])
    recent = ev[(ev["end"] >= TODAY - pd.Timedelta(days=3))]["id"].tolist()
    ev_out = [
        dict(id=int(e["id"]), title=e["title"], venue=e["venue"], tier=e["tiers"][0], tiers=e["tiers"], begin=e["begin"].strftime("%Y-%m-%d"),
             end=e["end"].strftime("%Y-%m-%d"), tm=e["tm"], dur=int(e["dur"]) if pd.notna(e["dur"]) else None, reg=e["reg"], ticket=e["link"] if e["link"].startswith("http") else "",
             img=f"https://www.ksponco.or.kr/olympicpark/attachFiles/eventInfo/{e['img']}" if e["img"] else "",
             page=f"https://www.ksponco.or.kr/olympicpark/eventInfo/eventInfoView.es?mid=a20301010100&evtSeq={e['id']}")
        for _, e in ev.iterrows() if e["id"] in used or e["id"] in recent
    ]
    app = dict(
        meta=dict(generated=dt.datetime.now().strftime("%Y-%m-%d %H:%M"), today=TODAY.strftime("%Y-%m-%d"), capacity=CAPACITY, capacityGeneral=CAPACITY_GENERAL,
                  accessible=dict(ratio=r(ACCESSIBLE_RATIO * 100), low=2, high=4, spaces=CAPACITY - CAPACITY_GENERAL), fee=FEE_PER_10MIN,
                  tierLabel=TIER_LABEL, seasonIndex={str(k): r(v, 2) for k, v in season.items()}, holidays=HOLIDAYS),
        parking=park, congestion=cong, model=model, forecast=forecast, events=ev_out, monthly=monthly, content=build_content(),
    )
    (ROOT / "site" / "data").mkdir(parents=True, exist_ok=True)
    (ROOT / "site" / "data" / "app.json").write_text(json.dumps(app, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    findings = dict(parking={k: v for k, v in park.items() if k not in ("daily", "hist", "histEdges")}, congestion=cong, model=model,
                    forecastHead=[{k: f[k] for k in ("date", "dow", "p", "grade", "factors")} for f in forecast[:21]])
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs" / "findings.json").write_text(json.dumps(findings, ensure_ascii=False, indent=1), encoding="utf-8")
    print("app.json bytes:", (ROOT / "site" / "data" / "app.json").stat().st_size, "| forecast days:", len(forecast), "| events:", len(ev_out))


if __name__ == "__main__":
    main()
