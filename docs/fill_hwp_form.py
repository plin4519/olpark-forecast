"""주최 측 원본 한글 서식(.hwp)을 한글(HWP) 자동화로 열어 내용을 채운다. (한글 2018 이상 + pywin32 필요)

- 안내문 본문을 지우고 붙임 서식만 남긴다.
- 참가신청서·서약서·동의서의 칸을 채운다(신청인 정보는 저장소에 올리지 않는 별도 JSON에서 읽는다).
- 기획서 칸에는 build_proposal.js(FRAG=1) 조각을 HTML로 바꿔 끼워 넣는다.

사용: python docs/fill_hwp_form.py <원본.hwp> <조각.docx> <작업폴더> <출력.hwp> [신청인.json] [확인용.pdf]
"""
import html
import json
import pathlib
import re
import sys
import zipfile

import win32com.client as wc
from lxml import etree

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
W = "{%s}" % W_NS
FONT = "맑은 고딕"

NAME = "올팍예보 — 날씨처럼 미리 보는 올림픽공원 혼잡 예보·분산 안내 서비스"
DATA = "올림픽공원 입출차 정보, 주차장 혼잡도 정보, 올림픽공원 공연정보, 월별주차현황 등 한국체육산업개발(주) 공공데이터 9종과 날씨·공휴일 정보(전체 목록은 기획서 2-1)"
OVERVIEW = ("올림픽공원이 언제 붐빌지 일기예보처럼 미리 알려 주고 공연 관람객에게 도착·출차 시간표를 만들어 주는 웹 서비스입니다. "
            "6주 혼잡 예보, 공연 방문 플래너, 운영자용 데이터 인사이트로 구성되며 동작하는 프로토타입과 소스코드를 함께 제출합니다.")
SUM_LABELS = ["1. 활용사례명", "2. 사용한 공공데이터명", "3. 요약", "4. 기대효과"]


# ───────────────────────── 조각(docx) → HTML ─────────────────────────
def text_of(el):
    return "".join(t.text or "" for t in el.iter(W + "t"))


def para_html(p, zf, rels, work, counter, size_override=None):
    ppr = p.find(W + "pPr")
    style = ["margin-top:0", "line-height:150%"]
    after = 4
    if ppr is not None:
        sp = ppr.find(W + "spacing")
        if sp is not None and sp.get(W + "after"):
            after = int(sp.get(W + "after")) / 20
        ind = ppr.find(W + "ind")
        if ind is not None:
            left = int(ind.get(W + "left") or 0) / 20
            hang = int(ind.get(W + "hanging") or 0) / 20
            if left:
                style.append(f"margin-left:{left:.0f}pt")
            if hang:
                style.append(f"text-indent:-{hang:.0f}pt")
        jc = ppr.find(W + "jc")
        if jc is not None and jc.get(W + "val") == "center":
            style.append("text-align:center")
    if not any(x.startswith("text-align") for x in style):
        style.append("text-align:justify")
    style.append(f"margin-bottom:{after:.0f}pt")
    parts = []
    for r in p.findall(W + "r"):
        blip = next(r.iter("{%s}blip" % A_NS), None)
        if blip is not None:
            counter[0] += 1
            target = rels[blip.get("{%s}embed" % R_NS)]
            name = f"img{counter[0]}.{target.rsplit('.', 1)[-1]}"
            (work / name).write_bytes(zf.read("word/" + target))
            ext = next(r.iter("{%s}extent" % WP_NS))
            w_px, h_px = int(ext.get("cx")) / 9525, int(ext.get("cy")) / 9525
            parts.append(f'<img src="{name}" width="{w_px:.0f}" height="{h_px:.0f}">')
            continue
        t = "".join(x.text or "" for x in r.findall(W + "t"))
        if not t:
            continue
        rpr = r.find(W + "rPr")
        size, bold, color = 11, False, None
        if rpr is not None:
            if rpr.find(W + "sz") is not None:
                size = int(rpr.find(W + "sz").get(W + "val")) / 2
            bold = rpr.find(W + "b") is not None
            if rpr.find(W + "color") is not None:
                color = rpr.find(W + "color").get(W + "val")
        size = size_override or size
        s = f"font-family:'{FONT}';font-size:{size:g}pt" + (f";color:#{color}" if color and color != "auto" else "")
        body = html.escape(t)
        parts.append(f'<span style="{s}">{"<b>" + body + "</b>" if bold else body}</span>')
    if not parts:
        return ""
    return f'<p style="{";".join(style)}">{"".join(parts)}</p>\n'


