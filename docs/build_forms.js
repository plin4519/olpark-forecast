/* 참가신청서·서약서·개인정보 동의서(.docx) — 공식 안내문(hwp)의 붙임1, 붙임1-1 서식을 Word로 옮기고
   작품 관련 칸을 미리 채운다. 성명·연락처·서명 등 개인정보 칸은 비워 둔다.
   사용: node docs/build_forms.js */
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, BorderStyle, PageBreak, VerticalAlign } = require('docx');

const FONT = '맑은 고딕', FILL = 'F2F2F2', W = 9638;
const border = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
const borders = { top: border, bottom: border, left: border, right: border };
const run = (text, o = {}) => new TextRun({ text, font: FONT, size: 20, ...o });
const para = (text, o = {}) => new Paragraph({ children: [run(text, o.run)], alignment: o.align, spacing: { before: o.before ?? 0, after: o.after ?? 0, line: o.line ?? 300 } });
function cell(text, w, o = {}) {
  const lines = Array.isArray(text) ? text : String(text).split('\n');
  return new TableCell({
    width: { size: w, type: WidthType.DXA }, borders, verticalAlign: VerticalAlign.CENTER, columnSpan: o.span,
    shading: o.head ? { type: ShadingType.CLEAR, fill: FILL, color: 'auto' } : undefined,
    margins: { top: 70, bottom: 70, left: 100, right: 100 },
    children: lines.map((t) => new Paragraph({ children: [run(t, { bold: o.head, color: o.gray ? '7F7F7F' : undefined })], alignment: o.head || o.center ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { before: 0, after: 0, line: 270 } })),
  });
}
const row = (cells, h) => new TableRow({ children: cells, height: h ? { value: h, rule: 'atLeast' } : undefined, cantSplit: true });
const table = (widths, rows) => new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, rows });
const title = (label, text) => [
  para(label, { run: { bold: true, size: 22 }, after: 60 }),
  new Paragraph({ children: [run(text, { bold: true, size: 30 })], alignment: AlignmentType.CENTER, spacing: { before: 60, after: 200 } }),
];

const NAME = '올팍예보 — 날씨처럼 미리 보는 올림픽공원 혼잡 예보·분산 안내 서비스';
const DATA = ['한국체육산업개발(주) 공공데이터 9종: 올림픽공원 입출차 정보, 주차장 혼잡도 정보, 올림픽공원 공연정보, 월별주차현황, 자주 묻는 질문정보, 잔디시설정보, 스포츠센터 강좌 정보, 올림픽공원 핫뉴스 정보, 올림픽공원 공연장 실감형 콘텐츠',
  '타 기관: 날씨(운영 시 기상청 단기·중기예보), 공휴일(운영 시 한국천문연구원 특일 정보)'];
const OVERVIEW = [
  '올림픽공원이 언제 붐빌지 일기예보처럼 미리 알려 주고, 공연 관람객에게 도착·출차 시간표를 만들어 주는 웹 서비스입니다.',
  '① 혼잡 예보: 주차장 혼잡도 기록 354일치를 요일·공휴일·날씨·공연 일정으로 학습해 앞으로 6주의 날짜별 혼잡 등급(여유·보통·혼잡)과 시간대별 예상 주차 대수를 제공합니다(학습에 쓰지 않은 기간 검증 AUC 0.818).',
  '② 공연 방문 플래너: 입출차 기록 215,528건에서 찾은 패턴으로 권장 도착 시각, 입차 집중 구간, 출차 러시, 예상 주차요금을 계산하고 캘린더 알림으로 내보냅니다.',
  '③ 데이터 인사이트: 혼잡 기록의 대부분이 공연이 아니라 주말 낮 나들이에서 나온다는 점, 같은 KSPO DOME 공연도 "주차형"과 "승하차형"으로 갈린다는 점을 확인해 운영자용 화면으로 제공합니다.',
  '서버 없이 운영되는 구조라 2028년까지 추가 비용 없이 유지할 수 있으며, 동작하는 프로토타입과 소스코드를 함께 제출합니다.',
];
const PLEDGE = [
  '1. 대회의 제반 규정을 준수하겠습니다.',
  '2. 참가신청서 및 기획서에 기재한 내용이 사실임을 확인하며, 허위 사실 기재 등으로 인하여 문제가 발생하면 모든 책임은 본인(팀)에게 있음을 확인합니다.',
  '3. 응모작에 대한 저작권으로 인하여 발생하는 민‧형사상 책임은 참가자에게 있습니다.',
  '4. 동일·유사 응모작으로 타 경진대회에서 수상한 사실이 있거나, 타인의 저작권을 침해하거나, 제출 내용이 허위로 확인되는 경우 접수 및 수상이 취소될 수 있으며, 이미 지급 받은 시상금은 반환합니다.',
  '5. 응모작의 저작권은 참가자에게 귀속되며, 수상작에 한하여 한국체육산업개발(주)가 정책개선 및 공공 활용을 위하여 홈페이지 등에 게재·공개하는 것에 동의합니다.',
  '6. 수상작의 경우 웹/앱 등 원천 개발 소스 제공 및 2028년까지 서비스 운영에 협조하겠습니다.',
  '7. 심사 결과에 대해 이의를 제기하지 않으며, 원활한 대회 진행에 적극적으로 협조하겠습니다.',
];
const c4 = [1500, 3319, 1500, 3319], c5 = [1500, 2034, 2034, 2035, 2035];

