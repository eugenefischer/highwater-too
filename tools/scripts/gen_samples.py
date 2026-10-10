import zipfile, json, zlib, struct, sys, os
out = sys.argv[1]

def filler(zone, n):
    """Action/paragraph lines totalling exactly n lines (screenplay: blank-separated)."""
    paras = []; k = 1; lines = 0
    while lines < n:
        remaining = n - lines - (1 if paras else 0)
        if remaining == 2:
            paras.append(f"Zone {zone} filler {k:02d}a.\nZone {zone} filler {k:02d}b."); lines += 2 + (1 if len(paras) > 1 else 0)
        else:
            paras.append(f"Zone {zone} filler {k:02d}."); lines += 1 + (1 if len(paras) > 1 else 0)
        k += 1
    assert lines == n, (zone, n, lines)
    return "\n\n".join(paras)

nav = {"sceneHeaders":True,"sectionHeaders":True,"synopses":True,"notes":True,"images":True,"links":True,"referenceLinks":True,"includedFiles":True,"markers":False}

def write_bundle(path, name, textname, text, utype, template, extra=None):
    info = {"version":2,"transient":False,"type":utype,
            "com.quoteunquoteapps.highland2":{"templateName":template,"showSynopses":False,"printParagraphNumbers":False,"sidebarWidth":0,"currentTabIndex":-1,"cursorPosition":0}}
    root = name + ".textbundle/"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(root+"characters.json", "[]")
        z.writestr(root+"navigatorFilters.json", json.dumps(nav, separators=(",",":")))
        z.writestr(root+textname, text)
        z.writestr(root+"info.json", json.dumps(info, separators=(",",":")))
        z.writestr(root+"sprints.json", "[]")
        for k, v in (extra or {}).items():
            z.writestr(root+k, v)

# ---------- Screenplay ----------
sp = f"""Title: Screenplay Edge Cases
Credit: generated for testing by
Author: Claude
Draft date: 2026-10-09

{{{{HEADER: %# | %p}}}}
{{{{FOOTER: Left | Centre | Right}}}}

# Act One

= Synopsis: Act One sets up every special element.

INT. TEST KITCHEN - DAY #5#

[[Note: does this note print?]]

Brenda and Carl stand at the counter.

BRENDA
Are you coming?

CARL^
I'm already here.

BRENDA
(whispering)
Quiet.

CARL^
I will be quiet only once you explain to me why we are whispering in our own kitchen at noon.

@McCLANE
A forced character with lowercase letters.

!INT. THIS IS FORCED ACTION, NOT A SCENE HEADING

~This is a lyric line
~And this is another

{{{{INCLUDE: IncludedScene.fountain}}}}

===

{filler("A1", 51)}

INT. ZONE A1 HEADING ON SECOND-TO-LAST LINE - DAY

Action after the A1 heading.

===

{filler("A2", 52)}

INT. ZONE A2 HEADING ON LAST LINE - DAY

Action after the A2 heading.

===

{filler("B", 47)}

BRENDA
Dialogue line one.
Dialogue line two.
Dialogue line three.
Dialogue line four.
(beat)
Dialogue line five.
Dialogue line six.
Dialogue line seven.

===

{filler("C", 53)}

CUT TO:

INT. AFTER THE ZONE C TRANSITION - DAY

Action after the transition.

===

INT. ZONE D SCENE THAT RUNS ACROSS A PAGE BREAK - NIGHT

{filler("D", 81)}

# Act Two

= Synopsis: Act Two checks the section title in the header.

EXT. ACT TWO STREET - NIGHT

Carl walks alone.

CARL
That's the end of the test."""

write_bundle(os.path.join(out, "ScreenplayEdgeCases.highland"), "ScreenplayEdgeCases", "text.fountain", sp,
             "com.quoteunquoteapps.fountain", "Screenplay")
with open(os.path.join(out, "IncludedScene.fountain"), "w") as f:
    f.write("INT. INCLUDED SCENE - DAY\n\nThis scene comes from an included file.")

# ---------- Manuscript ----------
def mfill(zone, n):
    return "\n\n".join(f"Zone {zone} filler paragraph {k:02d}." for k in range(1, n+1))

ms = f"""TL:Claude
	AI Generated Test Files
TR:About 900 words
CC:Manuscript Edge Cases
	
	by
	
	Claude

{{{{HEADER:|Claude / Manuscript Edge Cases / %p of %pp}}}}
{{{{FOOTER: %# | %p}}}}

{{{{TOC}}}}

# Chapter {{{{SERIES}}}}

This opening paragraph starts the first chapter of the manuscript test, long enough to wrap across more than one line so we can see the normal paragraph flow.

This second paragraph has _underline_, ~~strikethrough~~, +highlight+, a [[note that may not print]], an [inline link](https://highland2.app), and a [reference link][Highland].

[Highland]: https://highland2.app

> This block quote is deliberately long so that it wraps across at least four lines in the printed manuscript, which lets us measure its left indent, whether it has a right indent as well, how its lines are spaced, and whether the first line of the quote is indented like a normal paragraph or not at all.

This paragraph follows the long quote.

> This is the first paragraph of a two-paragraph block quote.
>
> This is the second paragraph of the same block quote.

This paragraph follows the two-paragraph quote.

* Star list item one
* Star list item two

- Dash list item one
- Dash list item two

1. Numbered item one
2. Numbered item two

Term :: Definition of the term
Another term :: Another definition

| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |

= A synopsis line that may not print.

![Test image](assets/test-image.png)

* * *

This paragraph follows a scene break.

===

{mfill("H1", 20)}

# Chapter {{{{SERIES}}}}

This chapter heading should land on the last line of its page.

{{{{PAGENUMBER: 10}}}}

===

{mfill("H2", 19)}

# Chapter {{{{SERIES}}}}

This chapter heading should land on the second-to-last line of its page. The page before it was numbered from 10 onwards.

This is the final paragraph of the manuscript test."""

def png(w, h):
    rows = b"".join(b"\x00" + b"".join((bytes((40,120,200)) if (x//20+y//20)%2 else bytes((230,230,230))) for x in range(w)) for y in range(h))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t+d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")

write_bundle(os.path.join(out, "ManuscriptEdgeCases.highland"), "ManuscriptEdgeCases", "text.md", ms,
             "net.daringfireball.markdown", "Manuscript", {"assets/test-image.png": png(200, 100)})
print("ok")
