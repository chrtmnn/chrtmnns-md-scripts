*toc aktualisieren:*
```bash
npx markdown-toc -i *.md
```
```bash
for f in *.md; do npx markdown-toc -i "$f"; done
```
*md2pdf:*
```bash
npx md-to-pdf *.md
```
```bash 
npx md-to-pdf *.md --stylesheet pdf.css
```