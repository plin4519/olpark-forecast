"""공식 서식(주최 측 안내문을 Word로 저장한 파일)에 작품 내용을 채운다.

- 안내문 본문(대회 개요 등)은 빼고 붙임 서식(참가신청서·서약서·동의서·기획서)만 남긴다.
- 참가신청서: 참가분야 표시, 활용사례 제목·활용데이터·기획 개요를 채운다. 성명·연락처·서명 칸은 건드리지 않는다.
- 기획서: 요약서와 상세 기획서의 각 칸에 build_proposal.js(FRAG=1)가 만든 조각을 넣는다.

사용: python docs/fill_official_form.py <공식서식.docx> <조각.docx> <출력.docx>
"""
import copy
import re
import sys
import zipfile

from lxml import etree

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
PR_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
W = "{%s}" % W_NS
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
FONT = "맑은 고딕"

NAME = "올팍예보 — 날씨처럼 미리 보는 올림픽공원 혼잡 예보·분산 안내 서비스"
DATA = [
    "**한국체육산업개발(주) 9종**: 올림픽공원 입출차 정보, 주차장 혼잡도 정보, 올림픽공원 공연정보, 월별주차현황, 자주 묻는 질문정보, 잔디시설정보, 스포츠센터 강좌 정보, 올림픽공원 핫뉴스 정보, 올림픽공원 공연장 실감형 콘텐츠",
    "**타 기관**: 날씨(운영 시 기상청 단기·중기예보), 공휴일(운영 시 한국천문연구원 특일 정보)",
]
OVERVIEW = [
    "올림픽공원이 언제 붐빌지 일기예보처럼 미리 알려 주고, 공연 관람객에게 도착·출차 시간표를 만들어 주는 웹 서비스입니다.",
    "① 혼잡 예보(6주 날짜별 등급, 시간대별 예상 주차 대수) ② 공연 방문 플래너(권장 도착 시각, 출차 러시, 예상 주차요금, 캘린더 알림) ③ 운영자용 데이터 인사이트로 구성됩니다.",
    "서버 없이 운영되어 2028년까지 유지할 수 있으며, 동작하는 프로토타입과 소스코드를 함께 제출합니다.",
]


def text_of(el):
    return "".join(t.text or "" for t in el.iter(W + "t"))


def mk_p(text, size=20, bold=False, align=None, before=0, after=40, line=300, left=None, hanging=None, page_break=False):
    """**굵게** 표기를 지원하는 문단."""
    p = etree.Element(W + "p")
    ppr = etree.SubElement(p, W + "pPr")
    if page_break:
        etree.SubElement(ppr, W + "pageBreakBefore")
    sp = etree.SubElement(ppr, W + "spacing")
    sp.set(W + "before", str(before))
    sp.set(W + "after", str(after))
    sp.set(W + "line", str(line))
    sp.set(W + "lineRule", "auto")
    if left is not None:
        ind = etree.SubElement(ppr, W + "ind")
        ind.set(W + "left", str(left))
        if hanging:
            ind.set(W + "hanging", str(hanging))
    if align:
        etree.SubElement(ppr, W + "jc").set(W + "val", align)
    for part in [x for x in re.split(r"(\*\*[^*]+\*\*)", text) if x]:
        is_b = part.startswith("**")
        r = etree.SubElement(p, W + "r")
        rpr = etree.SubElement(r, W + "rPr")
        f = etree.SubElement(rpr, W + "rFonts")
        for a in ("ascii", "hAnsi", "eastAsia", "cs"):
            f.set(W + a, FONT)
        if bold or is_b:
            etree.SubElement(rpr, W + "b")
            etree.SubElement(rpr, W + "bCs")
        etree.SubElement(rpr, W + "sz").set(W + "val", str(size))
        etree.SubElement(rpr, W + "szCs").set(W + "val", str(size))
        t = etree.SubElement(r, W + "t")
        t.text = part[2:-2] if is_b else part
        t.set(XML_SPACE, "preserve")
    return p


def set_cell(tc, elems):
    """칸의 내용(문단·표)을 바꾼다. 칸 속성(tcPr)은 유지하고, 칸은 반드시 문단으로 끝나게 한다."""
    for child in list(tc):
        if child.tag != W + "tcPr":
            tc.remove(child)
    for e in elems:
        tc.append(e)
    if len(tc) == 1 or tc[-1].tag != W + "p":
        tc.append(mk_p("", size=4, after=0, line=120))


