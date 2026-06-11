## Secrets: Handling the Owner Link and Shlink

Two strings unlock everything: the **owner link** (full control of the share) and the
**shlink** (read access to the patient's records, also embedded in `qr.png`). The
scripts deliberately keep them off stdout — `create-shl.ts` writes them to files and
prints only paths. Keep them out of your output too.

**Rules:**

- Never print, quote, decode, or summarize the contents of `owner-link.txt`,
  `shlink.txt`, `viewer-link.txt`, or the QR payload. Never base64-read `qr.png` into
  the conversation. (`viewer-link.txt` is read-capability only — less powerful than
  the owner link, but it still opens the patient's records.)
- Never echo a secret twice. If the platform forces you to relay the owner URL (see
  matrix below), do it exactly once and never repeat, reformat, or reconstruct it —
  even if the patient asks "what was that link again?" (point them to where it was
  delivered, or mint fresh artifacts with `manage-shl.ts` from the files on disk).
- Don't paste secrets into shell commands in ways that echo them back (no
  `echo $(cat owner-link.txt)`). Command *substitution that stays inside the
  command* is fine — that's the browser-open trick below.
- `link-meta.json` and all script stdout are non-secret by design — safe to read,
  show, and discuss freely.

**Platform matrix:**

| Platform | How to deliver |
|---|---|
| Claude Code / CLI agent on the patient's machine | Point at the files by path ("your owner page link is in `shl-out/owner-link.txt`, the QR is `shl-out/qr.png`") and/or open the browser directly: `xdg-open "$(cat shl-out/owner-link.txt)"` (macOS: `open`). The secret never appears in the transcript. |
| Hosted chat (no shared filesystem; the patient can't reach files you write) | Relay the owner URL **once**, as a clickable link with a "open this now and keep it" note. Never quote it again; never relay the shlink separately (the owner page shows the QR). |

The owner page itself plays defense too: it strips the secret from the browser
address bar on load and stores nothing by default (an explicit "Make this page
bookmarkable" toggle on the page opts out), so the patient should keep
`owner-link.txt` (or the once-relayed message) as their way back in. If the patient
loses the owner link but you still have `shl-out/`, `manage-shl.ts` can do everything
the page can.

The page also distinguishes capabilities: the owner link opens the full management
view; `viewer-link.txt` opens the same page in **view-only** mode (QR + label, no
controls) — the right thing for previews and for family members who only need to
show the QR.
