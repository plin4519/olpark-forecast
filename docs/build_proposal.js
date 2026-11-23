/* 기획서(.docx) 생성 스크립트 — 공식 서식(붙임: 기획 요약서 1장 + 상세 기획서 10장 이내)의 목차를 그대로 따른다.
   사용: node docs/build_proposal.js   (환경변수 DEMO_URL, REPO_URL 로 서비스 주소 지정) */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, WidthType, ShadingType, AlignmentType,
  BorderStyle, LevelFormat, PageBreak, Footer, PageNumber, VerticalAlign,
} = require('docx');

const DIR = __dirname;
const F = JSON.parse(fs.readFileSync(path.join(DIR, 'findings.json'), 'utf8'));
const DEMO = process.env.DEMO_URL || '(제출 전 배포 주소 기입)';
const REPO = process.env.REPO_URL || '(제출 전 저장소 주소 기입)';
const FONT = '맑은 고딕', NAVY = '0D366B', GRAY = '52514E', LINE = 'C3C2B7', FILL = 'EEF3FA';
const W = 9638; // A4(11906) - 좌우 여백 1134*2
const n = (v) => Number(v).toLocaleString('ko-KR');
const P = F.parking, C = F.congestion, M = F.model;
const pk = P.dome.filter((d) => d.type === 'parking'), dr = P.dome.filter((d) => d.type === 'dropoff');
const avg = (a, f) => a.reduce((s, d) => s + f(d), 0) / a.length;
const ARR = [0, 1, 2, 3, 4].map((i) => Math.round(avg(pk, (d) => d.arrP[i])));
const EXIT_PK = Math.round(avg(pk, (d) => d.exitShare30)), EXIT_ALL = Math.round(avg(P.dome, (d) => d.exitShare30));
const PK_X = avg(pk, (d) => d.peakVsBase).toFixed(1), DR_X = avg(dr, (d) => d.shortVsBase).toFixed(1), DR_N = Math.round(avg(dr, (d) => d.shortExcess) / 100) * 100;
const FEE = Math.round(avg(P.dome, (d) => d.medianFee) / 100) * 100;
const hh = C.hourHist, PEAK13 = Math.round(((hh[5] + hh[6] + hh[7]) / hh.reduce((a, b) => a + b, 0)) * 100);
const cal = Object.fromEntries(M.gradeCalibration.map((g) => [g.grade, g]));
const seg = Object.fromEntries(P.segments.map((s) => [s.name, s]));

function runs(text, base = {}) {
  return String(text).split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((t) =>
    t.startsWith('**') ? new TextRun({ text: t.slice(2, -2), bold: true, font: FONT, ...base }) : new TextRun({ text: t, font: FONT, ...base }));
}
const p = (text, o = {}) => new Paragraph({ children: runs(text, o.run), spacing: { before: 0, after: o.after ?? 100, line: 320 }, alignment: o.align, keepNext: o.keepNext });
const h1 = (text) => new Paragraph({ children: [new TextRun({ text, bold: true, size: 28, color: NAVY, font: FONT })], spacing: { before: 260, after: 120 }, keepNext: true,
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 3 } } });
const h2 = (text) => new Paragraph({ children: [new TextRun({ text, bold: true, size: 23, font: FONT })], spacing: { before: 180, after: 80 }, keepNext: true });
const b = (text) => new Paragraph({ children: runs(text), numbering: { reference: 'bul', level: 0 }, spacing: { before: 0, after: 50, line: 310 } });
const cap = (text) => new Paragraph({ children: [new TextRun({ text, size: 18, color: GRAY, font: FONT })], alignment: AlignmentType.CENTER, spacing: { before: 40, after: 140 } });
const img = (file, wpx, caption) => {
  const buf = fs.readFileSync(path.join(DIR, 'img', file));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  return [new Paragraph({ children: [new ImageRun({ type: 'png', data: buf, transformation: { width: wpx, height: Math.round((wpx * h) / w) } })], alignment: AlignmentType.CENTER, spacing: { before: 80, after: 0 }, keepNext: true,
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE }, bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE }, left: { style: BorderStyle.SINGLE, size: 4, color: LINE }, right: { style: BorderStyle.SINGLE, size: 4, color: LINE } } }), cap(caption)];
};
const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
function table(rows, widths, { header = true, size = 20 } = {}) {
  const tot = widths.reduce((a, c) => a + c, 0), ws = widths.map((w) => Math.round((w / tot) * W));
  ws[ws.length - 1] += W - ws.reduce((a, c) => a + c, 0);
  return new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: ws,
    rows: rows.map((r, i) => new TableRow({
      tableHeader: header && i === 0, cantSplit: true,
      children: r.map((c, j) => new TableCell({
        width: { size: ws[j], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
        borders: { top: border, bottom: border, left: border, right: border },
        shading: (header && i === 0) || (!header && j === 0) ? { type: ShadingType.CLEAR, fill: FILL, color: 'auto' } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: String(c).split('\n').map((line) => new Paragraph({ children: runs(line, { size, bold: (header && i === 0) || (!header && j === 0) || undefined }), spacing: { before: 0, after: 0, line: 280 } })),
      })),
    })),
  });
}
const gap = (after = 120) => new Paragraph({ children: [], spacing: { before: 0, after } });

