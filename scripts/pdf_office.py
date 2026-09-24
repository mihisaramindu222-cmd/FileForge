#!/usr/bin/env python3
import base64
import html
import os
import re
import subprocess
import sys
import uuid
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

MAX_RENDER_PAGES = 100


def run(cmd, timeout=180):
    try:
        completed = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout, check=False)
    except FileNotFoundError:
        raise RuntimeError(f"Required converter command is unavailable: {cmd[0]}")
    if completed.returncode != 0:
        detail = re.sub(r"\s+", " ", (completed.stderr or completed.stdout).strip())
        raise RuntimeError(f"{cmd[0]} failed. {detail[:220] or 'Processing failed.'}")
    return completed


def render_pages(pdf, out_dir):
    info = run(["pdfinfo", str(pdf)], timeout=30).stdout
    match = re.search(r"^Pages:\s+(\d+)$", info, re.M)
    if not match:
        raise RuntimeError("Could not determine the PDF page count.")
    pages = int(match.group(1))
    if pages < 1:
        raise RuntimeError("The PDF has no pages.")
    if pages > MAX_RENDER_PAGES:
        raise RuntimeError(f"This conversion renders PDF pages as images and is limited to {MAX_RENDER_PAGES} pages.")
    prefix = str(Path(out_dir) / "page")
    run(["pdftoppm", "-r", "110", "-png", str(pdf), prefix], timeout=180)
    files = sorted(Path(out_dir).glob("page-*.png"), key=lambda p: int(re.search(r"(\d+)", p.stem).group(1)))
    if len(files) != pages:
        raise RuntimeError("Not all PDF pages could be rendered.")
    return files


def png_size(path):
    with open(path, "rb") as fh:
        data = fh.read(24)
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise RuntimeError("Rendered page is not a valid PNG.")
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    return width, height


def core_props(title):
    safe_title = escape(title)
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{safe_title}</dc:title><dc:creator>FileForge</dc:creator><cp:lastModifiedBy>FileForge</cp:lastModifiedBy></cp:coreProperties>'''


def docx_content_type():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>'''


def docx_app():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>FileForge</Application></Properties>'''


def docx_rels(image_count):
    rels = ['''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">''',
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="word/styles.xml"/>',
            '</Relationships>']
    return '\n'.join(rels)


def make_docx_document(lines, image_paths):
    rels = []
    body = []
    rid = 10
    for line in lines:
        if line == "\f":
            body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
        elif line:
            body.append(f'<w:p><w:r><w:t xml:space="preserve">{escape(line)}</w:t></w:r></w:p>')
    if image_paths:
        for index, image in enumerate(image_paths, start=1):
            w, h = png_size(image)
            # A4 page width is 11,906 twips. With 720 twip margins on each side,
            # the usable width is about 10,466 twips = ~6.65M EMU.
            # Keep the rendered page inside the document body instead of overflowing it.
            max_w = 6_640_000
            ratio = h / max(w, 1)
            cx = max_w
            cy = int(cx * ratio)
            rel_id = f"rId{rid}"
            rid += 1
            rels.append((rel_id, f"media/image{index}.png"))
            body.append(f'''<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{index}" name="Page {index}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="{index}" name="Page {index}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{rel_id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>''')
            if index < len(image_paths):
                body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    body_xml = ''.join(body) if body else '<w:p><w:r><w:t>No extractable content was found.</w:t></w:r></w:p>'
    doc = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>{body_xml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>'''
    rel_xml = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">']
    rel_xml.append('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>')
    for rel_id, target in rels:
        rel_xml.append(f'<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{target}"/>')
    rel_xml.append('</Relationships>')
    return doc, '\n'.join(rel_xml)


def make_docx(input_pdf, output_docx, tmp_dir):
    text_file = Path(tmp_dir) / "word.txt"
    run(["pdftotext", "-layout", str(input_pdf), str(text_file)], timeout=60)
    raw = text_file.read_text(encoding="utf-8", errors="replace") if text_file.exists() else ""
    image_paths = []
    lines = []
    pages = raw.split("\f") if raw else []

    # A PDF can contain both text pages and scanned/image-only pages. Mixing
    # editable text with a few missing pages is worse than returning a faithful
    # page image, so when any page has no extractable text we render the whole
    # document as page images. This preserves all pages consistently.
    page_has_text = bool(pages) and all(bool(re.sub(r"\s+", "", page)) for page in pages)
    if raw.strip() and page_has_text:
        for i, page in enumerate(pages):
            page_lines = page.splitlines()
            lines.extend([line.rstrip("\r") for line in page_lines])
            if i < len(pages) - 1:
                lines.append("\f")
    else:
        render_dir = Path(tmp_dir) / "rendered-word"
        render_dir.mkdir(parents=True, exist_ok=True)
        image_paths = render_pages(input_pdf, render_dir)
    document_xml, document_rels = make_docx_document(lines, image_paths)
    with zipfile.ZipFile(output_docx, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", docx_content_type())
        z.writestr("_rels/.rels", '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>''')
        z.writestr("word/document.xml", document_xml)
        z.writestr("word/_rels/document.xml.rels", document_rels)
        z.writestr("word/styles.xml", '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style></w:styles>''')
        z.writestr("docProps/core.xml", core_props(Path(input_pdf).name))
        z.writestr("docProps/app.xml", docx_app())
        for index, image in enumerate(image_paths, start=1):
            z.write(image, f"word/media/image{index}.png")


