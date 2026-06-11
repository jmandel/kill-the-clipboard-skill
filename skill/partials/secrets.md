## Handling the Owner Link and Shlink

Two strings matter: the **owner link** (controls the share) and the **shlink** (read
access; also encoded in `qr.png`). They're patient deliverables — `create-shl.ts`
hands you the closing message containing both (`handoffMarkdown`), and giving them to
the patient is the point. This conversation is the patient's own channel; the secrets
appearing in it is fine. If the patient asks for the link again later, give it again
(`manage-shl.ts <shl-out-dir> status` echoes the owner link).

**The two real rules:**

1. **Never send a secret to any external service** — no pasting into issues, logs,
   web forms, other APIs, or anything that isn't this conversation or the patient's
   own machine.
2. **Don't decode, summarize, or transform the secrets** — relay them as-is. (There's
   nothing useful inside anyway, and a re-typed secret is a broken secret.)

The bare master secret inside the owner link's `#` fragment is script plumbing: the
scripts read it from disk themselves, so you never need to extract it, quote it on
its own, or pass it as a command-line argument to anything.

After handoff, the patient manages everything from the owner page; you can do the
same operations with `manage-shl.ts` from `shl-out/` — but only when asked.