/* ------------------------------------------------------------------ 내용 */
const NAME = '올팍예보 — 날씨처럼 미리 보는 올림픽공원 혼잡 예보·분산 안내 서비스';
const body = [];
const add = (...x) => body.push(...x.flat());

// 표지 겸 기획 요약서(1장)
add(
  new Paragraph({ children: [new TextRun({ text: '2026년도 공공데이터 활용 경진대회 기획서', bold: true, size: 32, color: NAVY, font: FONT })], alignment: AlignmentType.CENTER, spacing: { before: 0, after: 60 } }),
  new Paragraph({ children: [new TextRun({ text: '기획 요약서', bold: true, size: 26, font: FONT })], alignment: AlignmentType.CENTER, spacing: { before: 0, after: 160 } }),
  table([
    ['1. 활용사례명', NAME],
    ['2. 사용한\n공공데이터명', '**한국체육산업개발(주) 9종**: 올림픽공원 입출차 정보, 주차장 혼잡도 정보, 올림픽공원 공연정보, 월별주차현황, 자주 묻는 질문정보, 잔디시설정보, 스포츠센터 강좌 정보, 올림픽공원 핫뉴스 정보, 올림픽공원 공연장 실감형 콘텐츠\n**타 기관**: 날씨(운영 시 기상청 단기·중기예보), 공휴일(운영 시 한국천문연구원 특일 정보)'],
    ['3. 요약',
      `올림픽공원에 "언제 가면 덜 붐비는지"를 일기예보처럼 미리 알려 주고, 공연 관람객에게는 도착·출차 시간표를 만들어 주는 웹 서비스입니다. 실제로 동작하는 프로토타입과 소스코드를 함께 제출합니다.\n` +
      `• **혼잡 예보**: 앞으로 6주의 날짜별 혼잡 등급(여유·보통·혼잡)과 시간대별 예상 주차 대수를 제공합니다. 주차장 혼잡도 기록 ${M.nDays}일치를 학습했으며, 학습에 쓰지 않은 기간 검증에서 AUC ${M.aucTest}를 얻었습니다.\n` +
      `• **공연 방문 플래너**: 공연을 고르면 입출차 기록 ${n(P.rows)}건에서 찾은 패턴으로 권장 도착 시각, 입차 집중 구간, 출차 러시, 예상 주차요금을 계산하고 캘린더 알림(.ics)으로 내보냅니다.\n` +
      `• **데이터 인사이트**: 분석 과정에서 ① 혼잡 기록의 대부분은 공연이 아니라 주말 낮 나들이에서 나오고(주말·휴일 ${M.facts.offRate}%, 평일 ${M.facts.workRate}%) ② 같은 KSPO DOME 공연도 주차장이 차는 "주차형"과 승하차만 몰리는 "승하차형"으로 갈린다는 점을 확인해 운영자용 화면으로 제공합니다.`],
    ['4. 기대효과',
      `• **방문객**: 공연 시작 직전 입차 대기와 종료 직후 출차 대기를 피하고, 대중교통 전환 시 공연 1회당 주차요금 약 ${n(FEE)}원(실측 중앙값)을 아낍니다.\n` +
      `• **기관**: 혼잡 예보일에 맞춘 주차 안내 인력 배치, 승하차형 공연일의 임시 승하차 구역 운영 등 데이터에 근거한 운영 계획을 세울 수 있습니다.\n` +
      '• **지역사회**: 공원 주변 도로 혼잡과 공회전을 줄이고, 종료 직후 한꺼번에 몰리는 인파·차량을 분산해 안전에 기여합니다.\n' +
      '• **데이터 개방**: 활용 과정에서 발견한 데이터 품질 문제와 추가 개방 수요를 정리해 환류합니다. 서버 없이 운영되는 구조라 2028년까지 추가 비용 없이 유지할 수 있습니다.'],
  ], [16, 84], { header: false }),
  new Paragraph({ children: [new PageBreak()] }),
);

