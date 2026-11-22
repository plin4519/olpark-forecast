# 올팍예보 — 날씨처럼 미리 보는 올림픽공원 혼잡 예보·분산 안내

2026년도 한국체육산업개발(주) 공공데이터 활용 경진대회 출품작(프로토타입)입니다.

- `site/` 웹 서비스(정적 페이지, 외부 라이브러리 없음). 실행: `python -m http.server --directory site`
- `pipeline/` 데이터 수집·분석·예보 생성 (`fetch_kspo_files.py`, `fetch_events_weather.py`, `build_data.py`)
- `data/` 한국체육산업개발 공공데이터 원본(CSV)과 공연 일정·날씨
- `docs/기획서_올팍예보.docx` 제출용 기획서(같은 내용의 PDF 포함), `docs/참가신청서_기재내용.md` 신청서 문안,
- `.github/workflows/pages.yml` 매일 05시 예보 갱신·배포(GitHub Pages는 저장소가 공개일 때만 배포)
- `docs/build_proposal.js` 기획서 생성 스크립트, `docs/findings.json` 분석 수치

## 다시 만들기
```
pip install pandas numpy requests
python pipeline/fetch_events_weather.py --refresh
python pipeline/build_data.py
```

## 데이터 출처
한국체육산업개발(주) 공공데이터(공공데이터포털): 올림픽공원 입출차 정보, 주차장 혼잡도 정보, 올림픽공원 공연정보, 월별주차현황, 자주 묻는 질문정보, 잔디시설정보, 스포츠센터 강좌 정보, 올림픽공원 핫뉴스 정보, 공연장 실감형 콘텐츠. 날씨는 프로토타입에서 Open-Meteo를 사용합니다.

예보는 과거 기록에 근거한 통계적 추정이며 한계는 서비스의 "데이터·한계" 화면에 적었습니다.

