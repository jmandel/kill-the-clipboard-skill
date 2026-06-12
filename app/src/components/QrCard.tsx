import { useEffect, useState } from 'react';
import { qrDataUrl } from '../lib/qr.ts';

export function QrCard({ value, dimmed }: { value: string; dimmed?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setErr(null);
    qrDataUrl(value).then(
      (url) => { if (!cancelled) setSrc(url); },
      (e) => { if (!cancelled) setErr(e instanceof Error ? e.message : 'QR generation failed'); },
    );
    return () => { cancelled = true; };
  }, [value]);

  return (
    <div className={`qr-card${dimmed ? ' qr-dimmed' : ''}`}>
      {src ? (
        <img className="qr-img" src={src} alt="SMART Health Link QR code" />
      ) : err ? (
        <p className="qr-error">{err}</p>
      ) : (
        <div className="qr-placeholder">Generating QR…</div>
      )}
      {dimmed && <p className="qr-dim-note">This QR will not work until the link is live again.</p>}
    </div>
  );
}