// 상세 기획서
add(new Paragraph({ children: [new TextRun({ text: '상세 기획서', bold: true, size: 26, font: FONT })], alignment: AlignmentType.CENTER, spacing: { before: 0, after: 100 } }));
add(h1('1. 활용사례 개요'));
add(h2('1-1. 활용사례 명'), p(`**${NAME}**`));
add(h2('1-2. 활용사례 기능, 특징 등 세부내용'));
add(p('올팍예보는 한국체육산업개발(주)이 개방한 주차·공연 데이터를 결합해, 올림픽공원 방문객이 출발 전에 혼잡을 확인하고 일정을 조정하도록 돕는 웹 서비스입니다. 화면은 네 개입니다.'));
add(table([
  ['화면', '주요 기능', '대상'],
  ['혼잡 예보', '오늘의 혼잡 등급, 6주 달력, 날짜별 시간대 예상 주차 대수, 근거 데이터가 붙은 방문 가이드', '모든 방문객'],
  ['공연 방문 플래너', '공연·회차·이동 수단 선택 → 권장 도착 시각, 입차 집중 구간, 출차 러시, 예상 주차요금, 캘린더 알림(.ics), 예매 페이지 연결', '공연 관람객'],
  ['데이터 인사이트', '체류시간 유형, 시간대별 주차 흐름, 공연일 비교, 구역별 혼잡 순서, 예보 모델 성능 공개', '기관 운영자'],
  ['데이터·한계', '활용 데이터 목록, 예보 산출 방법, 한계, 데이터 품질 진단, FAQ', '모두'],
], [18, 62, 20]));
add(gap(60));
add(img('00-hero.png', 400, '그림 1. 첫 화면: 배경의 점은 가장 붐빌 날의 시간대별 예상 주차 대수. 아래는 예정된 공연의 포스터와 그날의 혼잡 등급'));
add(p('**특징 1 — 근거가 보이는 예보.** 모든 안내 문구 아래에 근거가 된 데이터 이름을 표시하고, 예보 등급별로 과거에 실제 혼잡이 얼마나 발생했는지를 함께 공개합니다. 맞지 않을 수 있는 부분은 "한계" 화면에 따로 적었습니다.'));
add(p('**특징 2 — 하나의 숫자 대신 범위.** KSPO DOME 공연일은 관객 구성에 따라 주차 수요 차이가 커서, 주차형일 때(상한)와 승하차형일 때(하한)를 범위로 보여 줍니다.'));
add(p('**특징 3 — 서버 없는 구조.** 화면은 정적 웹페이지이고, 데이터는 하루 한 번 자동 실행되는 파이프라인이 갱신합니다. 설치·로그인이 필요 없고 휴대폰에서도 그대로 쓸 수 있습니다.'));
add(p('**특징 4 — 한눈에 읽히는 화면.** 첫 화면의 배경은 이미지 파일이 아니라 실제 예보 값을 점으로 그린 그래픽입니다. 도착 시각 슬라이더를 움직이면 그 시각의 예상 주차 대수와 공연 주차 차량 가운데 몇 번째쯤 도착하는지가 바로 바뀌고, 날짜마다 덜 붐비는 도착 시간을 자동으로 추천합니다. 예정된 공연은 공연정보의 포스터와 함께 보여 주며, 날짜별 예보는 링크로 공유할 수 있습니다.'));
add(h2('1-3. 활용사례 서비스 확인 방법'));
add(table([
  ['웹 서비스', DEMO],
  ['소스코드', REPO],
  ['직접 실행', '저장소를 내려받아 "python -m http.server --directory site" 실행 후 브라우저에서 localhost:8000 접속(인증키·설치 불필요)'],
], [18, 82], { header: false }));

