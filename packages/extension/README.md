# Highwater Too

Write screenplays and manuscripts in VS Code, in the `.highland` files of Highland 2. Highwater Too opens and saves `.highland` files safely, so Highland 2 still opens them afterwards. It gives them a page that looks and works like Highland's, prints PDFs laid out as Highland lays them out, and keeps a history of every save.

<!-- Same image as the repo README's hero shot. -->
![A screenplay in the Highwater Editor](https://raw.githubusercontent.com/eugenefischer/highwater-too/main/docs/images/hero.png)

**Contents:** [Getting started](#getting-started) · [The Highwater Editor](#the-highwater-editor) · [The sidebar](#the-sidebar) · [Print and export](#print-and-export) · [Plain files](#plain-fountain-md-and-txt-files) · [Writing history](#writing-history) · [Shortcuts](#keyboard-shortcuts) · [Settings](#settings) · [Known limitations](#known-limitations)

## Getting started

**Requirements:** VS Code 1.100 or later. The writing history needs git. On a Mac, if you don't have git yet, run `xcode-select --install` in Terminal.

- **Open a document.** Open a `.highland` file from the Explorer, or run **Highwater Too: Open Document…**. It opens in the Highwater Editor. Saving writes your text back into the file and keeps everything else in it: settings, Bin, Scratchpad and images. The first time you save a file in each session, a backup of the original is made first.
- **Start a new one.** **New Document…** makes a blank screenplay or manuscript, either as a `.highland` file or as a plain `.fountain` or `.md` file.
- **If another app changes the file.** If Highland 2 (or anything else) changes the file while it's open here, and you haven't edited it, it reloads. If you have edited it, you're asked, as Highland asks:
  - **Save Anyway** keeps your version.
  - **Revert** keeps the other app's version.
  - **Save As…** puts your version in a new file.
  - **Compare** shows the two side by side.

  Whichever version loses is kept in the writing history, or in the backups if the history is off.

## The Highwater Editor

<!-- Screenshot: the top bar and a page of dialogue, showing wrapped dialogue lines indented. -->
![Dialogue in the Highwater Editor](https://raw.githubusercontent.com/eugenefischer/highwater-too/main/docs/images/editor.png)

Your script appears in a page-width column of Courier Prime, as in Highland 2. Every line of a speech is indented, including lines that wrap. Bold, italics, notes and omitted text are styled where they are.

- **Top bar:**
  - Switches between your text and the printed pages (⌘E).
  - Opens the template window, which shows each template with a page of your text in it, plus its options, such as fonts.
  - Has **Choose Theme…**, which applies one of Highland 2's eleven colour themes to the page and, if you like, the whole window.
- **Counts:** characters, words and the exact page count, at the foot of the text.
- **Writing keys:** Highland's (see [Shortcuts](#keyboard-shortcuts)).
- **Completion:** in a screenplay, start a line in capitals and the characters who already speak are offered, most frequent first. You're also offered scene-heading prefixes and transitions, the script's locations after `INT.` or `EXT.`, and times of day after ` - `.
- **Markers:** ⌃M inserts one. ⌃⌥M jumps to the next.
- **Check Spelling While Typing:** American English, off by default. Misspelled words get red dots underneath. Right-click for suggestions, **Ignore** or **Learn Spelling**. ⌘; goes to the next misspelling.
- **Paragraph numbers, Go to Paragraph and Show Invisibles:** as in Highland.
- **Text size:** ⌘+ and ⌘− change it. ⌥⌘0 resets it.

The code button in the title bar turns the tab into VS Code's ordinary text editor, which is useful for other extensions or for multiple cursors. The book button turns it back. In the text editor, **Live Margins** (⌘L) indents cues, parentheticals and dialogue as on the page.

## The sidebar

<!-- Screenshot: the sidebar's tab row with the Bin open, a few cards visible. -->
![The Bin in the sidebar](https://raw.githubusercontent.com/eugenefischer/highwater-too/main/docs/images/sidebar.png)

The sidebar on the left of the page (⌘0 shows or hides it) has Highland's panels plus two new ones.

- **Navigator** (⌘1): scenes, sections, synopses, notes, images, links and markers, with the one you're in highlighted. Click to jump there. Type in the filter box to find an item. The eye button chooses which kinds are listed. Drag a scene, section or heading to move its text, with everything under it.
- **Bin** (⌘2): text you've set aside. Drag text in to cut it there, or use ⌥⌘X (cut) or ⌥⌘C (copy). Drag a card back into the text to use it. Click a card to read or edit it.
- **Assets** (⌘4): the document's images. Drag one into the text to insert it.
- **Scratchpad** (⌘5): notes, saved as you type.
- **Writing History:** this document's saves (see [Writing history](#writing-history)).
- **Works:** everything in your writing history.

When you use VS Code's text editor instead, the same panels appear in VS Code's own sidebar, under the Highwater Too icon.

## Print and export

<!-- Screenshot: the pages view with the print options at the foot. -->
![The printed pages](https://raw.githubusercontent.com/eugenefischer/highwater-too/main/docs/images/pages.png)

- **Pages** (⌘E): the PDF exactly as it will export, in place of the text, keeping your place. Clicking in the Navigator moves around the pages too. The print options are at the foot: revision colours and stars, paragraph numbers, synopses, notes and the title page. **Save As PDF** is beside them.
- **Export Word Document** (manuscripts only): a `.docx` built from ordinary Word styles, with a real header, page numbers, lists and tables, so it can be edited and sent out. Word works out its own page breaks, so the page count can differ a little from the PDF. The `highwater.docxFont` setting chooses between Courier New and Courier Prime (embedded in the file).
- **Export Text:** the text as `.fountain`, `.md` or `.txt`, without revision marks. Exports are always new files, separate from the writing history.

**Templates.** These six print line for line with Highland 2's own PDFs: Screenplay, Multi-Cam, Stage Play, Graphic Novel, Manuscript and Plain Text. The eight prose templates (Novel, Treatment, Modern Standard, Article, Bulletin, Speech, MLA Report, Wiki) also match line for line when Highland's fonts are available, and closely otherwise (see [Known limitations](#known-limitations)). The chosen template is saved in the document, as Highland saves it.

Highland's directives work: `{{HEADER}}`, `{{FOOTER}}`, `{{PAGENUMBER}}`, `{{SERIES}}`, `{{TIMESTAMP}}`, `{{TOC}}` and `{{INCLUDE}}`. A few of Highland 2's layout bugs are fixed rather than copied: footers are centred, text never runs over the footer, block quotes wrap at the margin, and there is no blank last page.

## Plain .fountain, .md and .txt files

`.fountain` files open with Highwater Too. For a `.md` or `.txt` file, click the language name in the status bar and choose **Highwater Markdown** or **Highwater Plain Text**. To open every `.md` file that way, run **Open .md Files with Highwater Too…**. Note that Highland's Markdown differs from standard Markdown in places. For example, every line is a paragraph, and `===` is a page break.

Plain files get everything, including the Bin, Scratchpad and Assets. A plain file can't hold a Bin or Scratchpad, though, so those are kept in the writing history instead, and only Highwater Too shows them. Images go in a `<name> assets` folder beside the file.

- **Convert to .highland File…** gathers a plain file and its extras into one `.highland` file.
- **Convert to .fountain / .md / .txt File…** goes the other way.

The writing history, Bin, Scratchpad and images move with the work either way.

## Writing history

<!-- Screenshot: the Writing History panel with a save selected, showing its Compare and Revert buttons. -->
![The Writing History panel](https://raw.githubusercontent.com/eugenefischer/highwater-too/main/docs/images/history.png)

Every save is recorded in a git repository on your computer, as a record of how each work was written. It's on from the first save and needs nothing set up beyond git.

- **What's recorded:** everything in the document at each save: text, Bin, Scratchpad, settings and images. Each save notes how many words it added or removed.
- **When:** every ⌘S. Autosaves are recorded at most every five minutes, and once more when the document closes.
- **Where:** one repository for all your writing, in your system's application-data folder, with one branch per work. **Change Writing History Location…** moves it. Avoid folders synced by Dropbox, iCloud and the like, which can damage git repositories.

**In the Writing History panel**, select a save to see two buttons:

- **Compare** marks what has changed since the save in your text: added text in green, removed text in red and struck through. ‹ and › at the top move between changes, and **Changes Only** folds away passages that haven’t changed. The text can’t be changed while comparing: double-click a spot to stop and edit there, or press **Done** or Escape. **Revert** in the bar goes back to the save and stops comparing.
- **Revert** puts that save's text, Bin and Scratchpad back and saves the document. The revert is recorded as a save, so nothing is removed from the history.

The panel's foot shows whether saves are being recorded and mirrored. The ⚙ menu has the rest: pause, export, connect to another work, sync. **Export Writing History…** writes one work's history as a file anyone can open with `git clone`.

**In the Works panel**, every work is listed by where it is: on this computer, in the history only, or on the mirror only. Select a work to open or restore it and see its saves. Its **More** menu has two options:

- **Remove from This Computer…** takes its history off this computer and leaves it on the mirror.
- **Delete Writing History…** deletes it for good, everywhere or only here.

Neither touches the file itself.

**On more than one computer.** **Set Up History Mirror…** keeps the history in step with any git server: GitHub, GitLab, Gitea or Forgejo, an SSH server, or another disk. It can create the repository for you.

- **What's shared:** each computer keeps only the works used on it. A work saved elsewhere comes over when you restore it, from the Works panel or with **Open Work from History…**.
- **Saves on two computers:** they are joined; neither is overwritten.
- **An older save:** if a file you open is an older save than the mirror's latest, you're asked whether to update it or carry on from this version.
- **Signing in:** github.com uses VS Code's GitHub sign-in. Other HTTPS servers ask once for a username and access token, kept in VS Code's secure storage. SSH uses your SSH key.

**Finding a document's history.** A `.highland` file carries an ID that links it to its history. A plain file is found by its path, or anywhere if you run **Link Writing History to This File**.

- **A file the history doesn't know:** it's looked up by ID, exact text or file name, and you're always asked before it's connected.
- **A copy of a work's file:** you're asked whether it's a separate work or the work's file now.
- **A moved file:** it's followed without asking.

If Highland 2 saved a file and it was then renamed, it may lose its link. **Connect to a Work's History…** joins it back.

## Keyboard shortcuts

Highland 2's shortcuts are on by default (`highwater.highlandShortcuts`). On Windows and Linux, ⌘ is Ctrl.

| Keys | Action |
|---|---|
| ⌘B, ⌘I, ⌘U | Bold, italic, underline |
| ⌃⇧= | Highlight |
| ⌘/ | Note |
| ⌘Y | Omit (boneyard) |
| ⌘⇧. | Centre |
| ⌃U, ⌃⇧U | Upper case, lower case |
| ⌃M, ⌃⌥M | Insert marker, go to next marker |
| ⌃G | Go to paragraph |
| ⌥⌘X, ⌥⌘C | Cut to Bin, copy to Bin |
| ⌘E | Text or pages (in the text editor: Preview) |
| ⌘0 | Show or hide the sidebar |
| ⌘1, ⌘2, ⌘4, ⌘5 | Navigator, Bin, Assets, Scratchpad |
| ⇧⌘I | Show Invisibles |
| ⌘+, ⌘−, ⌥⌘0 | Larger, smaller, reset text size |
| ⌘L | Live Margins (text editor) |

## Settings

| Setting | Default | What it does |
|---|---|---|
| `highwater.highlandEditor` | on | Open documents in the Highwater Editor. Off: they open in the text editor. |
| `highwater.theme` | Match VS Code | Highland 2's colour theme for the Highwater Editor and the Navigator. |
| `highwater.themeWindow` | on | Choose Theme… also colours the rest of VS Code to match. |
| `highwater.fontSize` | 0 | Text size in the Highwater Editor, in pixels. 0 follows VS Code's font size, scaled to about Highland's. |
| `highwater.paragraphNumbers` | off | Paragraph numbers in the margin. |
| `highwater.spellCheck` | off | Check spelling while typing (American English). |
| `highwater.spellingWords` | none | Words added with Learn Spelling. |
| `highwater.highlandShortcuts` | on | Highland 2's shortcuts instead of VS Code's. Off: Preview is ⌃⌥P and Live Margins ⌃⌥L. |
| `highwater.showSidebarOnOpen` | on | Show the Highwater Too views when a document opens in the text editor. |
| `highwater.docxFont` | Courier New | Font for Export Word Document: Courier New, or Courier Prime embedded. |
| `highwater.templates.*` | Highland's | Each template's options, such as fonts. Easiest to change in the template window. |
| `highwater.writingHistory` | on | Record saves in the writing history. |
| `highwater.historyFolder` | system default | Where the writing history and backups are kept. |
| `highwater.historyRemote` | none | The git remote that mirrors the writing history. |
| `highwater.historyMatchMinWords` | 50 | The fewest words a file needs to be recognised by its text, so empty files and templates never match. |

## Known limitations

- **Not built yet:** statistics, goals and sprints (the sidebar's Statistics panel is a placeholder), Revision Mode, Gender Analysis, Final Draft (`.fdx`) files, `.textbundle` files.
- **Prose template fonts:** the prose templates use Highland 2's fonts. Highland Sans, Amiri, Lato and Merriweather come with Highwater Too. Georgia, Times New Roman and Avenir Next are used when they're installed, and SF Pro Display and New York when Highland 2 is. Otherwise a stand-in prints (you're told when you export), and lines and pages can fall differently. Nested list items are indented, where Highland prints them flat.
- **Live Margins (text editor only):** it can't indent the continuation of a wrapped line, and while you start typing a line VS Code may briefly show "…" in the margin.
- **Windows:** not tested yet.

## Licence

MIT. Fonts are under their own open licences (SIL Open Font License and others), each included. The spelling dictionary is Hunspell's en_US from SCOWL (MIT and BSD). Highwater Too is not affiliated with Quote-Unquote Apps or Highland 2.
