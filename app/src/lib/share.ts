// Copy / native-share helpers. navigator.share when available, clipboard fallback.

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function shareOrCopy(opts: { title?: string; text?: string; url?: string }): Promise<'shared' | 'copied' | 'failed'> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare(opts))) {
    try {
      await nav.share(opts);
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'failed';
    }
  }
  const payload = opts.url ?? opts.text ?? '';
  return (await copyText(payload)) ? 'copied' : 'failed';
}
