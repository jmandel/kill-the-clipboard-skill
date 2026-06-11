// render-story.ts — minimal markdown -> DocBuilder mapping for story.md.
import { readFileSync } from "fs";
import { join } from "path";
import { DocBuilder, type Span } from "./doc";

const SRC = join(import.meta.dir, "../content/story.md");
const OUT = join(import.meta.dir, "story.pdf");

const URL_RE = /(https?:\/\/[^\s)]+)/;

/** Inline parse: ==highlight== spans and bare URLs. */
function spans(text: string): Span[] {
  const out: Span[] = [];
  for (const piece of text.split(/(==[^=]+==)/)) {
    if (!piece) continue;
    const hl = piece.match(/^==([^=]+)==$/);
    if (hl) {
      out.push({ text: hl[1] ?? "", highlight: true });
      continue;
    }
    for (const sub of piece.split(URL_RE)) {
      if (!sub) continue;
      if (URL_RE.test(sub) && sub.startsWith("http")) out.push({ text: sub, link: sub });
      else out.push({ text: sub });
    }
  }
  return out;
}

const lines = readFileSync(SRC, "utf8").split("\n");
const doc = new DocBuilder("story");
doc.pageFooter("Shared by the patient via SMART Health Link — June 10, 2026");

let h1: string | null = null;
let meta: string | null = null;
let listBuf: Span[][] = [];

const flushList = () => {
  if (listBuf.length) {
    doc.list(listBuf);
    listBuf = [];
  }
};

for (const raw of lines) {
  const line = raw.trim();
  if (!line) continue;

  if (line.startsWith("# ")) {
    h1 = line.slice(2).trim();
    continue;
  }
  if (h1 !== null && meta === null && /^\*.*\*$/.test(line)) {
    // metadata line right under the H1 -> fold into the title block
    meta = line.replace(/^\*|\*$/g, "").trim();
    doc.title({
      eyebrow: "Patient Story",
      title: h1,
      meta: meta.split("·").map((s) => s.trim()),
    });
    continue;
  }
  if (line.startsWith("## ")) {
    flushList();
    doc.section(line.slice(3).trim());
    continue;
  }
  if (line.startsWith("> ")) {
    flushList();
    doc.pullQuote(line.slice(2).trim());
    continue;
  }
  if (line.startsWith("- ")) {
    listBuf.push(spans(line.slice(2).trim()));
    continue;
  }
  flushList();
  doc.para(spans(line));
}
flushList();

const t0 = performance.now();
await doc.render(OUT);
console.log(`story.pdf written in ${(performance.now() - t0).toFixed(0)} ms`);