SIGN_XML = (
    '<w:r xmlns:w="%s" xmlns:r="%s"><w:drawing>'
    '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">'
    '<wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{id}" name="서명 {id}"/>'
    '<a:graphic xmlns:a="%s"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    '<pic:nvPicPr><pic:cNvPr id="{id}" name="sign.png"/><pic:cNvPicPr/></pic:nvPicPr>'
    '<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
) % (W_NS, R_NS, A_NS)


def sign_run(rid, n, width_cm, ratio):
    cx = int(width_cm * 360000)
    return etree.fromstring(SIGN_XML.format(cx=cx, cy=int(cx / ratio), id=9000 + n, rid=rid))


def fill_applicant(t_app, t_consent, a, sign=None):
    """신청인 인적사항·날짜·동의 표시를 채운다(서명 칸은 비워 둔다). a: 저장소에 올리지 않는 별도 JSON."""
    rows = t_app.findall(W + "tr")

    def put(tc, text, size=22):
        set_cell(tc, [mk_p(text, size=size, align="center", after=0, line=300)])

    for t in rows[0].iter(W + "t"):
        if t.text and "개인" in t.text and "팀" in t.text:
            t.text = "☑ 개인   ☐ 팀" if a["type"] == "개인" else "☐ 개인   ☑ 팀"
    c1, c2 = rows[1].findall(W + "tc"), rows[2].findall(W + "tc")
    put(c1[1], a["name"]); put(c1[3], a["birth"])
    put(c2[1], a["phone"]); put(c2[3], a["email"])
    put(rows[3].findall(W + "tc")[1], a["address"], 20)
    put(rows[4].findall(W + "tc")[1], a["org"])
    y, m, d = a["date"].split("-")
    for p in rows[-1].iter(W + "p"):  # 서약서
        ts = list(p.iter(W + "t"))
        s = "".join(t.text or "" for t in ts)
        if re.sub(r"\s", "", s) == "2026년월일":
            ts[-1].text = f"{y}년 {int(m)}월 {int(d)}일"
        elif "신청인" in s and "(인)" in s:
            if not sign:
                ts[-1].text = re.sub(r"신청인\s+\(인\)", f"신청인    {a['name']}    (인)", ts[-1].text)
                continue
            # 이름 뒤에 서명 그림을 넣고 (인)을 그 뒤에 둔다. 줄 간격 '고정'이면 그림이 잘리므로 '자동'으로 바꾼다.
            lead = re.match(r"\s*", ts[-1].text).group(0)
            ts[-1].text = lead[: max(0, len(lead) - 14)] + f"신청인    {a['name']}  "
            run = ts[-1].getparent()
            tail = copy.deepcopy(run)
            next(tail.iter(W + "t")).text = " (인)"
            run.addnext(sign(1, 2.3))
            run.getnext().addnext(tail)
            for sp in p.iter(W + "spacing"):
                sp.set(W + "lineRule", "auto")
                sp.set(W + "line", "240")
    crow = t_consent.findall(W + "tr")
    for p in crow[0].iter(W + "p"):  # 동의서 날짜
        ts = list(p.iter(W + "t"))
        if re.sub(r"\s", "", "".join(t.text or "" for t in ts)) == "2026년월일":
            ts[-1].text = f"{y} 년 {int(m)} 월 {int(d)} 일"
    cells = crow[2].findall(W + "tc")
    if a.get("consent"):
        for t in cells[0].iter(W + "t"):
            if t.text:
                t.text = t.text.replace("□ 동의", "☑ 동의", 1)
    put(cells[1], a["name"])
    if sign:
        para = mk_p("", size=10, align="center", after=0, line=240)
        para.append(sign(2, 1.9))
        set_cell(cells[2], [para])


