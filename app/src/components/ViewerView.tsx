import { useMemo, useState } from 'react';
import type { ShlinkPayload } from '../../../lib/shlink.ts';
import { formatCountdown, formatExp, payloadToShlink } from '../lib/derive.ts';
import { fetchShlBundles, PasscodeRequiredError, type FhirBundle } from '../lib/fetchShl.ts';
import { copyText, shareOrCopy } from '../lib/share.ts';
import { BundleView } from './BundleView.tsx';
import { Icon, Shell, StatusPill } from './Chrome.tsx';
import { QrCard } from './QrCard.tsx';

export function ViewerView({ payload }: { payload: ShlinkPayload }) {
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [bundles, setBundles] = useState<FhirBundle[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passcode, setPasscode] = useState('');
  const [recipient, setRecipient] = useState('');
  const [needsPasscode, setNeedsPasscode] = useState(() => Boolean(payload.flag?.includes('P')));

  const { shlink, parseError } = useMemo(() => {
    try {
      return { shlink: payloadToShlink(payload), parseError: null };
    } catch (e) {
      return { shlink: null, parseError: e instanceof Error ? e.message : 'Invalid link payload' };
    }
  }, [payload]);

  const expired = payload.exp !== undefined && now >= payload.exp;

  const openRecords = async () => {
    setBusy(true);
    setError(null);
    try {
      setBundles(await fetchShlBundles(payload, recipient.trim(), passcode || undefined));
    } catch (e) {
      if (e instanceof PasscodeRequiredError) {
        setNeedsPasscode(true);
        if (passcode) setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Could not open the shared records');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Health Link" pill={<StatusPill status={expired ? 'expired' : 'live'} />}>
      {parseError ? (
        <p className="error-box">{parseError}</p>
      ) : (
        <>
          <div className="link-head">
            <span className="mode-marker">Shared with you</span>
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

          {!bundles && (
            <input
              type="text"
              className="passcode-input"
              placeholder="Your name (the sharer sees who opened it)"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          )}
          {!bundles && needsPasscode && (
            <input
              type="password"
              className="passcode-input"
              placeholder="Passcode for this link"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
            />
          )}
          {!bundles && (
            <button
              type="button"
              className="btn-block"
              disabled={busy || expired || !recipient.trim() || (needsPasscode && !passcode)}
              onClick={() => void openRecords()}
            >
              {busy ? 'Opening…' : 'Open shared records'}
            </button>
          )}
          {!bundles && (
            <p className="row-hint" style={{ marginBottom: 16 }}>
              Opening counts as one use of the link; your name appears in the sharer's
              access log.
            </p>
          )}
          {error && <p className="error-box">{error}</p>}

          {bundles && bundles.map((b, i) => <BundleView key={i} bundle={b} />)}
          {bundles && bundles.length === 0 && (
            <p className="error-box">The link resolved, but carried no FHIR content this viewer can display.</p>
          )}

          <div className="copy-row" style={{ marginTop: 20 }}>
            <button type="button" className="btn-block secondary grow" onClick={() => setShowQr(!showQr)}>
              {showQr ? 'Hide QR' : 'Show QR'}
            </button>
            <button
              type="button"
              className={`btn-block secondary grow${copied ? ' copied' : ''}`}
              onClick={async () => {
                if (await copyText(shlink!)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2500);
                }
              }}
            >
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
          {showQr && <QrCard shlink={shlink!} dimmed={expired} />}
        </>
      )}
    </Shell>
  );
}
