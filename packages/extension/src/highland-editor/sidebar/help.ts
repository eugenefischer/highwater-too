/** The help popovers of Highwater's own panels (the ? buttons). */
import { COMPARE_ICON, MORE_ICON, OPEN_ICON, RESTORE_ICON, REVERT_ICON, icon } from "./icons.ts";

/** The Writing History's ? button: what it is and what each control does (it is not Highland's). */
export const HISTORY_HELP = `
<h2>Writing History</h2>
<p>Each time you save, Highwater Too keeps a copy of the document. You can look back at any earlier version to see what has changed, and revert to the earlier save if you want to.</p>
<p>The copies are kept on this computer. A save is kept only when something changed: the text, or what’s kept with it, such as the Bin, the Scratchpad, images or the template.</p>

<h3>The list</h3>
<p>Saves are listed newest first, by day. Each shows its time, its type, and how many words it added or removed from the document. The types are:</p>
<ul>
<li><b>Save</b>: you saved.</li>
<li><b>Autosave</b>: VS Code saved for you.</li>
<li><b>Close</b>: an autosave recorded as the document closed (older saves).</li>
<li><b>Revert</b>: you went back to an earlier save (its note says which).</li>
<li><b>Restore</b>, <b>Convert</b>, <b>Connect</b>: the document was brought back from its history, changed to another file type, or joined to another document’s history.</li>
</ul>

<h3>Compare or go back</h3>
<p>Click a save, then:</p>
<ul>
<li>${icon(COMPARE_ICON)} <b>Compare</b> marks what has changed since that save in your text: added text in green, removed text in red and struck through. Use ‹ and › at the top to move between changes. The text can’t be changed while you compare: double-click a spot to stop comparing and edit there, or press <b>Done</b> or Escape. <b>Revert</b> goes back to that save.</li>
<li>${icon(REVERT_ICON)} <b>Revert</b> puts that save’s text, Bin and Scratchpad back and saves the document. The revert is added to the list straight away, and nothing is ever removed from the work history, so you can always go back again. If you have unsaved changes, you can save them first or leave them out.</li>
</ul>

<h3>The bottom of the panel</h3>
<p>The status line says when the document was last saved and, if you use a mirror, when it last synced. If the history is turned off for this document, it says <b>History disabled for this document</b>.</p>
<ul>
<li>${icon('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>')} <b>Export</b> saves this document’s whole history as one file (git bundle) you can share or archive.</li>
<li>${icon(MORE_ICON)} <b>More</b> holds the less common actions, described below.</li>
</ul>

<h3>More actions</h3>
<ul>
<li><b>Sync Writing History Now</b> (with a mirror): brings in saves from your other computers and sends this computer’s.</li>
<li><b>Connect to a Work’s History</b>: if a copied or renamed file lost its history, joins it back up. You’ll be asked to confirm.</li>
<li><b>Reveal Writing History Folder</b>: shows where writing histories are stored on this computer.</li>
<li><b>Disable History for This Document</b> (or <b>Enable</b>): stops or restarts recording this document’s saves. Existing saves are kept.</li>
<li><b>Manage Writing History</b>: opens Settings → Backup, where you choose how often documents save themselves, where the history is kept, and the history mirror: setting it up, signing in, and how often it syncs.</li>
</ul>
`;

/** The Works panel's ? button. */
export const WORKS_HELP = `
<h2>Works</h2>
<p>Every document with a writing history is a work. This panel lists them all, including works saved on your other computers if you use a history mirror.</p>

<h3>The list</h3>
<p>Works are grouped by where they are:</p>
<ul>
<li><b>Local works</b>: the work’s file is on this computer, where it was last saved.</li>
<li><b>Local history only</b>: the history is on this computer, but the file isn’t where it was last saved. It may have been moved, renamed or deleted.</li>
<li><b>Mirror only</b>: the work was saved on another computer, and its history is on the mirror.</li>
</ul>
<p>Each shows its title, its file name, when it was last saved, and its word count. A new work takes its title at its first save, from its title page or file name (Settings → Backup).</p>

<h3>A work</h3>
<p>Click a work to see its saves, then:</p>
<ul>
<li>${icon(OPEN_ICON)} <b>Open</b> opens the work’s file.</li>
<li>${icon(RESTORE_ICON)} <b>Restore</b> asks where to save the work, then writes its latest save there. Its history carries on from that file.</li>
<li>Its saves are listed to show its history. To compare with one or revert to it, open the work, then use its Writing History.</li>
<li>${icon(MORE_ICON)} <b>More</b>:
<ul>
<li><b>Reveal in Finder</b> (local works): opens a Finder window with the work’s file selected.</li>
<li><b>Rename</b>: gives the work a new title. To rename its file too, tick <b>Also change file name?</b> and type the file’s new name (it doesn’t have to match the title). The rename is listed among the work’s saves, and your other computers offer to rename their copy of the file the next time it’s opened. Only works whose history is on this computer can be renamed.</li>
<li><b>Remove from This Computer</b>: removes the work’s history from this computer. It stays on the mirror, so you can restore it later. You need a mirror to do this.</li>
<li><b>Delete Writing History</b>: deletes the work’s history for good. With a mirror, you choose whether to delete it everywhere or only on this computer. The file itself is never deleted.</li>
</ul></li>
</ul>

<h3>The bottom of the panel</h3>
<ul>
<li><b>Filter</b> shows only the works whose name contains what you type.</li>
<li><b>Sync</b> (with a mirror) checks the mirror for works saved on your other computers. The line above says when it last synced. If it says the mirror needs you to sign in, click it to sign in.</li>
</ul>
`;