def table_html(tbl, zf, rels, work, counter):
    rows = []
    for tr in tbl.findall(W + "tr"):
        cells = []
        for tc in tr.findall(W + "tc"):
            pr = tc.find(W + "tcPr")
            wid = int(pr.find(W + "tcW").get(W + "w")) / 20
            shd = pr.find(W + "shd")
            bg = f' bgcolor="#{shd.get(W + "fill")}"' if shd is not None and shd.get(W + "fill") not in (None, "auto") else ""
            inner = "".join(para_html(p, zf, rels, work, counter).replace("line-height:150%", "line-height:135%").replace("margin-bottom:4pt", "margin-bottom:0").replace("text-align:justify", "text-align:left") for p in tc.findall(W + "p"))
            cells.append(f'<td width="{wid:.0f}pt"{bg} style="border:solid #A6A6A6 0.75pt;padding:3pt 5pt">{inner or "&nbsp;"}</td>')
        rows.append("<tr>" + "".join(cells) + "</tr>")
    return '<table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse">\n' + "\n".join(rows) + "\n</table>\n"


def build_fragments(frag_path, work):
    """조각 docx를 칸별 HTML 파일로 만든다. 반환: {키: html 파일 경로}"""
    zf = zipfile.ZipFile(frag_path)
    fbody = etree.fromstring(zf.read("word/document.xml")).find(W + "body")
    rels = {r.get("Id"): r.get("Target") for r in etree.fromstring(zf.read("word/_rels/document.xml.rels"))}
    groups, key, counter = {}, None, [0]
    for e in fbody:
        if e.tag == W + "sectPr":
            continue
        m = re.fullmatch(r"@@(H1|H2|SUM)\|(.+)@@", text_of(e)) if e.tag == W + "p" else None
        if m:
            kind, val = m.groups()
            if kind == "SUM":
                key = "SUM" + val
            elif kind == "H1":
                key = "S" + val.split(".")[0].strip()
            else:
                code = val.split(".")[0].strip()
                if code[0] in "12":
                    key = code
                else:
                    groups.setdefault(key, []).append(f'<p style="text-align:left;margin-top:10pt;margin-bottom:3pt"><span style="font-family:\'{FONT}\';font-size:11pt"><b>{html.escape(val)}</b></span></p>\n')
            groups.setdefault(key, [])
            continue
        if key is None:
            continue
        small = 9.5 if key.startswith("SUM") else None
        groups[key].append(table_html(e, zf, rels, work, counter) if e.tag == W + "tbl" else para_html(e, zf, rels, work, counter, small))
    # 요약서는 네 항목을 한 칸에 이어서 넣는다
    summary = []
    for i, lab in enumerate(SUM_LABELS, start=1):
        summary.append(f'<p style="text-align:left;margin-top:5pt;margin-bottom:2pt"><span style="font-family:\'{FONT}\';font-size:10pt"><b>{lab}</b></span></p>\n')
        summary.extend(x.replace('style="margin-top:0', 'style="margin-left:10pt;margin-top:0', 1).replace("line-height:150%", "line-height:135%") for x in groups.pop(f"SUM{i}", []))
    groups["SUM"] = summary
    out = {}
    for k, parts in groups.items():
        if not parts:
            continue
        path = work / f"frag_{k}.html"
        path.write_text('<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body>\n' + "".join(parts) + "</body></html>", encoding="utf-8")
        out[k] = path
    return out