add(h1('2. 활용사례의 독창성'));
add(h2('2-1. 활용 공공데이터'));
add(table([
  ['데이터명(한국체육산업개발)', '규모', '이 서비스에서의 쓰임'],
  ['올림픽공원 입출차 정보', `${n(P.rows)}건`, '5분 단위 주차 대수 복원, 체류시간 유형, 공연일 입·출차 패턴'],
  ['주차장 혼잡도 정보', `${C.rows}건`, '예보 모델의 정답(라벨), 구역별·시간대별 혼잡 패턴'],
  ['올림픽공원 공연정보', '289건', '공연장·일자·시작 시각·공연 시간 → 예보 입력, 플래너'],
  ['월별주차현황', '36개월', '계절 보정(2023~2025)'],
  ['자주 묻는 질문정보', '49건', '전체 주차면 수, 주차요금, 대중교통, 이용 시간'],
  ['잔디시설정보 · 스포츠센터 강좌 정보 · 올림픽공원 핫뉴스 정보 · 공연장 실감형 콘텐츠', '4종', '출차 분산을 위한 "기다리는 동안" 콘텐츠'],
  ['(타 기관) 날씨, 공휴일', '-', '나들이 기온·비·휴일 변수'],
], [40, 12, 48]));
add(p('공연정보는 프로토타입 단계에서 인증키 없이 받을 수 있는 동일 원천(올림픽공원 공식 일정안내)을 사용했으며, 운영 단계에서 오픈API로 전환합니다. 날씨는 프로토타입에서 Open-Meteo를 썼고 운영 시 기상청 예보로 바꿉니다.', { run: { size: 20, color: GRAY } }));
add(h2('2-2. 사례를 활용하게 된 배경 및 활용 우수성'));
add(p(`**배경.** 올림픽공원은 주차면이 약 ${n(P.capacity)}대인데, 기관 FAQ가 "공연 시간이 임박하면 1시간가량 여유가 필요하다"고 안내할 만큼 혼잡이 잦습니다. 그러나 방문객이 출발 전에 볼 수 있는 정보는 "지금" 상황뿐이고, 내일이나 다음 주 토요일이 얼마나 붐빌지는 알 수 없습니다. 기관이 이미 개방한 데이터만으로 이 공백을 메울 수 있는지 확인하고자 했습니다.`));
add(p('**공공데이터의 활용 빈도·비중·가공.** 서비스의 모든 수치는 위 데이터에서 계산되며, 임의로 만든 값은 없습니다. 핵심 가공은 세 가지입니다.'));
add(b(`**주차 대수 복원**: 입차일시·출차일시 두 항목뿐인 기록 ${n(P.rows)}건에서 입차 누계와 출차 누계의 차이로 5분 단위 주차 대수를 되살렸습니다. 관측 최대치는 ${n(P.peakAll.value)}대(전체의 약 ${P.peakAll.capShare}%)였습니다.`));
add(b(`**기록의 라벨화**: 운영자가 남긴 혼잡·만차 기록을 "그날 혼잡했는가"의 정답으로 삼아, 요일·공휴일·날씨·공연 일정으로 날짜별 혼잡 확률을 예측하는 모델을 학습했습니다.`));
add(b('**비정형 일정의 구조화**: "(토) 18:00, (일) 16:00", "토 오후 6시 / 일 오후 5시"처럼 자유롭게 적힌 공연 시간과 50가지가 넘는 공연장 표기를 요일별 시작 시각과 5개 공연장 등급으로 정리했습니다.'));
add(p('**다른 서비스와의 차별점 — 분석으로 통념을 고쳤습니다.**'));
add(b(`**혼잡의 주원인은 공연이 아니라 주말 낮 나들이였습니다.** 혼잡 기록은 주말·휴일의 ${M.facts.offRate}%, 평일의 ${M.facts.workRate}%에서 나왔고, 기록의 ${PEAK13}%가 13~15시에 몰렸습니다. 주말·휴일의 ${M.facts.domeShareOff}%에 KSPO DOME 공연이 있어 공연 유무로는 날을 구분하기 어려웠고, 계절과 날씨가 차이를 만들었습니다(3~4월 주말 100%, 1월 10%).`));
add(b(`**같은 KSPO DOME 공연도 두 유형으로 갈렸습니다.** 2024년 7월 공연일 7일 중 2일은 최대 주차 대수가 평소의 ${PK_X}배였지만("주차형"), 5일은 주차 대수는 그대로이고 10분 이하 회차만 평소의 ${DR_X}배(하루 약 ${n(DR_N)}건 증가)였습니다("승하차형"). 유형에 따라 필요한 대책이 다릅니다.`));
add(b(`**비 오는 주말은 오히려 더 붐볐습니다.** 비(5mm 이상)가 온 주말·휴일 ${M.facts.rainOff.n}일 중 ${M.facts.rainOff.rate}%에 혼잡 기록이 있었습니다(오지 않은 날 ${M.facts.dryOff.rate}%).`));
add(img('04-dome.png', 560, '그림 2. 2024년 7월 일자별 최대 주차 대수(위)와 10분 이하 회차 건수(아래). 주황색이 KSPO DOME 공연일'));
add(p('흔히 떠올리는 "공연 = 주차 혼잡"이라는 가정으로 만들었다면 틀린 예보가 되었을 것입니다. 올팍예보는 나들이 혼잡(날짜 단위 확률)과 공연 혼잡(시간대 단위 범위)을 나누어 예보합니다.'));

