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
<li><b>Close</b>: saved as the document closed.</li>
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
<p>The status line says whether this document’s save history is being kept, and when the last one was. If you use a mirror, a second line says when it was last updated.</p>
<ul>
<li>${icon('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>')} <b>Record</b> pauses or resumes the history for this document. Existing saves are kept.</li>
<li>${icon('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>')} <b>Export</b> saves this document’s whole history as one file (git bundle) you can share or archive.</li>
<li>${icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>')} <b>More</b> holds the less common actions, described below.</li>
</ul>

<h3>More actions</h3>
<ul>
<li><b>Connect to a Work’s History</b>: if a copied or renamed file lost its history, joins it back up. You’ll be asked to confirm.</li>
<li><b>Link Writing History to This File</b> (.fountain and .md files): adds a short line at the end of the file so its history, Bin and Scratchpad follow it if you move or rename it. .highland files don’t need this.</li>
<li><b>Set Up History Mirror</b>: keeps a backup of all your history on a remote git server you choose, such as a private GitHub repository. Your other computers can then see and restore your work.</li>
<li><b>Sync Writing History Now</b>: syncs your local writing history with the history mirror.</li>
<li><b>Sign In to History Mirror</b>: signs in to your history mirror. Highwater Too saves your sign-in credentials so you only need to do this once.</li>
<li><b>Forget History Mirror Sign-In</b>: forgets the saved history mirror sign-in credentials.</li>
<li><b>Reveal Writing History Folder</b>: shows where writing histories are stored on this computer.</li>
<li><b>Change Writing History Location</b>: lets you select where writing histories are stored on this computer.</li>
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
<p>Each shows its file name, when it was last saved, and its word count.</p>

<h3>A work</h3>
<p>Click a work to see its saves, then:</p>
<ul>
<li>${icon(OPEN_ICON)} <b>Open</b> opens the work’s file.</li>
<li>${icon(RESTORE_ICON)} <b>Restore</b> asks where to save the work, then writes its latest save there. Its history carries on from that file.</li>
<li>Click a save to see it. For the document you have open here, its changes since that save are marked in your text, as Compare does in the Writing History; for another work whose file is on this computer, it opens beside that file with the changes marked.</li>
<li>${icon(MORE_ICON)} <b>More</b>:
<ul>
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