def pptx_content_types(slide_count):
    parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
             '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>', '<Default Extension="xml" ContentType="application/xml"/>', '<Default Extension="png" ContentType="image/png"/>',
             '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>', '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>', '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>', '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>', '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>', '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>']
    for i in range(1, slide_count + 1):
        parts.append(f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>')
    parts.append('</Types>')
    return ''.join(parts)


def pptx_presentation(slide_count):
    ids = ''.join(f'<p:sldId id="{255+i}" r:id="rId{1+i}"/>' for i in range(1, slide_count + 1))
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>{ids}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr/><a:lvl1pPr marL="0" algn="l"><a:defRPr lang="en-US" sz="1800"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>'''


def pptx_presentation_rels(slide_count):
    rels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">', '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>']
    for i in range(1, slide_count + 1):
        rels.append(f'<Relationship Id="rId{1+i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i}.xml"/>')
    rels.append('</Relationships>')
    return ''.join(rels)


def pptx_master():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Master"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:sldMaster>'''


def pptx_master_rels():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>'''


def pptx_layout():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout type="blank" preserve="1" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt x="0" y="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'''


def pptx_layout_rels():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>'''


def pptx_theme():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="FileForge"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F1F1F"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="6D5DFC"/></a:accent1><a:accent2><a:srgbClr val="3B82F6"/></a:accent2><a:accent3><a:srgbClr val="22C55E"/></a:accent3><a:accent4><a:srgbClr val="F59E0B"/></a:accent4><a:accent5><a:srgbClr val="EF4444"/></a:accent5><a:accent6><a:srgbClr val="8B5CF6"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>'''


def slide_xml(_width=0, _height=0):
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Slide"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="Page"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'''


def slide_rels():
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>'''


def make_pptx(images, output_pptx, title):
    # Slides each refer to their own media/imageN.png; use per-slide relationship files.
    with zipfile.ZipFile(output_pptx, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", pptx_content_types(len(images)))
        z.writestr("_rels/.rels", '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>''')
        z.writestr("ppt/presentation.xml", pptx_presentation(len(images)))
        z.writestr("ppt/_rels/presentation.xml.rels", pptx_presentation_rels(len(images)))
        z.writestr("ppt/slideMasters/slideMaster1.xml", pptx_master())
        z.writestr("ppt/slideMasters/_rels/slideMaster1.xml.rels", pptx_master_rels())
        z.writestr("ppt/slideLayouts/slideLayout1.xml", pptx_layout())
        z.writestr("ppt/slideLayouts/_rels/slideLayout1.xml.rels", pptx_layout_rels())
        z.writestr("ppt/theme/theme1.xml", pptx_theme())
        z.writestr("docProps/core.xml", core_props(title))
        z.writestr("docProps/app.xml", '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>FileForge</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat></Properties>''')
        for index, image in enumerate(images, start=1):
            width, height = png_size(image)
            z.writestr(f"ppt/slides/slide{index}.xml", slide_xml(width, height))
            z.writestr(f"ppt/slides/_rels/slide{index}.xml.rels", slide_rels().replace("../media/image1.png", f"../media/image{index}.png"))
            z.write(image, f"ppt/media/image{index}.png")


def make_pptx_from_pdf(input_pdf, output_pptx, tmp_dir):
    render_dir = Path(tmp_dir) / "rendered-pptx"
    render_dir.mkdir(parents=True, exist_ok=True)
    images = render_pages(input_pdf, render_dir)
    make_pptx(images, output_pptx, Path(input_pdf).name)


def main():
    if len(sys.argv) != 5:
        print("Usage: pdf_office.py <word|powerpoint> <input.pdf> <output> <workdir>", file=sys.stderr)
        return 2
    mode, input_pdf, output, workdir = sys.argv[1:]
    try:
        Path(workdir).mkdir(parents=True, exist_ok=True)
        if mode == "word":
            make_docx(Path(input_pdf), Path(output), Path(workdir))
        elif mode == "powerpoint":
            make_pptx_from_pdf(Path(input_pdf), Path(output), Path(workdir))
        else:
            raise RuntimeError("Unknown mode.")
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