add(h1('3. 활용사례의 구체성'));
add(h2('3-1. 혼잡 예보: 날짜별 등급'));
add(p(`${M.period}의 ${M.nDays}일 가운데 혼잡·만차 기록이 있었던 ${M.nPos}일을 정답으로 로지스틱 회귀 모델을 학습했습니다. 입력은 토요일, 일요일, 공휴일, 주말·휴일의 나들이 기온(최고 10~28℃), 주말·휴일의 비, 대·중형 공연장 공연 수 여섯 가지입니다. 결과를 누구나 검증할 수 있도록 해석 가능한 모델을 택했습니다.`));
add(table([
  ['검증 방법', '결과'],
  ['시간 분리 검증(2025년 9월까지 학습 → 이후 123일 예측)', `AUC ${M.aucTest} (요일·공휴일만 쓴 기준 모델 ${M.aucBaseline})`],
  ['월 단위 교차검증(한 달을 빼고 학습 → 그 달 예측)', `AUC ${M.aucCV}`],
  ['등급별 실제 혼잡 기록 발생률', `여유 ${cal['여유'].actual}%(${cal['여유'].days}일) · 보통 ${cal['보통'].actual}%(${cal['보통'].days}일) · 혼잡 ${cal['혼잡'].actual}%(${cal['혼잡'].days}일)`],
], [56, 44]));
add(p('혼잡 등급 안에서 "혼잡"과 "매우 혼잡"을 나누는 것은 현재 데이터로 신뢰할 만큼 가려지지 않아 3등급만 제공합니다.', { run: { size: 20, color: GRAY } }));
add(img('01-forecast.png', 500, '그림 3. 6주 혼잡 예보 달력(등급은 색·도형·글자를 함께 표기)'));
add(h2('3-2. 혼잡 예보: 시간대별 예상 주차 대수'));
add(p(`공연 영향이 적은 날의 평일·주말 시간대별 평균을 기준선으로 삼고, 월별주차현황으로 계절 차이를 보정합니다. KSPO DOME 공연일에는 2024년 7월 공연일에서 관측된 초과 주차 대수를 공연 시작 시각에 맞춰 더합니다. 평일은 10시대에 약 ${n(P.basePeak.weekday)}대로 가장 많고(05~07시에 하루 평균 ${n(P.dawn.perDay)}대가 들어와 ${P.dawn.medianDwell}분 머무는 새벽 운동 이용 포함), 주말은 16시 전후가 정점입니다.`));
add(img('02-day.png', 560, '그림 4. 날짜 상세: 주차형(상한)·승하차형(하한) 범위, 추천 도착 시간, 도착 시각 슬라이더'));
add(h2('3-3. 공연 방문 플래너'));
add(p('공연과 회차를 고르면 아래 규칙으로 시간표를 만듭니다. 규칙의 수치는 모두 입출차 기록에서 계산했습니다.'));
add(table([
  ['항목', '산출 근거(2024년 7월 KSPO DOME 공연일)', '안내'],
  ['권장 도착', `공연 주차 차량의 상위 25%는 시작 ${ARR[1]}분 전까지 도착`, `시작 ${ARR[1]}분 전 이전 도착`],
  ['입차 집중', `절반이 시작 ${ARR[2]}분 전 이후, 10%는 ${ARR[4]}분 전 이후 도착`, `시작 ${ARR[2]}~${ARR[4]}분 전은 피하기`],
  ['출차 러시', `종료 직후 30분에 공연 주차 차량의 ${EXIT_ALL}%가 출차(주차형 ${EXIT_PK}%), 5분 최대 140대`, '종료 45분 뒤 출차 또는 대중교통'],
  ['주차요금', `10분당 600원(FAQ), 공연 주차 실측 중앙값 약 ${n(FEE)}원`, '출차 시각별 요금 비교'],
], [16, 52, 32]));
add(gap(60));
add(img('03-planner.png', 520, '그림 5. 공연 방문 플래너: 시간표, 요금 비교, 캘린더 알림 내보내기'));
add(p('대중교통·픽업을 고르면 지하철 출구 안내와 픽업 권장 시각으로 바뀝니다. 출차를 늦추는 동안 이용할 수 있도록 그날 개방 중인 잔디·쉼터(잔디시설정보), 공원 소식(핫뉴스), 스포츠센터 강좌, 공연장 3D 미리 보기(실감형 콘텐츠)를 함께 보여 줍니다. 캘린더 파일에는 권장 도착 90분 전 알림이 들어 있어 별도 앱 없이 알림을 받습니다.'));
add(h2('3-4. 구역 안내와 운영자용 인사이트'));
add(p(`혼잡도 기록의 등록 순서를 평균해 "먼저 차는 구역"을 찾았습니다. ${C.domino[0].zone}·${C.domino[1].zone} 구역이 가장 먼저, ${C.domino[C.domino.length - 2].zone}·${C.domino[C.domino.length - 1].zone} 구역이 가장 늦게 기록되며, 한 번 혼잡해진 구역이 "원활"로 돌아오기까지 중앙값 ${C.relief.medianHours}시간이 걸렸습니다. 방문객에게는 늦게 차는 구역을 안내하고, 운영자에게는 구역×시간대 기록 분포를 제공합니다.`));
add(img('05-zone.png', 540, '그림 6. 운영자용 인사이트: 구역별·시간대별 혼잡 기록(왼쪽), 주말·휴일 혼잡 발생률의 계절 차이(오른쪽)'));
add(h2('3-5. 시스템 구성'));
add(table([
  ['단계', '내용', '기술'],
  ['수집', '공공데이터포털 파일데이터 내려받기, 공연 일정·날씨 갱신', 'Python(requests)'],
  ['분석', '주차 대수 복원, 공연일 패턴 추출, 모델 학습·검증, 예보 생성', 'Python(pandas, numpy)'],
  ['제공', '결과를 JSON 한 개로 내보내 정적 웹페이지가 읽음', 'HTML·CSS·JavaScript(외부 라이브러리 없음)'],
  ['자동화', '하루 한 번 수집→분석→배포 자동 실행', 'GitHub Actions, GitHub Pages'],
], [14, 56, 30]));

