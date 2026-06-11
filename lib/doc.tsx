/**
 * doc.tsx — semantic document builder on top of @react-pdf/renderer (docs/DESIGN.md decisions 18/19).
 *
 * Theme-aware semantic components: title, section, para, pullQuote, callout, kvPanel,
 * bulletList, table, badge, pageFooter, page, renderDoc. Callers (renderer modules,
 * skill scripts, agent escape hatches) compose these; NO layout math may leak out of
 * this module.
 *
 * ⚠ The repeating-table-header technique (a `fixed` header row + `wrap={false}` body
 * rows) is UNDOCUMENTED emergent behavior of @react-pdf/renderer. The dependency is
 * pinned exactly in package.json; lib/doc.test.ts contains a geometry regression test
 * that fails loudly if an upgrade breaks it. Do not "upgrade casually."
 */
import React from "react";
import {
  Document,
  Font,
  Page,
  Text,
  View,
  renderToFile,
} from "@react-pdf/renderer";

// Fonts come from pinned npm packages (@expo-google-fonts/*, exact versions in
// package.json) — no binaries in the repo or the skill.zip; `bun install` provides
// them with integrity from the lockfile. Resolved relative to THIS module so the
// same code works in the repo and inside an extracted skill.zip.
const font = (spec: string) => Bun.resolveSync(spec, import.meta.dir);

// ---------------------------------------------------------------- fonts ----

