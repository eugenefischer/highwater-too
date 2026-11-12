# Changelog

## 0.6.15

- Writing History: the selected save is let go when you switch to another panel, press Escape, or click beside the saves. Double-click and Enter no longer compare; the Compare button does.
- The Writing History's help is rewritten: shorter, in plain words, and organised by task (the list, comparing or going back, the bottom of the panel, more actions). It now explains what +0 means: the word count didn't change, though something else did (a word swapped for another, punctuation, the Bin, the Scratchpad, an image or the template). Saves that change nothing at all are still not recorded.

## 0.6.14

- The Writing History panel has a ? button at its top: help on what the history is and what every control does, in a popover beside the sidebar (Escape or a click elsewhere closes it). It is Highwater's own feature, so there is no Highland 2 documentation for it.
- Tooltips on the buttons that appear on a selected save (Compare with Now, Revert to This Save…), and on every other button made by the sidebar (the Bin's, Assets', the history's): the page's own tooltips now reach controls added after it opened, since a webview's title tooltips don't always show.

## 0.6.13

- The Writing History panel, redone in Highland's way: saves under a heading for each day (TODAY, YESTERDAY, NOV 10, 2026), each with its time, kind and change in words. A click selects a save, which shows Compare and Revert in place of its word change; a double-click or Enter compares, and the arrow keys move through the saves.
- Its foot shows the state: "Recording · last save 3:42 PM", "Paused for this document" or "Writing history is off", and the mirror ("Mirrored 3:45 PM", "Not mirrored yet" with the reason on hover, or "Mirror needs you to sign in", which signs in when clicked). Beside it, the record button turns the history off or on for this document, the export button exports it, and the gear opens a small menu in the page with the rest (Connect to a Work's History…, Link Writing History to This File, the mirror's actions including signing in and out, and the history folder's). No more VS Code lists at the top of the window.
- Tooltips on buttons near the foot of the window show above them.

## 0.6.12 (branch m16-sidebar)

- The Highwater Too icon stays in the activity bar while the Highland-Style Editor is in front (EJ preferred it to coming and going): a sixth view, **Highland-Style Editor**, shows there in place of the five hidden ones, with a note that they are in the editor's own sidebar and a link to show or hide it (⌘0).
- Whenever a Highland-Style Editor is given focus (switching to its tab, or clicking back into the page), VS Code's Highwater Too sidebar closes if it is open. Other sidebars (the Explorer, Search…) are left alone.

## 0.6.11 (branch m16-sidebar)

- VS Code's own Highwater Too views (Navigator, Bin, Assets, Writing History, Works) are hidden while the Highland-Style Editor is in front, since its sidebar has them all; with every view hidden, VS Code also hides the Highwater Too icon in the activity bar. They come back for the text editor (the code button) and other files.
- Opening a document in the Highland-Style Editor no longer switches VS Code's sidebar to Highwater Too (highwater.showSidebarOnOpen now applies to the text editor only); "Show History" in the first-run notice opens the editor's Writing History panel there.

## 0.6.10 (branch m16-sidebar)

- Dragging a Bin card (or an image) as in Highland 2: what follows the pointer is a small, nearly invisible outline, so the drop caret shows through; and dropping it leaves the typing cursor where it was.

## 0.6.9 (branch m16-sidebar)

- **Writing History** is in the Highland-Style Editor's sidebar (the clock icon; the status bar's history item opens it too): this document's saves, newest first, with when, what kind (Save, Autosave, Revert…) and the file. Click a save to compare it with the text as it is now; its ↺ reverts to it (after asking). The ⋯ at the foot has the rest: turning the history off or on for this document, Connect to a Work's History…, Open Work from History…, Export, syncing, the mirror, and the history's folder and location.
- **Works** is in it too (the books icon): every work in the writing history, with where it is. Click a work here to open it; the arrow beside one lists its saves (click one to read it); ⋯ on a work offers Restore…, Remove from This Computer… and Delete Writing History…. The Filter narrows the list; ↻ syncs with the mirror and refreshes.

## 0.6.8 (branch m16-sidebar)

- A Bin item or image dragged into the text goes in exactly where you let go, mid-sentence if that's where, as in Highland 2; the drop caret shows that spot as you drag.

## 0.6.7 (branch m16-sidebar)

- A caret shows where a Bin item (or an image from Assets) will land while you drag it over the text: at the start of the line it's over, or after its end, whichever is nearer. Text dragged within the page shows a drop caret too.

## 0.6.6 (branch m16-sidebar)

- Bin items are written in Highland 2's popover: + (or double-clicking a card, or Enter on a selected one) opens a plain-text editor beside the sidebar, its arrow pointing at the card. What you type is saved as you go; Escape, ⌘Enter or a click outside closes it.

## 0.6.5 (branch m16-sidebar)

- Undo and redo cover the Bin, as in Highland 2: ⌘Z puts back text dragged into the Bin (and takes the item out), puts a card dragged into the page back in the Bin, and brings back a deleted card; ⇧⌘Z does them again. Cut to Bin and Copy to Bin (⌥⌘X, ⌥⌘C), +, and reordering cards are undoable too. ⌘Z works with the text or the sidebar in front (in the Scratchpad, or a card being edited, it undoes that box's typing).
- The Bin's export button does what Highland's does: a new plain-text document with every item, in order, with a blank line, "---" and a blank line between them. The Bin keeps its items.

## 0.6.4 (branch m16-sidebar)

- The Bin matched to Highland 2's selected card: a selected card is shaded lighter (no outline), with a circled × at its top right. Highland's + (a new item, opened for editing) and its export button ("Export Bin contents to a new document": every item, a blank line between) are back at the Bin's foot beside the Filter.

## 0.6.3 (branch m16-sidebar)

- The Bin's cards look and work like Highland 2's: each shows the item's own text, up to six lines and then "…", in a card at least four lines tall. Click a card to select it: it is outlined, and a delete button appears at its top right (Delete or Backspace works too, and ↑↓ move the selection). Double-click (or Enter) edits it in place. The Filter at the foot narrows the cards by their words. No more arrow or + buttons.
- Assets lose their arrow button too: drag an image into the text to use it.

## 0.6.2 (branch m16-sidebar)

- Dragging, as in Highland: text dragged from the page onto the **Bin** moves there (cut; a whole paragraph takes its blank line with it, ⌘Z puts it back); a Bin card dragged into the page leaves the Bin; text dragged onto the **Scratchpad** is copied (at its cursor, or at the end), and the page keeps it.

## 0.6.1 (branch m16-sidebar)

- The **Bin** is in the Highland-Style Editor's sidebar (⌘2): Highland's cards, each with its first line and how it goes on.
  - Drag text from the page onto it to keep a copy as a new item, with no Shift: the page and the Bin are one view. ⌥⌘X and ⌥⌘C still cut and copy to it.
  - Drag a card into the page to put it back: it goes in as a paragraph of its own, before or after the line it lands on. The arrow on a card inserts it at the cursor.
  - Drag cards to reorder them; click one to edit it in place (saved as you type); + makes a new one; × deletes one (after asking).
- **Assets** are in it too (⌘4): each image with a small picture, its kind, size and file size. Drag one into the page to put in its reference (as a paragraph), or use its arrow; double-click to open it; + adds images; × deletes one. Images dragged in from Finder need Shift held (VS Code's rule for views like this).
- ⌘3 shows Statistics' place (it comes with M11).

## 0.6.0 (branch m16-sidebar)

- Highland 2's sidebar, inside the Highland-Style Editor: its row of icons at the top (Navigator, Bin, Statistics, Assets, Scratchpad, then Highwater's Writing History and Works) and one panel below. Drag its right edge to make it wider or narrower; the button at the top bar's left, or ⌘0, shows or hides it. Where you left it is kept for every document.
- The **Navigator** is in it, working on the page's own text: click to go there, drag a scene or section to move it (⌘Z puts it back), filter at the foot, and choose what it lists with the eye. ⌘1 shows it.
- The **Scratchpad** is in it, as in Highland: plain text beside the script, saved as you type (in the .highland file, or with a plain file's writing history), with Highland's button at the bottom right to export it to a new document. ⌘5 shows it (Open Scratchpad too).
- The Bin, Assets, Writing History and Works panels point to VS Code's sidebar for now; they move into this one next. Statistics come with M11.

## 0.5.12

- Tooltips on the Highland-Style Editor's top bar, in Highland 2's words: Show Editor, Show Preview, Choose the document's template, Choose a theme for the app (and Page size with the pages).
- Manuscript's other Template Options, measured from Highland's PDFs: **Indent leading paragraphs** (every paragraph indented, the first after a heading or scene break too) and **Add space before section headers** (on by default: a heading that opens a page starts a third of the way down; off, at the top). In the Document Template window and in Settings.
- Manuscript: a heading no longer prints below the page's last line when several come in a row; it moves to the next page, as in Highland. List items marked "+" print "+", as Highland's do.
- Multi-Cam with Uppercase action off checked against Highland's PDF.

## 0.5.11

- Highland 2's **Document Template** window: the template button in the Highland-Style Editor's top bar opens it. The templates by group on the left; on the right the chosen one's first page (your text, laid out live), its description and its **Template Options**. Picking a template changes the document's.
- Template Options, as in Highland: each template's fonts (Headers and Body), and Multi-Cam's Uppercase action. Like Highland's they apply to every document, so they are settings too (`highwater.templates.<template>.<option>`); changing one lays open pages out again.
  - Scripts and the Manuscript in Courier, Highland Sans, New York or Times New Roman, measured against Highland's PDFs of the probes in each font: Courier's characters are a hair wider than Courier Prime's (a 65-character manuscript line wraps), Times New Roman's lines are 12.51 pt, widths are Highland's in points.
  - Prose templates in any of their fonts: lines move with the font's height, and Times New Roman's line gap makes taller lines.
  - TeX Gyre Schola, Cormorant Garamond and Spectral now come with Highwater Too (open licences, the versions Highland ships). Baskerville and Avenir Next Condensed (macOS) print when installed, else in Tinos and Lato.
  - Known differences: list markers in fonts other than the template's own sit a few points off Highland's; in Times New Roman, some script pages break a line differently (Highland lets speeches run a line or two lower).
- Manuscript's Indent leading paragraphs and Add space before section headers options aren't there yet (they await Highland's PDFs).

## 0.5.10

- Print options checked against Highland 2 in every template (each probe exported with every option ticked):
  - Scripts: inline notes and synopses print at the scene heading margin; the blank lines around a printed note still count when deciding whether a page break (`===`) spills a blank page. Screenplay, Stage Play and Graphic Novel now match line for line with every option on.
  - Manuscript title page: Source sits two lines lower after the author, and the bottom-right shows Date only when there is no Draft Date. The first chapter heading drops down the page even after a title page.
  - Prose: printed notes go on their own line at the left margin and are numbered; synopses never start in a page's extra last-line space; paragraph numbers sit at each template's own height beside the text. MLA Report ignores every print option but Title Page, as Highland's does.
  - Paragraph numbers: a paragraph that starts on a page's last line (or below the margin) and carries over gets no number; link definitions are not numbered; a quote or a run of lyric lines is numbered once.
  - Known differences: Highland numbers each table row (including the `:---` row) and the scene break, numbers no large headings in Wiki, Bulletin (H3) and Manuscript chapters, and leaves term definitions unnumbered; we don't copy these yet.

## 0.5.9

- Novel and Wiki now match Highland 2 too: every prose template prints its probe line for line, apart from nested list items (Highland prints them flat, a quirk we fix).
  - Novel's scene break (three stars) moves to the next page whole instead of splitting across two; lists wrap 36 pt short of the right margin, as Highland's do; a paragraph after centred or right-aligned text is indented.
  - Centred and right-aligned lines never start in a page's extra last-line space (Wiki).

## 0.5.8

- Prose templates, measured with the real macOS fonts (Georgia, Times New Roman, Avenir Next): two page rules found, so far more lines land where Highland 2 puts them:
  - A list item after the first may start in the page's last line space, as a paragraph may; a list's first item may not. (Article, Bulletin and Modern Standard had moved a line to the next page early.)
  - "===" after a full page leaves an empty page, as in the Manuscript; in templates that print the empty lines between paragraphs, the one before it counts. (Speech had one page too few.)
  - Now matching Highland's probe line for line, apart from nested list items (printed flat by Highland, a quirk we fix): Speech 255 of 257 lines, Article 244/246, Modern Standard 241/243, Bulletin 240/242, MLA Report 241/243, Treatment 247/249, Wiki 242/247. Novel (232/250) is next.

## 0.5.7

- The pages (⌘E) open at 100% instead of Fit Width; the size menu in the top bar still offers Fit Width and the others.

## 0.5.6

- A script opened in the text editor switches to the Highland-Style Editor (when it's the default) even on a slow computer: it used to look once, 300 ms after the tab opened, and stay as text if VS Code hadn't yet made the tab active or given the document its language. It now keeps looking for up to three seconds.

## 0.5.5

- Top bar: the dot under Text or Pages sits halfway between the icon and the bar's foot (it nearly touched the foot).
- Live Margins (⌘L, the text editor) no longer indents manuscript paragraphs, as Highland's editor doesn't (it indents them only on the page). Quotes sit three characters in, as in the Highland-Style Editor.

## 0.5.4

- **Exact page counts:** the counts at the foot of the Highland-Style Editor and the status bar now show the real number of pages: the document is laid out with its print template and options (as for the PDF, but without drawing it) a second after you stop typing. Every page counts, the title page too, as in Highland (Astounding: 57). Until the first layout is done, no page count shows. Screen time follows the exact count.

## 0.5.3

- **Highland's top bar** in the Highland-Style Editor:
  - At the left, **Text** and **Pages** switch between the text and the printed pages (as ⌘E), with a dot under the one showing. They replace the Preview button in VS Code's title bar for this editor.
  - At the right, the **template** menu (now with the text as well as the pages) and **Choose Theme** (Highland's dashed circle). Revision Mode and the Sprint timer will join them when they're built.
  - With the pages showing, the page size and "Page x of y" sit in the middle of the same bar.
- **Highland's counts** at the foot of the text: characters, words and pages (the page count is an estimate; the pages have the exact one).
- Manuscripts in the Highland-Style Editor: paragraphs are no longer indented at all, as in Highland's editor (it indents them only on the page). Quotes sit three characters in, not italic, as Highland shows them.

## 0.5.2

- Manuscripts in the Highland-Style Editor: an indented paragraph indents only its first line again; its wrapped lines go back to the left margin, as on the page. (Every line had been indented, so ordinary paragraphs looked like block quotes.)

## 0.5.1

- **Check Spelling While Typing** in the Highland-Style Editor, as in Highland 2 (off by default; turn it on from the title bar's ⋯ menu, the Command Palette or `highwater.spellCheck`). It uses American English, with Hunspell's dictionary from SCOWL bundled.
  - Misspelled words get red dots under them, as Highland draws them; the word you're typing waits until you leave it.
  - Right-click a misspelled word for guesses (closest first), **Ignore Spelling** (for this tab until it's closed) or **Learn Spelling** (kept in `highwater.spellingWords` for every document).
  - ⌘; (Go to Next Misspelling) selects the next misspelled word.
  - Not checked: character names (from the cues, in the cue or anywhere else), scene-heading prefixes, `{{directives}}`, title-page keys, web and e-mail addresses, link targets and omitted text.
  - The text editor (the code button) isn't checked; use a spelling extension such as Code Spell Checker there.

## 0.5.0

- **M15 is on main:** the m15-editor branch (0.3.0–0.4.19) is merged, making the Highland-Style Editor the default way to open documents. It has Highland's writing keys, completion, themes, the Navigator in Highland's style, paragraph numbers, and the printed pages in place with all of Highland's print options. Nothing else changes from 0.4.19.

## 0.4.19 (m15-editor branch)

- While the pages are showing in the Highland-Style Editor, clicking in the Navigator (or a search result) goes to that place in the pages instead of switching back to the text. The cursor moves there too, so ⌘E returns to the text at that place.

## 0.4.18 (m15-editor branch)

- **All of Highland 2's print options now print,** in the preview, Export PDF and Save As PDF, matched to Highland's own PDFs:
  - **Color Revisions:** revised text in its revision's colour (a bare `{{REVISION}}` has none).
  - **Star Revisions:** an asterisk in the right margin beside every line with revised text.
  - **Paragraph Numbers:** small blue numbers in the left margin, numbered as in the editor.
  - **Synopses:** in grey, half an inch in, each a paragraph of its own.
  - **Notes:** in blue, brackets and all. A note on a line of its own sits between the paragraphs around it in a script, and opens the next paragraph in a manuscript, as Highland prints them.
  - Measured in the Screenplay and Manuscript templates; the other scripts and the prose templates use the same rules.
- With notes not printed, a note between two spaces now leaves one space, not two, as in Highland.
- A bare `{{REVISION}}` tag (no colour), which Highland writes, is now read as a revision.

## 0.4.17 (m15-editor branch)

- **Preview in place, as in Highland 2:** in the Highland-Style Editor, ⌘E (or the Preview button) shows the printed pages in the same tab instead of the text, and ⌘E again goes back. Going to the pages opens them where your text was; coming back shows the text at what was on screen in the pages, with the cursor where you left it. Double-clicking a line in the pages goes back to the text with the cursor on that line.
  - At the top: page size (fit width or a percentage), "Page x of y" and the print template.
  - At the foot, as Highland's: Color Revisions, Star Revisions, Paragraph Numbers, Synopses, Notes and Title Page, and Save As PDF (and Save As Word for manuscripts). The choices are saved with the document where Highland 2 keeps them. Title Page works now; the others can't be ticked yet, as Highwater Too doesn't print them yet.
- The side-by-side Preview remains for the text editor.

## 0.4.16 (m15-editor branch)

- Navigator: holding a dragged scene near the list's top or bottom edge (or past it) keeps it scrolling, faster the nearer the edge, until you move away or reach the end. Before, it scrolled only while the mouse moved.

## 0.4.15 (m15-editor branch)

- **Paragraph numbers,** as in Highland 2: **Show or Hide Paragraph Numbers** (in the Highland-Style Editor's title-bar ⋯ menu, or the Command Palette) numbers every line with text in the margin. A wrapped line counts once; a cue, a parenthetical and each line of dialogue count separately; the title page, notes and omitted text on lines of their own, and directives such as `{{HEADER}}` and markers aren't numbered. The setting is `highwater.paragraphNumbers`.
- ⌃G in the Highland-Style Editor is now **Go to Paragraph…**: type a paragraph number (whether or not the numbers are showing).

## 0.4.14 (m15-editor branch)

- The Navigator's header no longer has a filter button: the eye beside the Filter field at its foot chooses which kinds are listed.

## 0.4.13 (m15-editor branch)

- **Search results in `.highland` documents** go to the line you clicked: in the text editor if that's where you have the document open, otherwise in the Highland-Style Editor. Before, the click went to the `.highland` file's opener, which didn't know the line and opened a second tab at the start.
- Switching between the text editor and the Highland-Style Editor (the code and book buttons) keeps the cursor where it was.
- Opening a document that's already open as text (from the Explorer or the Works panel) goes to that tab instead of opening another.

## 0.4.12 (m15-editor branch)

- Completion: choosing a scene-heading prefix (INT., EXT., INT./EXT. …) from the list now goes straight on to the script's locations, as typing the period does (both editors).

## 0.4.11 (m15-editor branch)

- When a document is given its Highwater language just as it opens, VS Code replaces the document behind the editor; the Highland-Style Editor now follows the new one, so the panes can't lose track of its edits.
- A marker inside a scene heading or section no longer shows as part of its name in the Navigator.

## 0.4.10 (m15-editor branch)

- **Themes for the whole window:** each of Highland 2's themes is also a VS Code colour theme ("Highwater Classic", "Highwater Dracula" and so on), colouring the panes, tabs, title bar, status bar, menus and the text editor to match. **Choose Theme…** now switches the window's colour theme along with the page and the Navigator (try each as you move through the list; Escape puts both back). **Match VS Code** restores the colour theme you had before. To theme only the page and the Navigator, turn off `highwater.themeWindow`. The themes can also be picked from VS Code's own colour theme list.

## 0.4.9 (m15-editor branch)

- Line spacing in the Highland-Style Editor matches Highland 2's (1.3 times the text size; was 1.5).

## 0.4.8 (m15-editor branch)

- **Text size in the Highland-Style Editor:** larger by default, about the size Highland 2 shows (VS Code's editor font size × 1.4, was × 1.1). ⌘+ and ⌘− make it larger or smaller a step at a time while the Highland-Style Editor is in front (elsewhere they still zoom the window), and ⌥⌘0 goes back to the default. The page column grows with the text, so lines still break as on the page. The setting is `highwater.fontSize` (pixels; 0 for the default).

## 0.4.7 (m15-editor branch)

- Navigator: dragging a scene or section back over where it already is hides the drop line, and letting go there leaves it where it was. Before, the line jumped to the nearest place that would move it, so a drag couldn't be undone by dropping it back.

## 0.4.6 (m15-editor branch)

- **Highland's themes:** Classic, Clean, Winter, Kermit, Solarized Light, Dark Mode, Dracula, Material, Monokai, Solarized Dark and Transit, with Highland 2's colours for the page, text, scene headings, notes, cursor and selection in the Highland-Style Editor, and its sidebar colours in the Navigator. **Highwater Too: Choose Theme…** (also in the Highland-Style Editor's title-bar menu) tries each as you move through the list; Escape keeps the one you had. The setting is `highwater.theme`; **Match VS Code**, the default, keeps your VS Code colours. The other panes and the rest of the window keep VS Code's theme.
- The Find bar in the Highland-Style Editor is styled to match the page (and the theme), instead of CodeMirror's plain grey.

## 0.4.5 (m15-editor branch)

- The Bin and Assets panes come closer to Highland's (they stay VS Code panes, so text and images still drop onto them without holding Shift):
  - Bin items show how many words they hold and how they go on after their first line; hovering shows the whole item.
  - Assets are listed by name, with the file's kind, pixel size and file size beside it; hovering shows a preview of the image.

## 0.4.4 (m15-editor branch)

- Fixed: dragging a scene in the Navigator out of the pane and back lost the drop line (VS Code stops passing a webview the mouse once a browser drag crosses the rest of the window). The Navigator now follows the pointer itself: the line hides while you're outside the list and comes back when you return; letting go outside the list, or pressing Escape, cancels. The list scrolls when you drag near its top or bottom edge.

## 0.4.3 (m15-editor branch)

- **The Navigator in Highland's style:** a plain list of scenes in bold capitals, sections, synopses, notes and markers, with the one the cursor is in highlighted as you write (in either editor). Dragging a scene, section or heading shows a line where it will land; only places that would move it are offered. A Filter box at the foot finds items by their words, and the eye button beside it chooses which kinds are listed (as the title bar's filter button does).

## 0.4.2 (m15-editor branch)

- ⇧⌘I toggles Show Invisibles, as in Highland 2 (in both editors; part of Highland's shortcuts, `highwater.highlandShortcuts`).
- Fixed: a `.fountain` file (or a `.md` file Highwater handles) could open as text even though the Highland-Style Editor is the default.

## 0.4.1 (m15-editor branch)

- Fixed: with the Highland-Style Editor in front, Highwater Too's commands (Show Invisibles, Bold, Export PDF, Insert Marker and the rest) were missing from the Command Palette.

## 0.4.0 (m15-editor branch)

- **The Highland-Style Editor is now the default** for screenplays and manuscripts: `.highland` files, `.fountain` files and the `.md` files Highwater Too handles open in it. The code button in its title bar turns the tab into the text editor (and that document stays text until you close it); the book button turns it back. To open documents as text by default, turn off `highwater.highlandEditor`.
- Show Invisibles works in the Highland-Style Editor: spaces and tabs are marked and each line ends with ¬. It follows the same setting as the text editor, so turning it on or off applies to both.

## 0.3.9 (m15-editor branch)

- The Highland-Style Editor shows emphasis where it stands, as Highland does: **bold** in bold, *italic* in italics, underline, strikethrough and +highlight+, with [[notes]] and /* omitted */ text dimmed.
- Go to Line (⌃G) in the Highland-Style Editor.
- A search result in a document open in the Highland-Style Editor now shows the result's line there.
- Fixed: in a file with Windows line breaks (\r\n), typing in the Highland-Style Editor put text in the wrong place, further off the further down the file.

## 0.3.8 (m15-editor branch)

- One tab per document: the book and code buttons now switch the tab between the text editor and the Highland-Style Editor in place, as Reopen Editor With… does, keeping unsaved changes. Before, they opened a second tab, and closing either one asked to save or discard changes that the other was still showing.
- Opening a document that's open in the Highland-Style Editor (from the Explorer, the Works panel, Search or a save conflict) goes to that tab instead of opening it again as text (unless it has unsaved changes, when VS Code's text tab is left open).

## 0.3.7 (m15-editor branch)

- Completion in the Highland-Style Editor, as in the text editor: in a screenplay, start a line after an empty one in capitals and the characters who already speak are offered (most frequent first), with scene-heading prefixes and transitions; after `INT.` or `EXT.`, the script's locations, then times of day. ↑↓ choose, Enter or Tab accepts, Escape closes, ⌃Space asks.
- Fixed in both editors: while typing a scene heading's location, the half-typed location was offered as one of the script's locations.

## 0.3.6 (m15-editor branch)

- Bold, italic, underline, strikethrough, highlight and notes leave spaces at either end of the selection outside the markers (`**word** `, not `**word **`, which doesn't print as bold), in both editors.

## 0.3.5 (m15-editor branch)

- Highland's writing keys work in the Highland-Style Editor: ⌘B, ⌘I, ⌘U, ⌃+ (highlight), ⌘/ (note), ⌘Y (omit), ⌘⇧. (centre), ⌃U and ⌃⇧U (upper and lower case, of the selection or the word at the cursor), ⌃M (insert a marker), ⌃⌥M (next marker) and ⌘0 (sidebar). The Title Page Builder opens from it and returns to it.

## 0.3.4 (m15-editor branch, experimental)

- Fixed: clicking a scene in the Navigator, or a place in the Preview, right after the Highland-Style Editor opened could do nothing; the editor now scrolls there once it has finished opening.

## 0.3.3 (m15-editor branch, experimental)

- Fixed: with a text editor open in another group, the panes, status bar and Preview followed that text editor instead of the Highland-Style Editor you were writing in.

## 0.3.2 (m15-editor branch, experimental)

- The panes follow the Highland-Style Editor as they do the text editor: the Navigator, Bin, Assets and Writing History show its document, and so do the status bar (words, pages, selected words, template) and the Preview. Clicking a scene in the Navigator, or a place in the Preview, scrolls the Highland-Style Editor there; with scroll sync on, the Preview follows it as you scroll. Cut and Copy to Bin, inserting a Bin item or an image, the Scratchpad, Export Text and Export PDF work from it too.
- Highland's shortcuts for the Preview (⌘E), the Navigator, Bin, Assets and Scratchpad (⌘1, ⌘2, ⌘4, ⌘5) and Cut and Copy to Bin (⌥⌘X, ⌥⌘C) work in the Highland-Style Editor. The writing keys (⌘B, ⌘I, ⌘/ and the rest), completion and markers don't yet.
- The Preview and Export Text buttons appear in its title bar.

## 0.3.1 (m15-editor branch, experimental)

- Highland-Style Editor: lines now break exactly where they do on the page. CodeMirror's own line padding took most of a character's width off every line. In a window narrower than the page the column narrows as in Highland: dialogue keeps its indent and width while the space to its right shrinks, down to a column whose right edge is dialogue's; narrower than that, the page scrolls sideways.
- Find matches use VS Code's find colours, so they are easy to see.

## 0.3.0 (m15-editor branch, experimental)

- **Highland-Style Editor** (experimental, M15): a second editor for `.highland`, `.fountain`, `.md` and `.txt` files that lays text out as Highland 2 does. The page is a column as wide as the printed text, centred in the window, in Courier Prime; cues, parentheticals and dialogue are indented on every line, so wrapped dialogue stays in its column (35 characters wide; parentheticals 28). Open it with the book button in the editor's title bar or **Reopen Editor With…**; the code button switches back to the text editor. Edits, undo, saving and search work as in any editor; the text editor and Highland-Style Editor can be open on the same file at once. Turn the button off with `highwater.highlandEditor`.

## 0.2.20

- Two more bundled fonts, both free and built with the same character widths as the fonts they stand in for: **Gelasio** for Georgia (Article, Wiki) and **Tinos** for Times New Roman (MLA Report). Without the real fonts installed, these templates now break lines and pages almost exactly as Highland 2 does.

## 0.2.19

- The bundled fonts are now the exact versions Highland 2 ships, found in its app: Amiri 0.113, Lato 1.104, and two more under open licences, **Highland Sans** (Treatment) and **Merriweather** (the stand-in for Georgia and New York). Treatment now prints in its own font everywhere, and the Extension is smaller.
- On a Mac with Highland 2 installed, SF Pro Display (Bulletin) and New York (Speech) are taken from Highland's app.
- Closer prose layout, measured with Highland's own fonts: a link definition takes its blank line with it; a note leaves an empty line, as in Highland; the blank line after a table of contents isn't printed; a block-quote paragraph and a table row move to the next page whole; a list item never takes a page's last line on its own; a blank line at the foot of a page carries over to the next.
- `+` starts a list item, as `*` and `-` do.

## 0.2.18

- Fixed: the prose templates printed no title page for documents using Highland's Markdown title keys (TL, TR, CC, BL, BR), as manuscripts do. They are now placed as in Manuscript: TL and TR at the top corners, CC centred, BL and BR at the bottom corners, in the template's font.

## 0.2.17

- The eight prose templates: **Novel, Treatment, Modern Standard, Article, Bulletin, Speech, MLA Report and Wiki**, in Highland 2's fonts, sizes, margins, spacing and heading styles. These are a close match rather than line for line (Highland 2 lays them out with Apple's text system), so a line or page may break differently. Novel's first line after a heading is in small capitals, and its paragraphs are justified.
- Fonts: Amiri and Lato are now bundled with Courier Prime. Georgia, Times New Roman, Avenir Next, SF Pro Display, New York and Highland Sans are used when installed (including the copies inside Highland 2's app); otherwise a bundled font of the same kind prints instead, and Export PDF says so.
- Fixed in passing, as Highland 2's quirks: Article now prints level-3 headings, quotes wrap at the right margin, nested list items are indented, and Speech's custom footer no longer prints over the text.
- Lines of one quoted paragraph each start a new line when printed, as in Highland 2 (an attribution under a quote stays on its own line).

## 0.2.16

- **Plain Text** print template, matching Highland 2's: the text exactly as typed, markup and directives included, 65 characters wide and 54 lines a page, with no title page, header or page numbers. It is the default for plain-text documents, which now have the Preview and Export PDF too.

## 0.2.15

- **Multi-Cam** print template, measured against Highland 2's PDFs: the Screenplay margins, with action, lyrics and centred text in capitals, dialogue double-spaced, and parentheticals run into the dialogue line after them. A double-spaced speech never ends on a page's last line. Long speeches split across pages with (MORE) and (CONT’D) as in Screenplay; Highland 2 sometimes lets the rest of such a speech run off the bottom of the page, where it is lost in print, and Highwater doesn't.

## 0.2.14

- Two more print templates, measured against Highland 2's own PDFs: **Stage Play** (action in a column on the right, from 4 inches; wide dialogue from the left margin; character names and parentheticals between) and **Graphic Novel** (the Screenplay layout, with sections printed: `#` in capitals, bold and underlined, `##` and deeper plain). Choose them in the Preview or from the template in the status bar.
- Screenplay layout, from the new probes: an action that follows an action no longer starts on a page's last line, and an action with a word longer than the line is fitted to the page as Highland does.

## 0.2.13

- Copies are no longer mistaken for the work's file. A duplicated `.highland` file kept the original's ID, and a duplicated plain file matched its text, so both files saved into one history (with misleading word counts), shared one Bin and Scratchpad, and the Works panel flipped between them. Now, when the work's file is still there and still the work's, you're asked: Keep as a Separate Work, or Make This the Work's File. There is no default; until you choose, the copy's saves are not recorded and its Bin is its own. When the work's file is gone, the new file is the work's file moved, and the history follows it as before.
- A new file at a path a work used to have no longer joins that work silently: only a work's current path counts.
- Save As… from the conflict question makes a new document: the copy carries no writing-history ID and starts a history of its own.
- A plain file kept as a separate work gets its own ID in its Link Writing History note, if it had one.

## 0.2.12

- Internal: every question Highwater asks the writer now goes through one function, so the end-to-end tests can answer questions by script and check what was asked. The test-only shortcuts that skipped questions are gone, so the tests now run the same code the writer does. No change in behavior.

## 0.2.11

- Clearer wording when a file has newer saves from another computer: what this file is, when the newest version was saved, and what each choice does ("Keep This Version: carry on with the currently open file, edits included. When you next save, it becomes the newest version.").

## 0.2.10

- Fixed: character completion waited for an L or N in the name (CAMPBELL at "CAMPBEL", COLLEGE KID at "COL", INGRAM at "IN"). The documents' word pattern used Unicode letter classes, which VS Code compiles without the Unicode flag unless told to, so only the letters p, L and N (and a few marks) counted as parts of words. Words are now whole names, which also fixes ⌘D (select the word at the cursor) and other commands that act on the word at the cursor. (Double-click and ⌥←/⌥→ use a separate VS Code setting and were not affected.)
- The 0.2.5 change to completion (asking again after the first letter) is removed: it rested on a wrong explanation and was not needed.

## 0.2.9

- Preview: a scrollbar press now allows two seconds for the drag to start, so pressing and pausing before dragging still moves the editor.

## 0.2.8

- Fixed: 0.2.7 broke the Preview's sync. A press on the Preview's scrollbar marked a drag in progress, and the browser often never reports the release, so the Preview took every later scroll as yours and stopped following the editor (and a resize could move the editor again). A press now counts only while the scrolling it causes goes on.

## 0.2.7

- Fixed: while typing with the Preview open, the editor could jump. After a refresh the Preview kept its place by proportion, and at some widths its pages settled a pixel or so later; that settling was taken for the writer scrolling the Preview and sent to the editor. Now the editor leads: the Preview lines up with the editor's top line after every refresh and resize, and only scrolling you do in the Preview (wheel or trackpad, keys, its scrollbar) moves the editor.

## 0.2.6

- Fixed: with Live Margins on, transitions and other lines indented more than 43 characters had their margin cut short with "…" (VS Code's default limit for inlay hints; now off in Highwater documents).
- Known: while you type the first words of a line, VS Code may briefly show "…" at the left edge in place of part of the margin. VS Code holds margins before the cursor at their previous width while typing; it settles within about a second. Left as is; a Highland-style editor (M15) would not have it.

## 0.2.5

- **Changes made elsewhere** now ask as Highland 2 does: **Save Anyway** (keep your changes), **Revert** (keep the other application's), **Save As…**, or **Compare**. The version that loses is kept: as a save in the writing history noting it was set aside, or in the backups when the history is off.
- Fixed: images dragged from the Assets panel into the text arrived as the image file's address instead of an image. The panel's items carry their file's address, and VS Code inserted that; dropping a document's own image now inserts `![name](assets/name.png)`.
- Fixed: Bin cut and copy (⌥⌘X, ⌥⌘C, and the right-click items) did nothing in plain `.fountain` and `.md` files.
- Fixed: the Bin panel did not show a Bin item's changes after it was saved in its tab (or after Revert to This Save) in a `.highland` file.
- Fixed: character name completion often came only after most of the name was typed. At the first capital nothing is offered (it may be action), and VS Code took that as final for the word; it now asks again at the second letter.
- Reading time for prose is now 250 words a minute, as Highland 2 states it (was 230).
- Export Text offers plain text (`.txt`) as well as the document's own kind, and leaves out the note linking a plain file to its history.
- Conversions are also in the editor's “…” menu and the tab's right-click menu.
- The Move to Trash question after a conversion offers **Keep** instead of Cancel.

## 0.2.4

- **Connect to a Work's History…** (Writing History panel menu, Command Palette): joins the open document to another work's history, by your choice. It lists works whose file is no longer where it was saved, newest first, or every work. A document with a history of its own is joined to the work in one merge (both kept, no longer separable); one without continues the work from its current text, recorded as `Connect`. A confirmation spells this out first. This is for a `.highland` file that lost its link to its history: Highland 2 removes the link when it saves, so a file saved in Highland, then edited and renamed, starts a new history when VS Code next saves it.
- Fixed: **Delete Everywhere** did not always stick. A work fetched to a computer but never opened there survived the deletion on that computer and was pushed back to the mirror, so other computers could still restore it; and a computer that pushed before pulling could push a deleted work back. Deletion now goes by the work's branch, every pull, push or fetch applies the catalog's deletions first, and a push takes off the mirror any work recorded as deleted.
- Fixed: a moved plain file was only recognised when first saved, not when opened, if it was the first document opened in the session.
- Restore asks where to save before fetching, so a cancelled restore leaves nothing on this computer. Fetching a work deleted since the last sync says so instead of failing.
- The Works panel's Refresh brings the catalog up to date from the mirror first.

## 0.2.3

- **Newer saves from another computer:** when a sync brings newer saves of a work whose file is open here, or you switch to such a file, and the file is an older save, you are asked: **Update to the Latest** (the file, its Bin and its Scratchpad become the latest save) or **Keep This Version** (your next save goes back to it, recorded as a `Revert`). With unsaved changes, or changes since that save, **Open the Latest Beside It** takes the place of Update, and you are asked again when you next save. No choice is pre-selected; until you choose, the file's saves are not recorded. Nothing is asked when the file is the latest save, and each latest save is asked about once.
- **The panes follow the focused document:** Navigator, Bin, Assets and Writing History show the document you are in, and switch as soon as you move to another. Moving to a file that is not a Highwater document, or closing the document, empties them. Moving to the panes, the Preview, a save from the history, or the document's Bin items or Scratchpad keeps it. The Writing History panel fills in by itself, including for a `.md` file switched to Highwater Markdown.
- **Closing a document closes its Bin items and Scratchpad:** when the document's last tab closes, any open tabs of its Bin items or Scratchpad close too (unsaved ones ask, as VS Code does), for `.highland` and plain files.

## 0.2.2

- **Works panel** in the Highwater Too sidebar: every work in the catalog, on this computer or only on the mirror, newest first, with its saves (click one to compare it with the file, or to read it if the file is not here). Right-click: Open, Restore…, Remove from This Computer…, Delete Writing History….
- **Revert to This Save…** (right-click a save in the Writing History panel): the save's text replaces the document's, unsaved, and its Bin and Scratchpad come back; saving records a `Revert` naming the save. Nothing later is lost.
- **Remove from This Computer…:** sends the work's latest saves to the mirror, then removes its history from this computer and prunes the repository so none of its data is left here. It can be restored, or its file connected again, later.
- **Delete Writing History…:** permanent, after a warning that names how many saves go. With a mirror, **Delete everywhere?** removes it from the mirror and, through a deletion record in the catalog, from every computer when it next syncs; **Only on This Computer** deletes it here and never fetches it back. The file is not touched: a `.highland` file gets a new ID on its next save and a plain file keeps its Bin and Scratchpad, starting a new history.
- **Joining copies:** after a sync, a history on this computer that began from a save of another work (a copy worked on offline) is offered to be joined with it: both histories are kept, in a merge on the original work's branch. A different kind of file asks Make This File the Work's File or Keep as a Separate Copy.
- The mirror no longer sets a default fetch, so nothing but what is asked for is copied here.

## 0.2.1

- **Fetching on demand:** a computer holds only the works used on it. Pulling brings `main` and the works already here; a work saved elsewhere is fetched only when you restore it, or connect a file to it. Pushing sends `main` and this computer's works.
- **The catalog on `main`:** for every work, its title, form, file name, last save and the text hash of every save (no writing), one folder per work. When two computers change it, it is merged by fixed rules (hash lists combined, the later save's details kept). The README is written from it. Open Work from History… lists works on the mirror as well as here, and fetches one when you choose it.
- **Recognising files:** a file this computer has no history for is looked up in the catalog by its ID, then by its text's hash (texts with fewer words than the new `highwater.historyMatchMinWords` setting, default 50, are skipped), then by its file name. It always asks before fetching or connecting. Once connected: a different kind of file asks Make This File the Work's File or Keep as a Separate Copy; an older save asks Update to the Latest, Keep This Version (recorded as a Revert) or Keep as a Separate Copy; a `.highland` file edited since an older save asks Open the Latest Beside It, Keep This Version or Keep as a Separate Copy; a text matching no save asks Join, Continuing from This Text or Keep as a Separate Copy. No choice is pre-selected; until you choose, the file's saves are not recorded, and the status bar's history item asks again.
- Matching a file to a history by guessing from similar text is gone: only IDs, paths, exact text hashes and (asked) file names.
- Fixed: a plain file's save could be recorded without its Bin and Scratchpad when the writing history was turned on (or its folder changed) just before. A second copy of the history was started for the same folder and raced the first, and a stale lookup could hide the Bin; now there is one per folder, and each save looks the Bin up afresh.

## 0.2.0

**Start a new writing history before installing:** this version records saves in a new layout and does not read histories made by earlier versions. Delete the history folder (on a Mac, `~/Library/Application Support/Highwater Too/History`) on each computer, and the mirror's repository if you use one.

- Each save now holds exactly what is inside the `.highland` file, unpacked (zipped, a save is that file): the text, `bin/`, `scratchpad.txt`, `info.json`, `assets/` and the rest, at the same paths. A plain file's save holds the same, as far as it has them; its print template is kept in an `info.json` as a `.highland` file keeps it. Converting between the two leaves the recorded files unchanged.
- Every save names the kind of file the work is kept in and the file's name (`Highwater-Form`, `Highwater-File`). New kinds of save: `Revert` and `Restore`; `Convert`, `Revert` and `Restore` are recorded even when nothing changed.
- `.highland` files note which text they last saved (`highwaterToo.savedText` in `info.json`, not recorded in the history), for recognising copies that fall behind in a later version.
- **Open Work from History…** opens a work already on this computer, and restores any other exactly as its latest save was kept, under its recorded name. Restoring an older save, or as another kind of file, is gone: going back to an older save from the open document comes in a later version, and converting is done after restoring.

## 0.1.6

- **Convert to .highland File…** (was Save as .highland File…) and new **Convert to .fountain / .md / .txt File…** (by the text type) move a work between a `.highland` file and a plain file. The writing history, Bin, Scratchpad, images and print template go with it, so the history stays one branch whichever way it goes; each conversion is a `Convert` save naming the new file. A plain file made from a `.highland` file keeps the rest of it (settings, characters, navigator filters), so converting back restores it, and the history's text, Bin and image files are unchanged by a round trip. The file a work was converted from is no longer tracked; you are asked whether to move it (and its images folder) to the Trash.
- **Export Text** now works for plain files too, and an export is always a separate file outside the writing history: it no longer joins the original's history by matching its text. Exporting over a file that has its own history is refused.
- Fixed: restoring a work with Open Work from History… to the path of a file it had been converted from left that path untracked.

## 0.1.5

- Plain `.fountain` and `.md` files get the Bin, Scratchpad and Assets. A plain file can't hold them, so the Bin and Scratchpad are kept with the writing history (in its folder, under `extras`) and recorded with each save, and images go in a visible `<name> assets` folder beside the file, made only when the first one is added. The first time any of them is used with a plain file, a one-time warning says they are not part of the file and only Highwater Too shows them, and offers Save as .highland File… instead. With the writing history off, they are kept on this computer.
- A plain file's print template is kept with its Bin and Scratchpad, so it is recorded and mirrored too (it was kept per workspace).
- On another computer, a plain file's Bin and Scratchpad come in from the mirror with its saves, unless they were changed there as well.
- **Save as .highland File…** brings a plain file's Bin, Scratchpad, images (their paths in the text follow) and print template into the new file, which continues the file's writing history. The plain file is left as it was, with an offer to move it (and its images folder) to the Trash; if it is kept and saved again, it starts a history of its own.
- **Open Work from History…** restores a plain file with its Bin, Scratchpad and images, and makes a complete `.highland` file from a plain file's save.
- **Link Writing History to This File** (Command Palette): adds a note naming the file's writing history at its end, so the history and extras follow the file through a move and heavy rewriting. The note never prints and is not listed in the Navigator.

## 0.1.4

- History mirror on Gitea, Forgejo, GitLab or any HTTPS server: asks for your username and an access token when the server wants a login (with a link to Gitea's and Forgejo's token page), keeps them in VS Code's secure storage and uses them for every push and pull, for that server only. A login problem shows as a warning on the status bar's history item (click to sign in) instead of being retried. Set Up History Mirror checks the address at once and says what is wrong: sign-in, a missing repository (offered to create it), or an unreachable server. New: Sign In to History Mirror…, Forget History Mirror Sign-In.
- The history repository's README (on its `main` branch, which is what a mirror's web page shows) explains what the repository is, lists every work with its branch, what each commit holds, and how to get a work back or share one. Existing histories get it the next time VS Code starts.
- Everything since 0.1.3's first build: history pulling and Open Work from History, markers that never print, lyrics in Live Margins, line numbers off by default.

## 0.1.3

- Completion in screenplays: character names, scene-heading prefixes, the script's locations, times of day and transitions.
- Markers: Insert Marker (⌃M) and Go to Next Marker (⌃⌥M), written as Highland 2 writes them. Markers never print: the text lays out as if they were not there (Highland 2 breaks the line at a marker; that is not copied).
- Live Margins: lyrics at the dialogue indent.
- Line numbers are off in documents by default (turn them back on with VS Code's Line Numbers setting).
- Navigator: drag scenes, sections and headings to reorder the text.
- Syntax Cheat Sheet, from the Navigator's title bar or the Command Palette.
- Writing history mirror now pulls as well as pushes: other computers' saves come in on start-up, when a document is opened (at most once a minute) and every ten minutes; histories are matched to documents by ID, then by text. **Sync Writing History Now** replaces Push Writing History Now.
- Each save also records the rest of the `.highland` file (settings, assets). **Open Work from History…** rebuilds any work at any save, from this computer or another one, as a `.highland` or plain file that continues its history.

## 0.1.2

- **Export Word Document (.docx)** for manuscripts: the PDF's layout in ordinary Word formatting (styles, header and footer with page-number fields, title page, real lists, tables, table of contents, links, images). Font setting: Courier New, double-spaced (default), or Courier Prime embedded in the file.
- The editor's title bar has just Preview and Export Text; Export PDF and Export .docx (for manuscripts) are in the Preview's toolbar, and both stay in the Command Palette.

## 0.1.1

- **New Document…** in the sidebar (on the empty Navigator and as a button in its title bar) and the Command Palette: a blank screenplay or manuscript, as a `.highland` file or a plain `.fountain` or `.md` file.
- **Open Document…** opens `.fountain` and `.md` files as well as `.highland` files.

## 0.1.0 — first release

- Open, edit and save `.highland` files safely: the script as an editor tab, everything else in the file kept; backups before the first save of each session; changes made elsewhere reload or offer Revert, Save, Save As or Compare.
- Highwater Fountain, Markdown and Plain Text: highlighting, outline, folding, Highland's writing keys, word and page counts.
- Sidebar: Navigator, Bin, Assets, Scratchpad and Writing History; Live Margins; Title Page Builder.
- PDF preview and export with the Screenplay and Manuscript templates, matching Highland 2's PDFs line for line on the test documents; preview scrolls with the editor; print template in the status bar.
- Writing history: every save in a git repository, a branch per work; history panel and comparison; export of one work; optional mirror to any git remote.