# ───────────────────────── 한글 자동화 ─────────────────────────
class Hwp:
    def __init__(self):
        self.h = wc.gencache.EnsureDispatch("HWPFrame.HwpObject")
        self.h.XHwpWindows.Item(0).Visible = True
        self.h.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        self.h.SetMessageBoxMode(0x10000 | 0x1000 | 0x10 | 0x1)  # 확인 창은 자동으로 '예/확인'

    def find(self, text, from_start=True):
        h = self.h
        if from_start:
            h.Run("MoveDocBegin")
        ps = h.HParameterSet.HFindReplace
        h.HAction.GetDefault("RepeatFind", ps.HSet)
        ps.FindString = text
        ps.Direction = h.FindDir("Forward")
        ps.IgnoreMessage = 1
        ok = h.HAction.Execute("RepeatFind", ps.HSet)
        if not ok:
            raise RuntimeError(f"찾지 못함: {text}")
        return ok

    def replace_all(self, old, new):
        h = self.h
        ps = h.HParameterSet.HFindReplace
        h.HAction.GetDefault("AllReplace", ps.HSet)
        ps.FindString = old
        ps.ReplaceString = new
        ps.Direction = h.FindDir("AllDoc")
        ps.ReplaceMode = 1
        ps.IgnoreMessage = 1
        return h.HAction.Execute("AllReplace", ps.HSet)

    def char(self, size=11, bold=False):
        h = self.h
        ps = h.HParameterSet.HCharShape
        h.HAction.GetDefault("CharShape", ps.HSet)
        for a in ("Hangul", "Latin", "Hanja", "Japanese", "Other", "Symbol", "User"):
            setattr(ps, "FaceName" + a, FONT)
            setattr(ps, "FontType" + a, h.FontType("TTF"))
        ps.Height = h.PointToHwpUnit(size)
        ps.TextColor = h.RGBColor(0, 0, 0)
        ps.Italic = 0
        ps.Bold = 1 if bold else 0
        h.HAction.Execute("CharShape", ps.HSet)

    def type(self, text, size=11, bold=False):
        h = self.h
        self.char(size, bold)
        ps = h.HParameterSet.HInsertText
        h.HAction.GetDefault("InsertText", ps.HSet)
        ps.Text = text
        h.HAction.Execute("InsertText", ps.HSet)

    def clear_cell(self):
        """커서가 있는 칸의 내용을 모두 지운다."""
        self.h.Run("Cancel")
        self.h.Run("SelectAll")
        self.h.Run("Delete")

    def align(self, kind):
        h = self.h
        ps = h.HParameterSet.HParaShape
        h.HAction.GetDefault("ParagraphShape", ps.HSet)
        ps.AlignType = h.HAlign(kind)
        h.HAction.Execute("ParagraphShape", ps.HSet)

    def set_cell(self, text, size=11, bold=False, align=None):
        self.clear_cell()
        if align:
            self.align(align)
        self.type(text, size, bold)

    def insert_html(self, path):
        h = self.h
        ps = h.HParameterSet.HInsertFile
        h.HAction.GetDefault("InsertFile", ps.HSet)
        ps.filename = str(path)
        ps.FileFormat = "HTML"
        ps.KeepSection = 0
        ps.KeepCharshape = 1
        ps.KeepParashape = 1
        ps.KeepStyle = 0
        return h.HAction.Execute("InsertFile", ps.HSet)

    def picture(self, path, w_mm, h_mm):
        ctrl = self.h.InsertPicture(str(path), True, 1, False, False, 0, w_mm, h_mm)
        if ctrl:
            try:
                ps = ctrl.Properties
                ps.SetItem("TreatAsChar", 1)
                ctrl.Properties = ps
            except Exception as e:  # noqa: BLE001
                print("  (그림 속성 설정 실패)", e)
        return bool(ctrl)


