from pathlib import Path
import os,json,hashlib
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph,Table,TableStyle
from pypdf import PdfReader
import pypdfium2 as pdfium
import pdfplumber
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
DATA=json.loads(Path(__file__).with_name('manual_content.json').read_text(encoding='utf-8'))
OUT=Path(os.environ['APP_MANUAL_OUTPUT']);OUT.mkdir(parents=True,exist_ok=True)
RENDER=OUT/'renders';RENDER.mkdir(exist_ok=True)
pdfmetrics.registerFont(TTFont('JP','C:/Windows/Fonts/BIZ-UDGothicR.ttc',subfontIndex=0))
pdfmetrics.registerFont(TTFont('JPB','C:/Windows/Fonts/BIZ-UDGothicB.ttc',subfontIndex=0))
pdfmetrics.registerFontFamily('JP',normal='JP',bold='JPB')
W,H=A4;M=45;CW=W-2*M;INK=HexColor('#17354a');TEAL=HexColor('#087c86')
styles={'text':ParagraphStyle('text',fontName='JP',fontSize=11,leading=19,textColor=INK,wordWrap='CJK'),'small':ParagraphStyle('small',fontName='JP',fontSize=9,leading=15,textColor=TEAL,wordWrap='CJK'),'heading':ParagraphStyle('heading',fontName='JPB',fontSize=14,leading=23,textColor=TEAL,wordWrap='CJK'),'cell':ParagraphStyle('cell',fontName='JP',fontSize=10,leading=17,textColor=INK,wordWrap='CJK')}
def para(text,style='text'):return Paragraph(escape(text),styles[style])
def build(kind):
 pages=DATA[kind];title=DATA['app']+(' 操作マニュアル' if kind=='manual' else ' API設定ガイド');p=OUT/(DATA['stem']+('-manual.pdf' if kind=='manual' else '-api-guide.pdf'));c=canvas.Canvas(str(p),pagesize=A4);c.setTitle(title);c.setAuthor(DATA['app']);layout=[]
 for i,page in enumerate(pages,1):
  c.setFillColor(TEAL);c.rect(0,H-6,W,6,fill=1,stroke=0);c.setFont('JPB',9);c.drawString(M,H-34,DATA['app']+' | '+('操作ガイド' if kind=='manual' else 'API準備・接続ガイド'));y=H-66
  for text,style,gap in [(page['title'],'heading',12),(page['lead'],'small',20)]:
   o=para(text,style);h=o.wrap(CW,H)[1];o.drawOn(c,M,y-h);y-=h+gap
  for b in page['blocks']:
   typ=b[0]
   if typ=='rows':
    o=Table([[para(x,'cell') for x in row] for row in b[1]],colWidths=[CW*.45,CW*.55]);o.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),HexColor('#dff0f0')),('LINEBELOW',(0,0),(-1,-1),.5,HexColor('#c6d9df')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10)]));h=o.wrap(CW,H)[1];o.drawOn(c,M,y-h);y-=h+18
   elif typ=='box':
    o=para(b[1]);h=o.wrap(CW-24,H)[1];c.setFillColor(HexColor('#edf6f6'));c.roundRect(M,y-h-24,CW,h+24,7,fill=1,stroke=0);o.drawOn(c,M+12,y-h-12);y-=h+42
   else:
    o=para(b[1]+(' →' if typ=='link' else ''),'small' if typ=='link' else typ if typ in styles else 'text');h=o.wrap(CW,H)[1];o.drawOn(c,M,y-h)
    if typ=='link':c.linkURL(b[2],(M,y-h,M+CW,y),relative=0,thickness=0)
    y-=h+(9 if typ=='link' else 15)
  assert y>=62,(title,i,y)
  c.setFillColor(INK);c.setFont('JP',8);c.drawString(M,31,'v'+DATA['version']+'対応 | 2026年11月14日 | A4 日本語版');c.drawRightString(W-M,31,f'{i:02d} / {len(pages):02d}');layout.append({'page':i,'bottom_y':y});c.showPage()
 c.save();return p,layout
def verify(p,layout):
 r=PdfReader(p);assert len(r.pages)==len(layout);text='\n'.join(pg.extract_text() for pg in r.pages);assert DATA['version'] in text
 with pdfplumber.open(p) as book:
  for pg in book.pages:
   assert abs(pg.width-W)<1 and abs(pg.height-H)<1
   assert all(30<=ch['x0'] and ch['x1']<=W-30 and ch['top']>=0 and ch['bottom']<=H for ch in pg.chars)
 links=[]
 for pg in r.pages:
  for a in pg.get('/Annots',[]):
   url=a.get_object().get('/A',{}).get('/URI')
   if url:assert str(url).startswith('https://');links.append(str(url))
 doc=pdfium.PdfDocument(p);renders=[]
 for i,pg in enumerate(doc,1):
  png=RENDER/(p.stem+f'-{i:02d}.png');pg.render(scale=1.25).to_pil().save(png);renders.append(png)
 for start in range(0,len(renders),4):
  sheet=Image.new('RGB',(1000,1420),'#dce6e8')
  for j,f in enumerate(renders[start:start+4]):
   im=Image.open(f).convert('RGB');im.thumbnail((500,707));sheet.paste(im,((j%2)*500,(j//2)*710))
  sheet.save(RENDER/(p.stem+f'-sheet-{start//4+1}.png'))
 return {'filename':p.name,'version':DATA['version'],'pages':len(layout),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'links':links,'layout':layout,'bounds':'pass','visual':'pending'}
if __name__=='__main__':
 reports=[verify(*build(kind)) for kind in ['manual','api']];(OUT/'manual-qa.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(reports,ensure_ascii=False))