export function registerFonts() {
  Font.register({
    family: "Source Serif 4",
    fonts: [
      { src: font("@expo-google-fonts/source-serif-4/400Regular/SourceSerif4_400Regular.ttf"), fontWeight: 400 },
      { src: font("@expo-google-fonts/source-serif-4/400Regular_Italic/SourceSerif4_400Regular_Italic.ttf"), fontWeight: 400, fontStyle: "italic" },
      { src: font("@expo-google-fonts/source-serif-4/600SemiBold/SourceSerif4_600SemiBold.ttf"), fontWeight: 600 },
      { src: font("@expo-google-fonts/source-serif-4/700Bold/SourceSerif4_700Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.register({
    family: "Inter",
    fonts: [
      { src: font("@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf"), fontWeight: 400 },
      { src: font("@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf"), fontWeight: 500 },
      { src: font("@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf"), fontWeight: 600 },
      { src: font("@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf"), fontWeight: 700 },
    ],
  });
  // CJK fallback: real exports carry unicode names/notes (e.g. 王秀英); react-pdf
  // does per-codepoint fallback across a fontFamily array, so themes use
  // [primary, 'Noto Sans SC'] stacks. Regular weight only — fallback is for
  // glyph coverage, not CJK typography.
  // Every weight/style maps to the one file: CJK has no italic tradition, and the
  // resolver throws on any unregistered variant a component happens to request.
  const notoSrc = font("@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf");
  Font.register({
    family: 'Noto Sans SC',
    fonts: ([400, 500, 600, 700] as const).flatMap((fontWeight) => [
      { src: notoSrc, fontWeight },
      { src: notoSrc, fontWeight, fontStyle: 'italic' as const },
    ]),
  });
  // No dictionary hyphenation; break only monster tokens (URLs, LOINC-ish
  // names) at character level so they stay inside their boxes.
  Font.registerHyphenationCallback((word) => {
    if (word.length <= 22) return [word];
    const parts: string[] = [];
    for (let i = 0; i < word.length; i += 11) parts.push(word.slice(i, i + 11));
    return parts;
  });
}

// --------------------------------------------------------------- themes ----

export interface Theme {
  name: "story" | "summary";
  /** Font stack: primary + glyph-coverage fallbacks (react-pdf falls back per codepoint). */
  font: string | string[];
  baseSize: number;
  lineHeight: number;
  ink: string;
  muted: string;
  faint: string;
  accent: string;
  accentDark: string;
  rule: string;
  panelBg: string;
  panelBorder: string;
  highlightBg: string;
  zebra: string;
  margin: { top: number; right: number; bottom: number; left: number };
}

export const storyTheme: Theme = {
  name: "story",
  font: ["Source Serif 4", "Noto Sans SC"],
  baseSize: 11,
  lineHeight: 1.52,
  ink: "#2B2118",
  muted: "#6E5D4B",
  faint: "#9A8A77",
  accent: "#B65A38",
  accentDark: "#8C4227",
  rule: "#E0D4C3",
  panelBg: "#FAF4EA",
  panelBorder: "#E5D8C4",
  highlightBg: "#FBEBC8",
  zebra: "#FAF6EF",
  margin: { top: 72, right: 72, bottom: 76, left: 72 },
};

export const summaryTheme: Theme = {
  name: "summary",
  font: ["Inter", "Noto Sans SC"],
  baseSize: 9,
  lineHeight: 1.4,
  ink: "#1A2330",
  muted: "#55606E",
  faint: "#8B95A3",
  accent: "#1F5FA8",
  accentDark: "#174980",
  rule: "#D7DEE7",
  panelBg: "#F2F6FB",
  panelBorder: "#D2DEEC",
  highlightBg: "#FDF0C2",
  zebra: "#F6F8FB",
  margin: { top: 54, right: 54, bottom: 72, left: 54 },
};

// ---------------------------------------------------------------- spans ----

export interface Span {
  text: string;
  highlight?: boolean;
  italic?: boolean;
  bold?: boolean;
  url?: boolean;
}

function spanNodes(t: Theme, spans: Span[] | string, size: number) {
  const arr: Span[] = typeof spans === "string" ? [{ text: spans }] : spans;
  return arr.map((s, i) => (
    <Text
      key={i}
      style={{
        ...(s.highlight ? { backgroundColor: t.highlightBg } : {}),
        ...(s.italic ? { fontStyle: "italic" as const } : {}),
        ...(s.bold ? { fontWeight: 600 as const } : {}),
        ...(s.url
          ? { color: t.accentDark, fontSize: size - 1.5 }
          : {}),
      }}
    >
      {s.text}
    </Text>
  ));
}

// ------------------------------------------------------------ components ----

/** Title block: document title + identity meta, grouped, with accent rule. */
export function title(
  t: Theme,
  opts: { title: string; meta: { label: string; value: string }[]; kicker?: string },
) {
  const story = t.name === "story";
  return (
    <View key="title" style={{ marginBottom: story ? 22 : 18 }}>
      {opts.kicker ? (
        <Text
          style={{
            fontFamily: t.font,
            fontSize: story ? 9.5 : 8,
            color: t.accentDark,
            textTransform: "uppercase",
            letterSpacing: 1.6,
            fontWeight: 600,
            marginBottom: 6,
          }}
        >
          {opts.kicker}
        </Text>
      ) : null}
      <Text
        style={{
          fontFamily: t.font,
          fontSize: story ? 23 : 20,
          fontWeight: 700,
          color: t.ink,
          lineHeight: 1.18,
        }}
      >
        {opts.title}
      </Text>
      <View
        style={{
          height: 2.5,
          width: story ? 64 : 56,
          backgroundColor: t.accent,
          marginTop: 8,
          marginBottom: 9,
        }}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {opts.meta.map((m, i) => (
          <View key={i} style={{ flexDirection: "row", marginRight: 16, marginBottom: 2 }}>
            <Text
              style={{
                fontFamily: t.font,
                fontSize: story ? 9.5 : 8,
                color: t.faint,
                textTransform: "uppercase",
                letterSpacing: 0.7,
                fontWeight: story ? 600 : 500,
                marginRight: 4,
                paddingTop: story ? 1.4 : 0.8,
              }}
            >
              {m.label}
            </Text>
            <Text
              style={{
                fontFamily: t.font,
                fontSize: story ? 11 : 9,
                color: t.ink,
                fontWeight: story ? 400 : 600,
              }}
            >
              {m.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** H2 section heading with an accent rule. */
export function section(t: Theme, text: string, key?: string) {
  const story = t.name === "story";
  return (
    <View
      key={key ?? text}
      minPresenceAhead={64}
      style={{
        marginTop: story ? 18 : 14,
        marginBottom: story ? 8 : 7,
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      <View
        style={{
          width: 4,
          height: story ? 14 : 11,
          backgroundColor: t.accent,
          marginRight: 7,
          borderRadius: 1,
        }}
      />
      <Text
        style={{
          fontFamily: t.font,
          fontSize: story ? 14.5 : 11.5,
          fontWeight: story ? 700 : 600,
          color: story ? t.accentDark : t.ink,
          ...(story ? {} : { textTransform: "uppercase" as const, letterSpacing: 0.8, fontSize: 10.5 }),
        }}
      >
        {text}
      </Text>
      <View style={{ flexGrow: 1, height: 0.75, backgroundColor: t.rule, marginLeft: 9 }} />
    </View>
  );
}

/** Body paragraph; accepts a string or rich spans (highlight/italic/url). */
export function para(t: Theme, spans: Span[] | string, opts?: { size?: number; muted?: boolean; spaceAfter?: number }) {
  const size = opts?.size ?? t.baseSize;
  return (
    <Text
      style={{
        fontFamily: t.font,
        fontSize: size,
        lineHeight: t.lineHeight,
        color: opts?.muted ? t.muted : t.ink,
        marginBottom: opts?.spaceAfter ?? (t.name === "story" ? 9 : 6),
        textAlign: t.name === "story" ? "justify" : "left",
      }}
    >
      {spanNodes(t, spans, size)}
    </Text>
  );
}

/** Visually distinct pull-quote (not a grey `>` indent). */
export function pullQuote(t: Theme, text: string) {
  return (
    <View
      wrap={false}
      style={{
        marginTop: 10,
        marginBottom: 14,
        marginHorizontal: 18,
        paddingLeft: 14,
        paddingRight: 10,
        paddingVertical: 8,
        borderLeftWidth: 3,
        borderLeftColor: t.accent,
        backgroundColor: t.panelBg,
        borderTopRightRadius: 4,
        borderBottomRightRadius: 4,
        flexDirection: "row",
      }}
    >
      <Text
        style={{
          fontFamily: t.font,
          fontSize: 22,
          fontWeight: 700,
          color: t.accent,
          marginRight: 8,
          marginTop: -2,
        }}
      >
        “
      </Text>
      <Text
        style={{
          fontFamily: t.font,
          fontSize: t.baseSize + 2,
          fontStyle: "italic",
          lineHeight: 1.5,
          color: t.accentDark,
          flexShrink: 1,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

/** Bulleted list with accent markers. */
export function bulletList(t: Theme, items: (Span[] | string)[]) {
  return (
    <View style={{ marginBottom: t.name === "story" ? 9 : 6 }}>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: "row", marginBottom: 4 }}>
          <Text
            style={{
              fontFamily: t.font,
              fontSize: t.baseSize,
              color: t.accent,
              width: 16,
              paddingLeft: 4,
            }}
          >
            •
          </Text>
          <Text
            style={{
              fontFamily: t.font,
              fontSize: t.baseSize,
              lineHeight: t.lineHeight,
              color: t.ink,
              flex: 1,
            }}
          >
            {spanNodes(t, item, t.baseSize)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Boxed informational callout panel. */
export function callout(t: Theme, opts: { title: string; body: (Span[] | string)[] }) {
  return (
    <View
      wrap={false}
      style={{
        backgroundColor: t.panelBg,
        borderWidth: 0.75,
        borderColor: t.panelBorder,
        borderLeftWidth: 3,
        borderLeftColor: t.accent,
        borderRadius: 3,
        paddingVertical: 9,
        paddingHorizontal: 12,
        marginBottom: 12,
      }}
    >
      <Text
        style={{
          fontFamily: t.font,
          fontSize: t.baseSize - 0.5,
          fontWeight: 600,
          color: t.accentDark,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          marginBottom: 4,
        }}
      >
        {opts.title}
      </Text>
      {opts.body.map((line, i) => (
        <Text
          key={i}
          style={{
            fontFamily: t.font,
            fontSize: t.baseSize - 0.5,
            lineHeight: 1.45,
            color: t.ink,
            marginBottom: i === opts.body.length - 1 ? 0 : 3,
          }}
        >
          {spanNodes(t, line, t.baseSize - 0.5)}
        </Text>
      ))}
    </View>
  );
}

/** Key-value panel: pairs laid out as a 2-column grid. */
export function kvPanel(t: Theme, pairs: [string, string][]) {
  return (
    <View
      wrap={false}
      style={{
        backgroundColor: t.panelBg,
        borderWidth: 0.75,
        borderColor: t.panelBorder,
        borderRadius: 3,
        paddingVertical: 8,
        paddingHorizontal: 12,
        marginBottom: 12,
        flexDirection: "row",
        flexWrap: "wrap",
      }}
    >
      {pairs.map(([k, v], i) => (
        <View key={i} style={{ width: "50%", flexDirection: "row", paddingVertical: 2.5, paddingRight: 8 }}>
          <Text
            style={{
              fontFamily: t.font,
              fontSize: t.baseSize - 1,
              color: t.muted,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              fontWeight: 500,
              width: 72,
              paddingTop: 0.5,
            }}
          >
            {k}
          </Text>
          <Text
            style={{
              fontFamily: t.font,
              fontSize: t.baseSize,
              fontWeight: 600,
              color: t.ink,
              flex: 1,
            }}
          >
            {v}
          </Text>
        </View>
      ))}
    </View>
  );
}

// --------------------------------------------------------------- badges ----

const BADGE_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  active: { bg: "#E3F1E3", fg: "#1F6B2D", border: "#BBDCBD" },
  stopped: { bg: "#F8E4E1", fg: "#9C3325", border: "#EBC4BE" },
  completed: { bg: "#E5ECF7", fg: "#2A4E8F", border: "#C8D6EC" },
  high: { bg: "#F9DFDC", fg: "#A32014", border: "#EFBFB9" },
  low: { bg: "#E6F0E6", fg: "#3A6B3A", border: "#C5DCC5" },
  "unable-to-assess": { bg: "#FBF0D2", fg: "#8A6210", border: "#EFDCA6" },
  inactive: { bg: "#ECEEF1", fg: "#5A6470", border: "#D5DAE0" },
  resolved: { bg: "#E5ECF7", fg: "#2A4E8F", border: "#C8D6EC" },
  HIGH: { bg: "#F9DFDC", fg: "#A32014", border: "#EFBFB9" },
  LOW: { bg: "#FBF0D2", fg: "#8A6210", border: "#EFDCA6" },
  NORMAL: { bg: "#FFFFFF00", fg: "#8B95A3", border: "#FFFFFF00" },
};

/** Colored status chip. */
export function badge(t: Theme, label: string, kind?: string) {
  const c = BADGE_COLORS[kind ?? label] ?? BADGE_COLORS.inactive!;
  return (
    <View
      style={{
        alignSelf: "flex-start",
        maxWidth: "100%",
        backgroundColor: c.bg,
        borderWidth: 0.75,
        borderColor: c.border,
        borderRadius: 7,
        paddingHorizontal: 4,
        paddingVertical: 1.2,
      }}
    >
      <Text
        style={{
          fontFamily: t.font,
          fontSize: 6.2,
          fontWeight: 600,
          color: c.fg,
          textTransform: "uppercase",
          letterSpacing: 0.2,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------- table ----

export interface Column {
  header: string;
  /** relative width weight */
  width: number;
  align?: "left" | "right" | "center";
}

export type Cell = string | React.ReactElement | Span[];

/**
 * Data table. Header row uses the `fixed` prop so it repeats on every page
 * the table spans; rows use wrap={false} so they never split mid-row.
 */
export function table(
  t: Theme,
  opts: {
    columns: Column[];
    rows: Cell[][];
    fontSize?: number;
    repeatHeader?: boolean;
    zebra?: boolean;
    flagRow?: (row: Cell[], idx: number) => boolean;
  },
) {
  const fs = opts.fontSize ?? t.baseSize - 1;
  const totalW = opts.columns.reduce((a, c) => a + c.width, 0);
  const pct = (w: number) => `${(w / totalW) * 100}%`;
  const repeat = opts.repeatHeader !== false;

  const headerRow = (
    <View
      fixed={repeat || undefined}
      style={{
        flexDirection: "row",
        borderBottomWidth: 1.4,
        borderBottomColor: t.accent,
        backgroundColor: t.name === "summary" ? "#EDF2F8" : t.panelBg,
        borderTopLeftRadius: 2,
        borderTopRightRadius: 2,
      }}
    >
      {opts.columns.map((c, i) => (
        <View key={i} style={{ width: pct(c.width), paddingVertical: 3.5, paddingHorizontal: 4 }}>
          <Text
            style={{
              fontFamily: t.font,
              fontSize: fs - 1,
              fontWeight: 600,
              color: t.accentDark,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              textAlign: c.align ?? "left",
            }}
          >
            {c.header}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={{ marginBottom: 10 }}>
      {headerRow}
      {opts.rows.map((row, ri) => {
        const flagged = opts.flagRow?.(row, ri) ?? false;
        return (
          <View
            key={ri}
            wrap={false}
            style={{
              flexDirection: "row",
              borderBottomWidth: 0.5,
              borderBottomColor: t.rule,
              backgroundColor: flagged
                ? "#FCF1EF"
                : opts.zebra !== false && ri % 2 === 1
                  ? t.zebra
                  : undefined,
            }}
          >
            {row.map((cell, ci) => {
              const col = opts.columns[ci]!;
              return (
                <View
                  key={ci}
                  style={{
                    width: pct(col.width),
                    paddingVertical: 3,
                    paddingHorizontal: 4,
                    justifyContent: "flex-start",
                  }}
                >
                  {typeof cell === "string" || Array.isArray(cell) ? (
                    <Text
                      style={{
                        fontFamily: t.font,
                        fontSize: fs,
                        lineHeight: 1.32,
                        color: t.ink,
                        textAlign: col.align ?? "left",
                      }}
                    >
                      {spanNodes(t, cell, fs)}
                    </Text>
                  ) : (
                    cell
                  )}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

// --------------------------------------------------------------- footer ----

export const PROVENANCE_BASE = "Shared by the patient via SMART Health Link";

export function provenanceLine(sharedDate?: string): string {
  return sharedDate ? `${PROVENANCE_BASE} — ${sharedDate}` : PROVENANCE_BASE;
}

/** Fixed footer on every page: provenance line + Page N of M. */
export function pageFooter(t: Theme, footerLeft: string = PROVENANCE_BASE) {
  return (
    <View
      key="footer"
      fixed
      style={{
        position: "absolute",
        bottom: 30,
        left: t.margin.left,
        right: t.margin.right,
        borderTopWidth: 0.75,
        borderTopColor: t.rule,
        paddingTop: 6,
        flexDirection: "row",
        justifyContent: "space-between",
      }}
    >
      <Text style={{ fontFamily: t.font, fontSize: 7.5, color: t.muted }}>{footerLeft}</Text>
      <Text
        style={{ fontFamily: t.font, fontSize: 7.5, color: t.muted }}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}

// ----------------------------------------------------------------- page ----

/** Letter page with theme margins and the mandatory footer baked in. */
export function page(
  t: Theme,
  children: React.ReactNode,
  opts?: { orientation?: "portrait" | "landscape"; key?: string; footerLeft?: string },
) {
  return (
    <Page
      key={opts?.key}
      size="LETTER"
      orientation={opts?.orientation ?? "portrait"}
      style={{
        paddingTop: t.margin.top,
        paddingRight: t.margin.right,
        paddingBottom: t.margin.bottom,
        paddingLeft: t.margin.left,
        fontFamily: t.font,
        fontSize: t.baseSize,
        color: t.ink,
      }}
    >
      {React.Children.toArray(children)}
      {pageFooter(t, opts?.footerLeft)}
    </Page>
  );
}

/** Render a Document of page() elements to a PDF file. */
export async function renderDoc(
  pages: React.ReactElement[],
  meta: { title: string; author?: string },
  outPath: string,
) {
  registerFonts();
  const docEl = (
    <Document title={meta.title} author={meta.author} producer="kill-the-clipboard" creator="kill-the-clipboard">
      {React.Children.toArray(pages)}
    </Document>
  );
  await renderToFile(docEl, outPath);
}
