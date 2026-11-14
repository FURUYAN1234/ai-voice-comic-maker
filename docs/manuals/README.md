# PDF source / PDF原稿

`manual_content.json` is the editable source; `build_manuals.py` renders A4 Japanese PDFs, page PNGs and bounds/link checks. / JSON原稿から日本語A4 PDF、全ページPNG、境界・リンク検査記録を生成します。

Use the existing cached Python environment with reportlab, Pillow, pypdf, pypdfium2 and pdfplumber; Japanese fonts are BIZ-UDGothicR/B on Windows. Set APP_MANUAL_OUTPUT to a private WSL work directory before running. / 既存のPython環境とWindowsのBIZ UDゴシックを使用。APP_MANUAL_OUTPUTにはWSLの作業領域を指定してください。

After inspecting every rendered page, copy only the two final PDFs into public/downloads/. Keep PNGs and QA receipts in the private work directory. / 全ページを確認後、完成PDF2件だけをpublic/downloads/へ配置し、PNGと検査記録は非公開の作業領域へ残します。
