import pymupdf as fitz,sys,collections
d=fitz.open(sys.argv[1])
for pn in range(1,6):
  ys=sorted({round(l['bbox'][1],1) for b in d[pn].get_text('dict')['blocks'] for l in b.get('lines',[]) if l['spans'][0]['text'].strip()})
  print(pn+1, len(ys), ys[:3], ys[-3:])
