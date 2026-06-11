// Page count straight from PDF object headers — no poppler dependency. Sandboxes
// frequently lack poppler, and a missing page count must never fail a render whose
// PDF was already written (field incident: the PDF existed, the pdfinfo call crashed
// the script with an opaque ShellError, and the agent rebuilt the document via groff).

export async function countPages(pdf: string): Promise<number> {
  const text = await Bun.file(pdf).text();
  const count = text.match(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/);
  if (count?.[1]) return Number(count[1]);
  return (text.match(/\/Type\s*\/Page\b/g) ?? []).length;
}