def main(src, frag_path, work, out_hwp, applicant=None, out_pdf=None):
    work = pathlib.Path(work)
    work.mkdir(parents=True, exist_ok=True)
    frags = build_fragments(frag_path, work)
    a = json.loads(pathlib.Path(applicant).read_text(encoding="utf-8")) if applicant else None
    z = Hwp()
    h = z.h
    try:
        assert h.Open(str(pathlib.Path(src).resolve()), "HWP", ""), "원본 서식을 열지 못함"
        # 1) 안내문 본문 삭제: 문서 처음 ~ '붙임1 참가 신청서' 표 앞
        z.find("참가 신청서")
        h.Run("Cancel")
        h.Run("CloseEx")
        para = h.GetPos()[1]
        h.SetPos(0, 0, 0)
        h.SelectText(0, 0, para, 0)
        h.Run("Delete")
        print("안내문 삭제 후 쪽수:", h.PageCount)

        # 2) 참가신청서
        print("참가분야 표시:", z.replace_all("□ 활용 사례", "☑ 활용 사례"))
        for label, text, size in (("활용사례 제목", NAME, 10), ("활용데이터", DATA, 9), ("기획 개요", OVERVIEW, 9)):
            z.find(label)
            h.Run("Cancel")
            h.Run("TableRightCell")
            z.set_cell(text, size, bold=(label == "활용사례 제목"), align="Left")
        if a:
            print("참가구분:", z.replace_all("☐ 개인   ☐ 팀", "☑ 개인   ☐ 팀" if a["type"] == "개인" else "☐ 개인   ☑ 팀"))
            for placeholder, text in (("팀장명 기재", a["name"]), ("0000-00-00", a["birth"]), ("000-0000-0000", a["phone"]), ("0000@000.00.00", a["email"])):
                z.find(placeholder)
                z.set_cell(text, 11)
            for label, text, size in (("주소", a["address"], 10), ("소속(기업)", a["org"], 11)):
                z.find(label)
                h.Run("Cancel")
                h.Run("TableRightCell")
                z.set_cell(text, size)
            y, m, d = a["date"].split("-")
            # 서약서 날짜·신청인
            z.find("신청인")
            h.Run("Cancel")
            h.Run("MoveLineEnd")
            h.Run("MoveSelLineBegin")
            h.Run("Delete")
            z.type(" " * 44 + f"신청인    {a['name']}  ", 10)
            if a.get("signature"):
                z.picture(a["signature"], 23, 11)
            z.type(" (인)", 10)
            h.Run("MoveUp")
            h.Run("MoveLineEnd")
            h.Run("MoveSelLineBegin")
            h.Run("Delete")
            z.type(" " * 52 + f"{y}년 {int(m)}월 {int(d)}일", 10)
            # 동의서
            z.find("같이 동의합니다")
            h.Run("Cancel")
            z.find("월", from_start=False)
            h.Run("Cancel")
            h.Run("MoveLineEnd")
            h.Run("MoveSelLineBegin")
            h.Run("Delete")
            z.type(f"{y} 년 {int(m)} 월 {int(d)} 일", 11)
            z.find("□ 동의  /  □ 거부")
            if a.get("consent"):
                h.Run("Delete")
                z.type("☑ 동의  /  □ 거부", 11)
            else:
                h.Run("Cancel")
            h.Run("TableRightCell")
            z.set_cell(a["name"], 11)
            h.Run("TableRightCell")
            if a.get("signature"):
                z.clear_cell()
                z.picture(a["signature"], 22, 10.5)

        # 3) 기획서: 요약서와 상세 기획서의 칸
        z.find("1. 활용사례명")
        z.clear_cell()
        print("요약서:", z.insert_html(frags["SUM"]))
        targets = [("1-1", None), ("1-2", "활용사례 내용을 구체적으로 설명"), ("1-3", "홈페이지 주소"), ("2-1", "활용한 공공데이터 열거"),
                   ("2-2", "사례를 활용하게 된 배경 설명"), ("S3", "체계적이고 구체적으로 작성"), ("S4", "사회적 가치 창출에 대하여 설명"), ("S5", "추진 일정 및 개발")]
        for k, guide in targets:
            if guide:
                z.find(guide)
            else:
                z.find("1-1. 활용사례 명")
                h.Run("Cancel")
                h.Run("TableLowerCell")
            z.clear_cell()
            print(f"  {k}:", z.insert_html(frags[k]))
        # 상세 기획서는 새 쪽에서 시작
        z.find("상세 기획서")
        h.Run("Cancel")
        h.Run("MoveParaBegin")
        h.Run("BreakPage")
        print("최종 쪽수:", h.PageCount)
        print("HWP 저장:", h.SaveAs(str(pathlib.Path(out_hwp).resolve()), "HWP", ""))
        if out_pdf:
            print("PDF 저장:", h.SaveAs(str(pathlib.Path(out_pdf).resolve()), "PDF", ""))
    finally:
        try:
            h.Clear(1)
        except Exception:  # noqa: BLE001
            pass
        h.Quit()


if __name__ == "__main__":
    main(*sys.argv[1:7])
