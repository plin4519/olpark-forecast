"""HWP5(.hwp) 본문 텍스트 추출기. 사용: python -I hwp2txt.py <in.hwp> <out.txt>"""
import struct
import sys
import zlib

import olefile

HWPTAG_PARA_TEXT = 67
# 8 wchar(16바이트)를 차지하는 확장/인라인 컨트롤 문자
EXT_CTRL = {1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23}


def para_text(data: bytes) -> str:
    out, i, n = [], 0, len(data) // 2
    while i < n:
        ch = struct.unpack_from("<H", data, i * 2)[0]
        if ch in EXT_CTRL:
            if ch == 9:
                out.append("\t")
            elif ch == 11:
                out.append("[표/그림]")
            i += 8
            continue
        if ch in (10, 13):
            out.append("\n")
        elif ch >= 32:
            out.append(chr(ch))
        i += 1
    return "".join(out)


def main(src: str, dst: str) -> None:
    ole = olefile.OleFileIO(src)
    header = ole.openstream("FileHeader").read()
    compressed = bool(header[36] & 1)
    sections = sorted(
        (e for e in ole.listdir() if e[0] == "BodyText"),
        key=lambda e: int(e[1].replace("Section", "")),
    )
    lines = []
    for entry in sections:
        raw = ole.openstream(entry).read()
        if compressed:
            raw = zlib.decompress(raw, -15)
        pos = 0
        while pos + 4 <= len(raw):
            head = struct.unpack_from("<I", raw, pos)[0]
            tag, level, size = head & 0x3FF, (head >> 10) & 0x3FF, (head >> 20) & 0xFFF
            pos += 4
            if size == 0xFFF:
                size = struct.unpack_from("<I", raw, pos)[0]
                pos += 4
            if tag == HWPTAG_PARA_TEXT:
                text = para_text(raw[pos : pos + size]).strip()
                if text:
                    lines.append("  " * max(level - 1, 0) + text)
            pos += size
    with open(dst, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"sections={len(sections)} paragraphs={len(lines)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
