"""공공데이터포털(data.go.kr)에서 한국체육산업개발(주) 파일데이터(CSV)를 내려받는다.

- 로그인/인증키가 필요 없는 '파일데이터'만 대상으로 한다.
- 포털의 다운로드 제한 확인(check-limit)을 그대로 따르며, 추가 인증(CAPTCHA)이
  요구되면 즉시 중단한다(우회하지 않음).

사용: python fetch_kspo_files.py <저장폴더> [데이터ID ...]
"""
import json
import pathlib
import re
import sys
import time

import requests

BASE = "https://www.data.go.kr"
DATASETS = {
    "15138735": "올림픽공원 입출차 정보",
    "15131671": "월별주차현황",
    "15164156": "주차장 혼잡도 정보",
    "15099006": "공연 포스터 정보",
    "15149169": "영문 공연정보",
    "15127487": "올림픽공원 공연장 실감형 콘텐츠",
    "15133891": "테니스장 이용 정보",
    "15143220": "잔디시설정보",
    "15144839": "스포츠센터 종목정보",
    "15147992": "스포츠센터 강좌 정보",
    "15089962": "자주 묻는 질문정보",
    "15147873": "공공데이터 개방목록",
    "15098997": "스포츠센터 이벤트 정보",
    "15090719": "스케이트장 이벤트 정보",
    "15090715": "올림픽공원 핫뉴스 정보",
    "15160326": "비정형데이터_생태갤러리",
}


def fetch(session: requests.Session, out: pathlib.Path, pk: str) -> str:
    page = session.get(f"{BASE}/data/{pk}/fileData.do", timeout=60).text
    m = re.search(r"fn_fileDataDown\('(\d+)',\s*'([^']+)',\s*'([^']*)',\s*'([^']*)'", page)
    if not m:
        return "상세 페이지에서 다운로드 정보를 찾지 못함"
    _, detail_pk, atch, sn = m.groups()
    r = session.post(
        f"{BASE}/tcs/dss/selectFileDataDownload.do",
        data={
            "publicDataPk": pk,
            "publicDataDetailPk": detail_pk,
            "atchFileId": atch,
            "fileDetailSn": sn,
            "publicDataTyCode": "PR0051",
        },
        headers={"X-Requested-With": "XMLHttpRequest", "Referer": f"{BASE}/data/{pk}/fileData.do"},
        timeout=60,
    )
    info = r.json() if r.headers.get("content-type", "").startswith("application/json") else json.loads(r.text)
    if not info.get("status"):
        return f"다운로드 정보 조회 실패: {str(info)[:120]}"
    atch_id, sn = info["atchFileId"], info["fileDetailSn"]
    name = info["dataSetFileDetailInfo"]["dataNm"]
    chk = session.post(
        f"{BASE}/cmm/cmm/check-limit.json",
        data={"atchFileId": atch_id, "fileDetailSn": sn},
        headers={"X-Requested-With": "XMLHttpRequest"},
        timeout=60,
    )
    if chk.status_code == 403 or chk.json().get("needCaptcha"):
        return "STOP: 포털이 추가 인증(CAPTCHA)을 요구함"
    f = session.get(
        f"{BASE}/cmm/cmm/fileDownload.do",
        params={"atchFileId": atch_id, "fileDetailSn": sn, "dataNm": name},
        timeout=300,
    )
    f.raise_for_status()
    ext = ".csv"
    cd = f.headers.get("content-disposition", "")
    m2 = re.search(r"\.(\w{2,5})[\"']?\s*$", cd)
    if m2:
        ext = "." + m2.group(1).lower()
    (out / f"{pk}{ext}").write_bytes(f.content)
    return f"OK {len(f.content):,} bytes  [{name}]"


def main() -> None:
    out = pathlib.Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    ids = sys.argv[2:] or list(DATASETS)
    s = requests.Session()
    s.headers["User-Agent"] = "Mozilla/5.0 (public-data research script)"
    for pk in ids:
        if any(out.glob(f"{pk}.*")):
            print(pk, "이미 있음")
            continue
        try:
            msg = fetch(s, out, pk)
        except Exception as e:  # noqa: BLE001
            msg = f"ERR {type(e).__name__}: {e}"
        print(pk, DATASETS.get(pk, ""), "->", msg, flush=True)
        if msg.startswith("STOP"):
            break
        time.sleep(2)


if __name__ == "__main__":
    main()