const body = [
  ...title('붙임1', '2026년도 공공데이터 활용 경진대회 참가 신청서'),
  table(c4, [
    row([cell('참가구분', c4[0], { head: true }), cell('☐ 개인   ☐ 팀', c4[1]), cell('참가분야', c4[2], { head: true }), cell('☑ 활용 사례', c4[3])]),
    row([cell('성명(대표자)', c4[0], { head: true }), cell('', c4[1]), cell('생년월일', c4[2], { head: true }), cell('', c4[3])], 430),
    row([cell('휴대전화번호', c4[0], { head: true }), cell('', c4[1]), cell('이메일', c4[2], { head: true }), cell('', c4[3])], 430),
    row([cell('주소', c4[0], { head: true }), cell('', c4[1] + c4[2] + c4[3], { span: 3 })], 430),
    row([cell('소속(기업)', c4[0], { head: true }), cell('', c4[1]), cell('팀명', c4[2], { head: true }), cell('', c4[3])], 430),
  ]),
  para('* 팀 참가 시 성명(대표자)에는 팀장명을 적고 아래 팀원 표를 채웁니다.', { run: { size: 17, color: '7F7F7F' }, before: 40, after: 80 }),
  table(c5, [
    row([cell('구분', c5[0], { head: true }), cell('팀원1', c5[1], { head: true }), cell('팀원2', c5[2], { head: true }), cell('팀원3', c5[3], { head: true }), cell('팀원4', c5[4], { head: true })]),
    ...['성명', '휴대전화번호', '이메일'].map((k) => row([cell(k, c5[0], { head: true }), cell('', c5[1]), cell('', c5[2]), cell('', c5[3]), cell('', c5[4])], 380)),
  ]),
  para('', { after: 0, line: 200 }),
  table([1500, 8138], [
    row([cell('활용사례 제목', 1500, { head: true }), cell(NAME, 8138)]),
    row([cell('활용데이터', 1500, { head: true }), cell(DATA, 8138)]),
    row([cell('활용사례\n기획 개요', 1500, { head: true }), cell(OVERVIEW, 8138)]),
  ]),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ children: [run('참가 서약서', { bold: true, size: 28 })], alignment: AlignmentType.CENTER, spacing: { before: 0, after: 200 } }),
  para('본인은 한국체육산업개발(주)에서 개최하는 ｢2026년도 공공데이터 활용 경진대회｣에 참가하면서, 다음 각 호의 규정을 지킬 것을 서약합니다.', { after: 160, line: 340 }),
  ...PLEDGE.map((t) => para(t, { after: 110, line: 340 })),
  para('2026년      월      일', { align: AlignmentType.CENTER, before: 400, after: 300, run: { size: 22 } }),
  para('신청인                              (인)', { align: AlignmentType.RIGHT, after: 400, run: { size: 22 } }),
  para('한국체육산업개발주식회사 귀하', { align: AlignmentType.CENTER, run: { bold: true, size: 26 } }),
  new Paragraph({ children: [new PageBreak()] }),
  ...title('붙임1-1', '개인정보 수집 및 이용에 관한 동의서'),
  ...[
    ['1. 개인정보 수집‧이용 목적', '｢2026년도 공공데이터 활용 경진대회｣ 참가자 관리, 수상자 선정, 진행 상황 안내, 수상작 활용 협약 체결 및 사후 관리를 위해 개인정보를 수집하며, 목적 이외의 용도로는 사용하지 않습니다.'],
    ['2. 개인정보 처리자', '한국체육산업개발(주) 디지털혁신팀 02-2180-3504'],
    ['3. 개인정보 수집‧이용 항목', '이름, 생년월일, 휴대전화번호, 이메일, 주소, 소속, 팀명\n※ 수상자의 시상금 지급을 위한 정보는 수상 확정 후 별도 동의를 받아 수집'],
    ['4. 동의 거부 권리 및 불이익', '신청자는 개인정보 수집‧이용 동의에 대해 거부할 권리가 있습니다. 다만, 동의를 거부할 경우에는 ｢2026년도 공공데이터 활용 경진대회｣ 참가자에 대한 공정한 심사 등을 위해 참가가 제한됩니다.'],
    ['5. 보유 및 이용기간', '일반참가자는 결과 발표 후 즉시 해당 정보 파기, 수상자의 경우 시상금 지급 완료 및 수상작 서비스 운영 협약 종료일(2028년)까지 보유합니다.\n관련 법령에 따라 보존이 필요한 정보는 해당 기간 동안 보존하며, 보유기간 경과 시 지체 없이 파기합니다.'],
  ].flatMap(([h, t]) => [para(h, { run: { bold: true, size: 21 }, before: 110, after: 40 }), ...t.split('\n').map((x) => para(x, { line: 300, after: 20 }))]),
  para('본인은 개인정보 수집‧이용에 관한 상기 내용을 확인하였으며, 아래와 같이 동의합니다.', { before: 200, after: 140, run: { bold: true } }),
  para('2026 년      월      일', { align: AlignmentType.CENTER, after: 200, run: { size: 22 } }),
  table([3600, 3019, 3019], [
    row([cell('동의 여부', 3600, { head: true }), cell('이름', 3019, { head: true }), cell('서명', 3019, { head: true })]),
    ...[0, 1, 2, 3, 4].map(() => row([cell('□ 동의  /  □ 거부', 3600, { center: true }), cell('', 3019), cell('', 3019)], 400)),
  ]),
];

const doc = new Document({
  creator: '올팍예보', title: '2026년도 공공데이터 활용 경진대회 참가신청서·개인정보 동의서',
  styles: { default: { document: { run: { font: FONT, size: 20 } } } },
  sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: body }],
});
Packer.toBuffer(doc).then((buf) => {
  const out = path.join(__dirname, '참가신청서_개인정보동의서_올팍예보.docx');
  fs.writeFileSync(out, buf);
  console.log('written', buf.length);
});
