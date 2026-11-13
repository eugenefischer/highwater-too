/**
 * The page's indents in characters from the action margin, as Highland shows them (line-styles.ts). Measured from screenshots
 * of LiveMarginsTest (2026-10-12): cue 21.1, parenthetical 15.4, dialogue 11.5, transitions ending
 * at 63; Highland's indents are not whole characters, so dialogue and parentheticals round down.
 * Lyrics sit at the dialogue indent.
 */
export const MARGINS = { cue: 21, parenthetical: 15, dialogue: 11, width: 63, quote: 3, manuscriptWidth: 65 } as const;
