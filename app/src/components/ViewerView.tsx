import { useMemo, useState } from 'react';
import type { ShlinkPayload } from '../../../lib/shlink.ts';
import { formatCountdown, formatExp, payloadToShlink } from '../lib/derive.ts';
import { copyText, shareOrCopy } from '../lib/share.ts';
import { Icon, Shell, StatusPill } from './Chrome.tsx';
import { QrCard } from './QrCard.tsx';

export function ViewerView({ payload }: { payload: ShlinkPayload }) {
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const [copied, setCopied] = useState(false);
  const { shlink, error } = useMemo(() => {
    try {
      return { shlink: payloadToShlink(payload), error: null };
    } catch (e) {
      return { shlink: null, error: e instanceof Error ? e.message : 'Invalid link payload' };
    }
  }, [payload]);

  const expired = payload.exp !== undefined && now >= payload.exp;

  return (
    <Shell title="Health Link" pill={<StatusPill status={expired ? 'expired' : 'live'} />}>
      {error ? (
        <p className="error-box">{error}</p>
      ) : (
        <>
          <div className="link-head">
            <span className="mode-marker">View-only copy</span>
            <p className="link-label">{payload.label ?? 'SMART Health Link'}</p>
            {payload.exp !== undefined && (
              <div className="link-sub">
                {expired ? (
                  <>Expired {formatExp(payload.exp)}</>
                ) : (
                  <>Expires in <strong>{formatCountdown(payload.exp, now)}</strong> · {formatExp(payload.exp)}</>
                )}
              </div>
            )}
          </div>

          <QrCard shlink={shlink!} dimmed={expired} />

          <div className="copy-row">
            <button
              type="button"
              className={`btn-block${copied ? ' copied' : ''}`}
              onClick={async () => {
                if (await copyText(shlink!)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2500);
                }
              }}
            >
              {copied ? Icon.check : Icon.copy}
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <button
              type="button"
              className="btn-block secondary"
              aria-label="Share"
              onClick={() => void shareOrCopy({ title: payload.label ?? 'SMART Health Link', url: shlink! })}
            >
              {Icon.share}
            </button>
          </div>
          <div className="url-preview">{shlink!.slice(0, 56)}…</div>

          <p className="link-sub" style={{ textAlign: 'center' }}>
            Show this QR code at check-in or share the link. Whoever manages the share
            controls when it stops working.
          </p>
        </>
      )}
    </Shell>
  );
}
