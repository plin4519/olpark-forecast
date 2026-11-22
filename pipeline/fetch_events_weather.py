"""공연 일정과 날씨를 내려받아 data/ext 에 저장한다.

- 공연 일정: 올림픽공원 공식 '일정안내'(공공데이터 「올림픽공원 공연정보」 3037877 의 원천).
  운영 단계에서는 인증키를 발급받아 오픈API로 대체한다(README 참고).
- 날씨: 프로토타입은 인증키가 필요 없는 Open-Meteo(과거 관측·16일 예보)를 사용한다.
  운영 단계에서는 기상청 단기·중기예보 API(공공데이터포털)로 대체한다.

사용: python pipeline/fetch_events_weather.py [--refresh]
"""
import datetime as dt
import json
import pathlib
import sys
import time

import requests

OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "ext"
OUT.mkdir(parents=True, exist_ok=True)
REFRESH = "--refresh" in sys.argv
S = requests.Session()
S.headers["User-Agent"] = "Mozilla/5.0 (public-data research script)"
KEEP = ["evtSeq", "title", "beginDt", "endDt", "tm", "plc", "plcCd", "ndTm", "seeAge", "fileNm", "evtLink", "regDate"]
LAT, LON = 37.5207, 127.1214  # 올림픽공원


def months_to_fetch(existing: bool) -> list[str]:
    today = dt.date.today()
    if existing:  # 갱신: 이번 달부터 3개월
        out, y, m = [], today.year, today.month
        for _ in range(3):
            out.append(f"{y}{m:02d}")
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
        return out
    return ["202406", "202407", "202408"] + [f"{y}{m:02d}" for y in (2025, 2026) for m in range(1, 13)]


def fetch_events() -> None:
    path = OUT / "events.json"
    rows = {int(it["evtSeq"]): it for it in json.loads(path.read_text(encoding="utf-8"))} if path.exists() else {}
    if path.exists() and not REFRESH:
        return
    for ym in months_to_fetch(bool(rows)):
        r = S.post(
            "https://www.ksponco.or.kr/olympicpark/eventInfo/eventInfoListAjax.es",
            data=json.dumps({"nowYM": ym, "plcCd": ""}),
            headers={"Content-Type": "application/json;charset=UTF-8"},
            timeout=60,
        )
        r.raise_for_status()
        for part in r.json():
            for it in part:
                rows[int(it["evtSeq"])] = {k: (it.get(k) or "").strip() if isinstance(it.get(k), str) else it.get(k) for k in KEEP}
        print(ym, "ok", flush=True)
        time.sleep(1.2)
    path.write_text(json.dumps(list(rows.values()), ensure_ascii=False, indent=1), encoding="utf-8")
    print("events:", len(rows))


def fetch_weather() -> None:
    daily = "precipitation_sum,temperature_2m_max,temperature_2m_min,temperature_2m_mean"
    hist = OUT / "weather_daily.json"
    if not hist.exists():
        r = S.get("https://archive-api.open-meteo.com/v1/archive", timeout=120, params={
            "latitude": LAT, "longitude": LON, "start_date": "2024-07-01", "end_date": "2026-08-31", "daily": daily, "timezone": "Asia/Seoul"})
        r.raise_for_status()
        hist.write_text(json.dumps(r.json()), encoding="utf-8")
        print("weather history ok")
    fc = OUT / "weather_forecast.json"
    if REFRESH or not fc.exists():
        r = S.get("https://api.open-meteo.com/v1/forecast", timeout=60, params={
            "latitude": LAT, "longitude": LON, "daily": "precipitation_sum,temperature_2m_max", "forecast_days": 16, "timezone": "Asia/Seoul"})
        r.raise_for_status()
        fc.write_text(json.dumps(r.json()), encoding="utf-8")
        print("weather forecast ok", r.json()["daily"]["time"][0], "~", r.json()["daily"]["time"][-1])


if __name__ == "__main__":
    fetch_events()
    fetch_weather()
