/**
 * render-story.ts — parse story.md minimally and build story.pdf via doc.tsx.
 */
import path from "node:path";
import {
  storyTheme as t,
  title,
  section,
  para,
  pullQuote,
  bulletList,
  page,
  renderDoc,
  type Span,
} from "./doc.tsx";

const SRC = path.join(import.meta.dir, "../content/story.md");
const OUT = path.join(import.meta.dir, "story.pdf");

/** Inline parser: ==highlight== spans + bare-URL spans. */
function inline(text: string): Span[] {
  const spans: Span[] = [];
  for (const piece of text.split(/(==[^=]+==)/)) {
    if (!piece) continue;
    const m = piece.match(/^==([^=]+)==$/);
    if (m) {
      spans.push({ text: m[1]!, highlight: true });
      continue;
    }
    // split out bare URLs so they get the smaller URL treatment
    for (const part of piece.split(/(https?:\/\/\S+)/)) {
      if (!part) continue;
      if (/^https?:\/\//.test(part)) spans.push({ text: part, url: true });
      else spans.push({ text: part });
    }
  }
  return spans;
}

const md = await Bun.file(SRC).text();
const lines = md.split("\n");

const body: React.ReactNode[] = [];
let docTitle = "";
let metaLine = "";
let bullets: Span[][] = [];

const flushBullets = () => {
  if (bullets.length) {
    body.push(bulletList(t, bullets));
    bullets = [];
  }
};

for (const raw of lines) {
  const line = raw.trim();
  if (!line) continue;
  if (line.startsWith("# ")) {
    docTitle = line.slice(2);
  } else if (line.startsWith("*") && line.endsWith("*") && !docTitle.includes(line)) {
    metaLine = line.slice(1, -1);
  } else if (line.startsWith("## ")) {
    flushBullets();
    body.push(section(t, line.slice(3)));
  } else if (line.startsWith("> ")) {
    flushBullets();
    body.push(pullQuote(t, line.slice(2)));
  } else if (line.startsWith("- ")) {
    bullets.push(inline(line.slice(2)));
  } else {
    flushBullets();
    body.push(para(t, inline(line)));
  }
}
flushBullets();

// Title block: fold the meta line (patient name folded from the H1) into
// labeled identity fields.
const [titleMain, titleName] = docTitle.split(": ");
const metaParts = metaLine.split(" · "); // "Prepared for ... on June 12, 2026" · "DOB March 14, 1985"
const visit = metaParts[0]?.replace(/^Prepared for /, "") ?? "";
const dob = metaParts[1]?.replace(/^DOB /, "") ?? "";

const pages = [
  page(
    t,
    [
      title(t, {
        kicker: "Patient story · In her own words",
        title: titleMain ?? docTitle,
        meta: [
          { label: "Patient", value: titleName ?? "" },
          { label: "DOB", value: dob },
          { label: "Prepared for", value: visit },
        ],
      }),
      ...body,
    ],
    { key: "story" },
  ),
];

const t0 = performance.now();
await renderDoc(pages, { title: `${titleMain} — ${titleName}`, author: titleName }, OUT);
console.log(`story.pdf written in ${(performance.now() - t0).toFixed(0)} ms`);
