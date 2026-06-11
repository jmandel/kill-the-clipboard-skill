// render-story.ts — parse story.md minimally and render via the Doc builder.

import { Doc, breakable, type Span } from "./doc";

const PROVENANCE = "Shared by the patient via SMART Health Link — June 10, 2026";
const SRC = `${import.meta.dir}/../content/story.md`;

/** Split inline text into spans on ==highlight== markers; make URLs breakable. */
function spans(text: string): Span[] {
  const out: Span[] = [];
  for (const part of text.split(/(==[^=]+==)/g)) {
    if (!part) continue;
    const m = part.match(/^==([^=]+)==$/);
    const t = (m?.[1] ?? part).replace(/https?:\/\/\S+/g, (u) => breakable(u));
    out.push(m ? { text: t, highlight: true } : { text: t });
  }
  return out;
}

const md = await Bun.file(SRC).text();
const lines = md.split("\n");

const doc = new Doc("story", PROVENANCE);

let i = 0;
// --- H1 title + the italic meta line below it -> title block -----------------
const h1 = (lines[i] ?? "").replace(/^#\s+/, "");
i++;
while ((lines[i] ?? "").trim() === "") i++;
const metaLine = (lines[i] ?? "").replace(/^\*|\*$/g, ""); // "Prepared for ... · DOB ..."
i++;
const [visitPart = "", dobPart = ""] = metaLine.split(" · ");
const [title = h1, patient = ""] = h1.split(": ");
doc.title(title, {
  subtitle: visitPart,
  meta: [
    ["Patient", patient],
    ["DOB", dobPart.replace(/^DOB\s+/, "")],
    ["Visit", "June 12, 2026"],
  ],
});

// --- Body ---------------------------------------------------------------------
let listBuf: Span[][] = [];
const flushList = () => {
  if (listBuf.length) {
    doc.list(listBuf);
    listBuf = [];
  }
};

for (; i < lines.length; i++) {
  const line = (lines[i] ?? "").trim();
  if (line === "") continue;
  if (line.startsWith("## ")) {
    flushList();
    doc.section(line.slice(3));
  } else if (line.startsWith("> ")) {
    flushList();
    doc.pullQuote(spans(line.slice(2)));
  } else if (line.startsWith("- ")) {
    listBuf.push(spans(line.slice(2)));
  } else {
    flushList();
    doc.para(spans(line));
  }
}
flushList();

await doc.pdf(`${import.meta.dir}/story.pdf`);
console.log("wrote story.pdf");