def main(form_path, frag_path, out_path, applicant_path=None):
    zin = zipfile.ZipFile(form_path)
    files = {i.filename: zin.read(i.filename) for i in zin.infolist() if not i.filename.endswith("/")}
    order = [i.filename for i in zin.infolist() if not i.filename.endswith("/")]
    doc = etree.fromstring(files["word/document.xml"])
    body = doc.find(W + "body")

    # ── 조각 읽기 ──
    zf = zipfile.ZipFile(frag_path)
    fbody = etree.fromstring(zf.read("word/document.xml")).find(W + "body")
    frels = {r.get("Id"): r.get("Target") for r in etree.fromstring(zf.read("word/_rels/document.xml.rels"))}
    groups, key = {}, None
    for e in fbody:
        if e.tag == W + "sectPr":
            continue
        m = re.fullmatch(r"@@(H1|H2|SUM)\|(.+)@@", text_of(e)) if e.tag == W + "p" else None
        if not m:
            if key:
                groups.setdefault(key, []).append(e)
            continue
        kind, val = m.groups()
        if kind == "SUM":
            key = "SUM" + val
        elif kind == "H1":
            key = "S" + val.split(".")[0].strip()
        else:
            code = val.split(".")[0].strip()
            if code[0] in "12":
                key = code
            else:  # 3·5장의 소제목은 칸 안에 굵은 글씨로 남긴다
                groups.setdefault(key, []).append(mk_p(val, size=22, bold=True, before=160, after=70))
        groups.setdefault(key, [])

    # 그림: 조각의 이미지를 서식 패키지로 옮기고 관계 ID를 새로 매긴다
    rels = etree.fromstring(files["word/_rels/document.xml.rels"])
    n_img = 0
    for elems in groups.values():
        for e in elems:
            for blip in e.iter("{%s}blip" % A_NS):
                n_img += 1
                target = frels[blip.get("{%s}embed" % R_NS)]
                name = f"media/olpark_{n_img}.{target.rsplit('.', 1)[-1]}"
                files["word/" + name] = zf.read("word/" + target)
                order.append("word/" + name)
                r = etree.SubElement(rels, "{%s}Relationship" % PR_NS)
                r.set("Id", f"rIdOlp{n_img}")
                r.set("Type", R_NS + "/image")
                r.set("Target", name)
                blip.set("{%s}embed" % R_NS, f"rIdOlp{n_img}")
    ct = etree.fromstring(files["[Content_Types].xml"])
    if not any(d.get("Extension") == "png" for d in ct.findall("{%s}Default" % CT_NS)):
        d = etree.Element("{%s}Default" % CT_NS)
        d.set("Extension", "png")
        d.set("ContentType", "image/png")
        ct.insert(0, d)

    # ── 서식의 주요 요소 찾기 ──
    tables = [e for e in body if e.tag == W + "tbl"]

    def find(pred):
        return next(t for t in tables if pred(text_of(t), t))

    t_app_title = find(lambda s, t: "참가 신청서" in s and len(t.findall(W + "tr")) == 1)
    t_app = find(lambda s, t: s.startswith("참가구분"))
    t_consent_title = find(lambda s, t: "개인정보 수집 및 이용에 관한 동의서" in s and len(t.findall(W + "tr")) == 1)
    t_plan_title = find(lambda s, t: s.replace(" ", "") == "붙임12026년도공공데이터활용경진대회")
    t_sum = find(lambda s, t: s.startswith("1. 활용사례명"))
    t_detail = find(lambda s, t: s.startswith("활용사례 개요"))
    p_detail = next(e for e in body if e.tag == W + "p" and "상세 기획서" in text_of(e))

    # 안내문 본문 제거(붙임 서식만 남긴다)
    for e in list(body):
        if e is t_app_title:
            break
        body.remove(e)

    # ── 참가신청서 ──
    rows = t_app.findall(W + "tr")
    for t in rows[0].iter(W + "t"):
        if t.text and "활용 사례" in t.text:
            t.text = t.text.replace("□", "☑")
    for tr in rows:
        label = text_of(tr.findall(W + "tc")[0]).replace(" ", "")
        target = tr.findall(W + "tc")[-1]
        if label == "활용사례제목":
            set_cell(target, [mk_p(NAME, size=22, bold=True, after=0, line=320, left=60)])
        elif label == "활용데이터":
            set_cell(target, [mk_p(x, size=19, after=30, line=280, left=60) for x in DATA])
        elif label.startswith("활용사례기획개요"):
            set_cell(target, [mk_p(x, size=19, after=40, line=280, left=60) for x in OVERVIEW])

    if applicant_path:
        import json
        import pathlib
        t_consent = find(lambda s, t: s.startswith("1. 개인정보"))
        a = json.loads(pathlib.Path(applicant_path).read_text(encoding="utf-8"))
        sign = None
        if a.get("signature"):
            from PIL import Image
            sig = pathlib.Path(a["signature"])
            w_px, h_px = Image.open(sig).size
            files["word/media/olpark_sign.png"] = sig.read_bytes()
            order.append("word/media/olpark_sign.png")
            r = etree.SubElement(rels, "{%s}Relationship" % PR_NS)
            r.set("Id", "rIdOlpSign")
            r.set("Type", R_NS + "/image")
            r.set("Target", "media/olpark_sign.png")
            sign = lambda n, width_cm: sign_run("rIdOlpSign", n, width_cm, w_px / h_px)
        fill_applicant(t_app, t_consent, a, sign)

    # 서약서(표의 마지막 두 줄)는 쪽 사이에서 쪼개지지 않게 한 덩어리로 넘긴다
    for kn in rows[-2].iter(W + "keepNext"):
        kn.set(W + "val", "true")
    trpr = rows[-1].find(W + "trPr")
    if trpr is None:
        trpr = etree.Element(W + "trPr")
        rows[-1].insert(0, trpr)
    etree.SubElement(trpr, W + "cantSplit")

    # 쪽 나눔: 동의서, 기획서는 새 쪽에서 시작
    for t in (t_consent_title, t_plan_title):
        t.addprevious(mk_p("", size=2, after=0, line=20, page_break=True))
    ppr = p_detail.find(W + "pPr")
    if ppr is None:
        ppr = etree.Element(W + "pPr")
        p_detail.insert(0, ppr)
    ppr.insert(0, etree.Element(W + "pageBreakBefore"))

    # ── 기획 요약서(1장 안에 들어가도록 조금 촘촘하게) ──
    tc = t_sum.find(".//" + W + "tc")
    for i, lab in enumerate(tc.findall(W + "p"), start=1):
        for c in list(lab.iter(W + "color")):  # 회색 안내 글씨 → 검정
            c.getparent().remove(c)
        at = lab
        for frag in groups.get(f"SUM{i}", []):
            f = copy.deepcopy(frag)
            fp = f.find(W + "pPr")
            bullet = text_of(f).startswith("•")
            ind = etree.SubElement(fp, W + "ind")
            ind.set(W + "left", "500" if bullet else "320")
            ind.set(W + "right", "120")
            if bullet:
                ind.set(W + "hanging", "180")
            for z in list(f.iter(W + "sz")) + list(f.iter(W + "szCs")):
                z.set(W + "val", "19")
            sp = fp.find(W + "spacing")
            sp.set(W + "line", "270")
            sp.set(W + "after", "20")
            at.addnext(f)
            at = f
        at.addnext(mk_p("", size=6, after=0, line=100))

    # ── 상세 기획서: 제목 줄 바로 아래 칸에 해당 조각을 넣는다 ──
    rows = t_detail.findall(W + "tr")
    plan = {"1-1": "1-1", "1-2": "1-2", "1-3": "1-3", "2-1": "2-1", "2-2": "2-2", "3": "S3", "4": "S4", "5": "S5"}
    filled = []
    for i, tr in enumerate(rows[:-1]):
        code = re.match(r"(\d-\d|\d)", text_of(tr).strip())
        k = plan.get(code.group(1)) if code else None
        if not k or k in filled:
            continue
        set_cell(rows[i + 1].find(W + "tc"), [copy.deepcopy(e) for e in groups[k]])
        filled.append(k)
    missing = [k for k in plan.values() if k not in filled]
    assert not missing, f"채우지 못한 칸: {missing}"

    files["word/_rels/document.xml.rels"] = etree.tostring(rels, xml_declaration=True, encoding="UTF-8", standalone=True)
    files["[Content_Types].xml"] = etree.tostring(ct, xml_declaration=True, encoding="UTF-8", standalone=True)
    files["word/document.xml"] = etree.tostring(doc, xml_declaration=True, encoding="UTF-8", standalone=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zout:
        for name in dict.fromkeys(order):
            zout.writestr(name, files[name])
    print("filled:", filled, "| images:", n_img)


if __name__ == "__main__":
    main(*sys.argv[1:5])
