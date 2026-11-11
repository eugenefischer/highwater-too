/** The spelling dictionary, in a worker so typing never waits for it (Hunspell's en_US via nspell). */
import nspell from "nspell";
import { rankGuesses } from "./spell-rank.ts";

type Request = { type: "init"; aff: string; dic: string } | { type: "check"; id: number; words: string[] } | { type: "suggest"; id: number; word: string };

let spell: ReturnType<typeof nspell> | null = null;
const queued: Request[] = [];

function handle(msg: Request): void {
  if (msg.type === "init") {
    spell = nspell(msg.aff, msg.dic);
    for (const m of queued.splice(0)) handle(m);
    return;
  }
  if (!spell) return void queued.push(msg);
  if (msg.type === "check") postMessage({ id: msg.id, bad: msg.words.filter((w) => !spell!.correct(w)) });
  else postMessage({ id: msg.id, list: rankGuesses(msg.word, spell.suggest(msg.word)).slice(0, 8) });
}

onmessage = (e: MessageEvent<Request>) => handle(e.data);
