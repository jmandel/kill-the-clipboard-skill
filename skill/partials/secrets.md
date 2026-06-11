## Handling the Owner Link and Shlink

Two strings matter: the **owner link** (controls the share) and the **shlink** (read
access; also encoded in `qr.png`). `create-shl.ts` writes them to files and prints
only paths.

**The two real rules:**

1. **Never send a secret to any external service** — no pasting into issues, logs,
   web forms, other APIs, or anything that isn't this conversation or the patient's
   own machine.
2. **Don't decode, summarize, or transform the secrets** — relay them as-is. (There's
   nothing useful inside anyway, and a re-typed secret is a broken secret.)

**Handing off is simple — don't overthink it.** When the link is ready, paste
`handoff.md` verbatim as your closing message (it already presents the owner page as
a clickable link and the shlink as code), along with `qr.png` however your platform
best shows or delivers a file. That's the intended delivery — reading the files to
relay them to the patient is the point of the files, and this conversation is the
patient's own; the secret appearing in it is fine. If the patient asks for the link
again later, give it again.

Avoid *gratuitous* repetition (don't quote secrets in explanations, recaps, or
debugging output where a path or "your owner link" would do), but never let secrecy
ceremony get in the way of serving the patient.

After handoff, the patient manages everything from the owner page; you can do the
same operations with `manage-shl.ts` from `shl-out/` — but only when asked.
