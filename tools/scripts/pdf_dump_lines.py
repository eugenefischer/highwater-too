import pymupdf as fitz,sys
d=fitz.open(sys.argv[1])
for i,p in enumerate(d):
  print(f'=== page {i+1}')
  rows=[]
  for b in p.get_text('dict')['blocks']:
    for l in b.get('lines',[]):
      t=''.join(s['text'] for s in l['spans'])
      if not t.strip(): continue
      f=l['spans'][0]['font'].replace('CourierPrime','CP')
      rows.append((round(l['bbox'][1],1),round(l['bbox'][0],1),round(l['bbox'][2],1),f,t))
  rows.sort()
  out=[]
  for r in rows:
    t=r[4]
    if 'filler' in t:
      if out and out[-1][0]=='F': out[-1][2]=r; out[-1][3]+=1; continue
      out.append(['F',r,r,1]); continue
    out.append(r)
  for o in out:
    if o[0]=='F': print(f'   [filler x{o[3]}: y {o[1][0]}..{o[2][0]} "{o[1][4]}".."{o[2][4]}"]')
    else: print(f'{o[0]:6} {o[1]:6} {o[2]:6} {o[3]:10} {o[4][:70]}')
  for img in p.get_images(): print('   image', img[2], img[3], p.get_image_rects(img[0]))