add(h1('4. 사례의 활용 적절성'));
add(p('올팍예보가 만들고자 하는 사회적 가치는 네 가지입니다.'));
add(b(`**시민의 시간과 비용 절감.** 공연 주차 차량은 체류 중앙값이 4시간 반 안팎, 요금 중앙값이 약 ${n(FEE)}원입니다. 예보를 보고 대중교통으로 바꾸면 이 비용과 입·출차 대기를 함께 줄입니다. 2024년 7월 20일 기준 공연 주차 추정 차량 ${n(pk[0].concertCars)}대 가운데 10%만 전환해도 약 ${n(Math.round(pk[0].concertCars / 100) * 10)}대가 줄어듭니다(가정에 따른 시나리오).`));
add(b('**교통 혼잡과 탄소 저감.** 종료 직후 30분에 몰리는 출차를 45분 뒤로 일부만 옮겨도 출구와 주변 도로의 정체·공회전이 줄어 인근 주민의 불편을 덜 수 있습니다.'));
add(b(`**안전.** 승하차형 공연일에는 10분 이하 회차가 하루 ${n(DR_N)}건가량 늘어납니다. 이 수요를 미리 알면 임시 승하차 구역과 안내 인력을 배치해 보행자와 차량이 엉키는 상황을 줄일 수 있습니다.`));
add(b('**정보 접근성과 데이터 개방의 선순환.** 등급을 색·도형·글자로 함께 표기하고 휴대폰 화면에 맞췄으며, 로그인 없이 누구나 씁니다. 활용 중 발견한 데이터 품질 문제를 기관에 되돌려 다음 개방의 품질을 높입니다(5장).'));
add(p('기관 입장에서는 주차 안내 인력 배치, 만차 안내 문구 송출 시점, 공연 주최 측과의 승하차 동선 협의 등에 같은 예보를 활용할 수 있어, 대국민 서비스와 내부 운영 개선을 하나의 데이터 흐름으로 묶습니다.'));

