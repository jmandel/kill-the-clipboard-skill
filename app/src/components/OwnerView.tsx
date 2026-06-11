import { useEffect, useMemo, useState } from 'react';
import type { ManagePatch, ManageState } from '../../../lib/types.ts';
import { ManageApi } from '../lib/api.ts';
import {
  authForSecret,
  DEFAULT_REARM_HOURS,
  deriveStatus,
  formatCountdown,
  formatExp,
  payloadToShlink,
  rearmPatch,
  rebuildPayload,
  type LinkStatus,
} from '../lib/derive.ts';
import { copyText, shareOrCopy } from '../lib/share.ts';
import { AccessLog } from './AccessLog.tsx';
import { Icon, Sheet, Shell, StatusPill, ToggleRow } from './Chrome.tsx';
import { QrCard } from './QrCard.tsx';

const REARM_CHOICES = [
  { hours: 1, text: '1 hour' },
  { hours: 4, text: '4 hours' },
  { hours: 24, text: '24 hours' },
  { hours: 72, text: '3 days' },
  { hours: 168, text: '1 week' },
];

export function OwnerView({
  masterSecret,
  api,
  fragment,
}: {
  masterSecret: Uint8Array;
  api: string | null;
  fragment: string;
}) {
  const client = useMemo(() => new ManageApi(api), [api]);
  const [auth, setAuth] = useState<string | null>(null);
  const [state, setState] = useState<ManageState | null>(null);
  const [shlink, setShlink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [bookmarkable, setBookmarkable] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState('');
  const [rearmHours, setRearmHours] = useState(DEFAULT_REARM_HOURS);
  const [modal, setModal] = useState<'rearm' | 'destroy' | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const a = await authForSecret(masterSecret);
        if (cancelled) return;
        setAuth(a);
        const s = await client.get(a);
        if (cancelled) return;
        setState(s);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load link status');
      }
    })();
    return () => { cancelled = true; };
  }, [client, masterSecret]);

  // QR/shlink ALWAYS reconstructed from current state (docs/DESIGN.md §3) so label/exp
  // edits and re-arms propagate without anything being stored.
  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    rebuildPayload(masterSecret, state).then(
      (p) => { if (!cancelled) setShlink(payloadToShlink(p)); },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to rebuild link'); },
    );
    return () => { cancelled = true; };
  }, [state, masterSecret]);

  // Bookmarkable toggle restores/strips the secret fragment in the address bar.
  useEffect(() => {
    history.replaceState(null, '', bookmarkable ? `#${fragment}` : location.pathname + location.search);
  }, [bookmarkable, fragment]);

  const status: LinkStatus | null = state ? deriveStatus(state, now) : null;

  const run = async (fn: () => Promise<ManageState>) => {
    setBusy(true);
    setError(null);
    try {
      setState(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };
  const applyPatch = (patch: ManagePatch) => {
    if (auth) void run(() => client.patch(auth, patch));
  };

  const flashCopied = (which: string) => {
    setCopied(which);
    setTimeout(() => setCopied(null), 2500);
  };

  if (!state || !status) {
    return (
      <Shell title="My Health Link">
        {error ? <p className="error-box">{error}</p> : <p className="loading">Checking link status…</p>}
      </Shell>
    );
  }

  const destroyed = status === 'destroyed';
  const live = status === 'live';
  const uses = state.uses;
  const maxUses = state.maxUses;
  const pct = maxUses === null ? 0 : Math.min(uses / maxUses, 1);
  const usesLeft = maxUses === null ? null : Math.max(maxUses - uses, 0);
  const viewerUrl = shlink ? `${location.origin}/s#${shlink}` : null;

  return (
    <>
      {modal === 'rearm' && (
        <Sheet
          title="Re-arm this link?"
          body={`Extends the expiration by ${REARM_CHOICES.find((c) => c.hours === rearmHours)?.text ?? `${rearmHours}h`} and resets the use allowance. The URL stays the same; the QR on this page refreshes automatically.`}
          confirmLabel="Re-arm link"
          onConfirm={() => { setModal(null); applyPatch(rearmPatch(state, rearmHours, maxUses === null ? null : undefined, now)); }}
          onCancel={() => setModal(null)}
        />
      )}
      {modal === 'destroy' && (
        <Sheet
          title="Revoke this link?"
          body="No one will be able to open it after this, and the shared data is permanently deleted. This can't be undone — to stop access temporarily, use Pause instead."
          confirmLabel="Revoke permanently"
          danger
          onConfirm={() => { setModal(null); if (auth) void run(() => client.destroy(auth)); }}
          onCancel={() => setModal(null)}
        />
      )}

      <Shell title="My Health Link" pill={<StatusPill status={status} />}>
        {error && <p className="error-box">{error}</p>}

        <div className="link-head">
          {editingLabel ? (
            <form
              className="relabel-form"
              onSubmit={(e) => {
                e.preventDefault();
                applyPatch({ label: labelDraft.slice(0, 80) });
                setEditingLabel(false);
              }}
            >
              <input
                value={labelDraft}
                maxLength={80}
                autoFocus
                placeholder="e.g. Casey Tester — visit summary for June 12"
                onChange={(e) => setLabelDraft(e.target.value)}
              />
              <button type="submit" disabled={busy}>Save</button>
              <button type="button" onClick={() => setEditingLabel(false)}>Cancel</button>
            </form>
          ) : (
            <p className="link-label">{state.label ?? 'SMART Health Link'}</p>
          )}
          {live && (
            <div className="link-sub">
              Expires in <strong>{formatCountdown(state.exp, now)}</strong> · {formatExp(state.exp)}
            </div>
          )}
          {status === 'expired' && <div className="link-sub">Expired {formatExp(state.exp)} — re-arm to share again</div>}
          {status === 'exhausted' && <div className="link-sub">Use limit reached — re-arm to allow more access</div>}
          {status === 'paused' && <div className="link-sub">Paused — no one can open it until you resume</div>}
          {destroyed && (
            <div className="link-sub danger">
              Access has been revoked{state.purgedAt ? ' and the data deleted' : ''}
            </div>
          )}
        </div>

        {shlink && !destroyed && (
          <>
            <QrCard shlink={shlink} dimmed={!live} />

            <div className="copy-row">
              <button
                type="button"
                className={`btn-block${copied === 'link' ? ' copied' : ''}`}
                onClick={async () => { if (await copyText(shlink)) flashCopied('link'); }}
              >
                {copied === 'link' ? Icon.check : Icon.copy}
                {copied === 'link' ? 'Copied!' : 'Copy link'}
              </button>
              <button
                type="button"
                className="btn-block secondary"
                aria-label="Share"
                onClick={() => void shareOrCopy({ title: state.label ?? 'SMART Health Link', url: shlink })}
              >
                {Icon.share}
              </button>
            </div>
            <div className="url-preview">{shlink.slice(0, 56)}…</div>
          </>
        )}

        <div className="usage-card">
          <div className="usage-top">
            <span className="usage-title">
              Opened {uses} {uses === 1 ? 'time' : 'times'}
            </span>
            <span className={`usage-count${pct >= 1 ? ' full' : ''}`}>
              {maxUses === null ? `${uses} / ∞` : `${uses} / ${maxUses}`}
            </span>
          </div>
          <div className="usage-track">
            <div
              className={`usage-fill${pct >= 1 ? ' full' : pct >= 0.8 ? ' warn' : ''}`}
              style={{ width: maxUses === null ? '0%' : `${pct * 100}%` }}
            />
          </div>
          {usesLeft !== null && usesLeft > 0 && !destroyed && (
            <div className="usage-note">{usesLeft} {usesLeft === 1 ? 'use' : 'uses'} remaining</div>
          )}
          {usesLeft === 0 && !destroyed && (
            <div className="usage-note limit">Limit reached — re-arm to allow more access</div>
          )}
        </div>

        {/* ── Manage ─────────────────────────────────────────── */}
        <div className="section-rule">
          <p className="eyebrow-label">Manage</p>

          <ToggleRow
            label="Keep this page bookmarkable"
            description={
              bookmarkable
                ? "The link key is visible in this page's URL. Only use on a trusted device."
                : 'By default, the key is removed from the URL when this page loads.'
            }
            value={bookmarkable}
            onChange={setBookmarkable}
          />

          <div className="row-divider" />

          {!destroyed && (
            <div className="manage-row">
              <button type="button" className="btn-outline" disabled={busy} onClick={() => setModal('rearm')}>
                {Icon.rotate}
                Re-arm link
              </button>
              <div className="rearm-picker">
                <span>extend for</span>
                <select value={rearmHours} disabled={busy} onChange={(e) => setRearmHours(Number(e.target.value))}>
                  {REARM_CHOICES.map((c) => (
                    <option key={c.hours} value={c.hours}>{c.text}</option>
                  ))}
                </select>
              </div>
              <div className="row-hint">Extends expiration and resets the use allowance — the URL stays the same</div>
            </div>
          )}

          {!destroyed && (
            <div className="manage-row">
              <button
                type="button"
                className="btn-outline"
                disabled={busy}
                onClick={() => applyPatch({ active: status !== 'paused' ? false : true })}
              >
                {status === 'paused' ? Icon.play : Icon.pause}
                {status === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <div className="row-hint">
                {status === 'paused' ? 'Lets people open the link again' : 'Temporarily blocks access; resume any time'}
              </div>
            </div>
          )}

          {!destroyed && (
            <div className="manage-row">
              <button
                type="button"
                className="btn-outline"
                disabled={busy}
                onClick={() => { setLabelDraft(state.label ?? ''); setEditingLabel(true); window.scrollTo({ top: 0 }); }}
              >
                {Icon.pencil}
                Rename
              </button>
              <div className="row-hint">The label is what the clinic sees when they scan</div>
            </div>
          )}

          {viewerUrl && !destroyed && (
            <div className="manage-row">
              <button
                type="button"
                className="btn-outline"
                onClick={() => window.open(viewerUrl, '_blank', 'noopener')}
              >
                {Icon.eye}
                Preview as recipient
              </button>
              <div className="row-hint">
                Opens a view-only copy in a new tab — what someone sees when they open your link
              </div>
              <div className="row-hint">
                <a
                  href={viewerUrl}
                  target="_blank"
                  rel="noopener"
                  onClick={async (e) => {
                    e.preventDefault();
                    if (await copyText(viewerUrl)) flashCopied('viewer');
                  }}
                >
                  {copied === 'viewer' ? 'Copied!' : 'Copy view-only page link'}
                </a>{' '}
                to send someone the QR without these controls
              </div>
            </div>
          )}

          <div className="row-divider" />

          <div className="manage-row">
            <button
              type="button"
              className="btn-outline danger"
              disabled={busy || destroyed}
              onClick={() => setModal('destroy')}
            >
              {Icon.x}
              {destroyed ? 'Link revoked' : 'Revoke link'}
            </button>
            {!destroyed && <div className="row-hint">Blocks all future access and deletes the data — permanent</div>}
          </div>
        </div>

        {/* ── Access log ─────────────────────────────────────── */}
        <div className="section-rule">
          <p className="eyebrow-label">Access log</p>
          <AccessLog entries={state.accessLog} />
        </div>
      </Shell>
    </>
  );
}