add(h1('5. 실현가능성 및 기타'));
add(h2('5-1. 추진 일정 및 개발·운영 계획'));
add(table([
  ['시기', '내용', '상태'],
  ['2026년 11월', '데이터 분석, 예보 모델, 웹 프로토타입(예보·플래너·인사이트), 자동 갱신 파이프라인', '완료'],
  ['2026년 12월', '인증키 발급 후 「차량입출차·공연·날씨 연계 데이터」, 「입출차정보(전체구역)」 약 240만 건으로 모델 재학습, 주차형·승하차형 가설 검증', '예정'],
  ['2027년 1분기', '「실시간 주차현황」 연동으로 예보 보정, 구역별 예보, 날씨·공휴일을 기상청·천문연구원 API로 전환', '예정'],
  ['2027년 2분기', '홈 화면 설치(PWA)와 알림, 「영문 공연정보」를 활용한 영문 화면, 이용 통계 기반 개선', '예정'],
  ['2027~2028년', '분기별 모델 재학습과 정확도 공개, 기관 요청 사항 반영', '운영'],
], [16, 68, 16]));
add(h2('5-2. 서비스 유지 계획(2028년까지 운영 가능 여부)'));
add(p('**2028년까지 운영할 수 있습니다.** 근거는 다음과 같습니다.'));
add(b('**운영비 0원**: 서버와 데이터베이스가 없는 정적 웹 구조이며, 자동 갱신과 호스팅은 무료 범위의 GitHub Actions·Pages로 처리합니다.'));
add(b('**사람 손이 필요 없는 갱신**: 공연 일정과 날씨 예보는 매일 자동으로 받아 예보를 다시 계산합니다. 수집이 실패하면 직전 데이터로 서비스가 유지됩니다.'));
add(b('**이관 가능성**: 외부 라이브러리 없는 표준 웹 기술과 Python만 사용했고 소스코드 전체를 공개 저장소로 관리합니다. 수상 시 원천 소스를 제공하며, 기관 홈페이지나 서버로 옮기는 데 별도 개발이 필요하지 않습니다.'));
add(b('**정직한 한계 관리**: 시간대별 패턴은 2024년 7월 한 달(3개 출입구 구역) 기록에 기반하므로, 12월 재학습으로 표본을 1년 치로 넓히고 화면의 "한계" 항목을 갱신합니다.'));
add(h2('5-3. 향후 추가 개방이 필요한 공공데이터 의견'));
add(p('활용 과정에서 확인한 사항과 제안입니다.'));
add(table([
  ['대상 데이터', '확인한 점', '제안'],
  ['주차장 혼잡도 정보', `등록시간의 분·초 자리가 등록일의 월·일과 ${C.timeFormatBugShare}% 일치(예: 8월 12일 → 17:08:12). 시각 표기 오류로 보이며 "시"만 사용 가능`, '분 단위 시각 복원, 2026년 2월 이후 기록 보완'],
  ['영문 공연정보', '공연일자가 실제 공연일이 아니라 등록 시점에 가까움', '공연 시작·종료일 항목 분리'],
  ['올림픽공원 공연정보', '공연 시간이 자유 서술형, 공연장 표기 50가지 이상', '회차별 시작 시각 구조화, 공연장 코드 표준화'],
  ['입출차 정보(파일)', '2024년 7월·3개 구역만 제공, 구역 구분 없음', '2025년 전체 구역 데이터의 파일 제공'],
  ['(신규) 주차구역 기준정보', '구역별 주차면 수·위치·가까운 공연장 정보 없음', '구역 단위 예보와 지도 안내 가능'],
  ['(신규) 공연별 관객 규모', '입장 인원·연령대 분포 없음', '주차형·승하차형 사전 판별, 승하차 구역 운영'],
], [24, 46, 30]));

const doc = new Document({
  creator: '올팍예보', title: '2026년도 공공데이터 활용 경진대회 기획서 - 올팍예보',
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  numbering: { config: [{ reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: GRAY, font: FONT })] })] }) },
    children: body,
  }],
});
Packer.toBuffer(doc).then((buf) => {
  const out = path.join(DIR, '기획서_올팍예보.docx');
  fs.writeFileSync(out, buf);
  console.log('written', out, buf.length);
});
