// Shared shell chrome: phone-column shell, sticky header with SMART mark +
// status pill, bottom-sheet confirm modal, toggle row. Visuals per the
// "SMART Health Links.html" design bundle.

import type { ReactNode } from 'react';
import type { LinkStatus } from '../lib/derive.ts';
import { SmartMark } from './SmartLockup.tsx';

const PILL_TEXT: Record<LinkStatus, string> = {
  live: 'Active',
  paused: 'Paused',
  expired: 'Expired',
  exhausted: 'Limit reached',
  destroyed: 'Revoked',
};

export function StatusPill({ status }: { status: LinkStatus }) {
  return (
    <span className={`status-pill ${status}`} role="status">
      <span className="dot" aria-hidden="true" />
      {PILL_TEXT[status]}
    </span>
  );
}

export function Shell({
  title,
  pill,
  children,
}: {
  title: string;
  pill?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <header className="app-header">
        <SmartMark size={22} />
        <span className="app-title">{title}</span>
        {pill}
      </header>
      <div className="content">{children}</div>
    </div>
  );
}

export function Sheet({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" aria-hidden="true" />
        <h3>{title}</h3>
        <p>{body}</p>
        <div className="sheet-buttons">
          <button type="button" className={`sheet-confirm${danger ? ' danger' : ''}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="sheet-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <button
        type="button"
        className="toggle-switch"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
      >
        <span className="knob" />
      </button>
      <div className="toggle-text">
        <div className="toggle-label">{label}</div>
        <div className="toggle-desc">{description}</div>
      </div>
    </div>
  );
}

export const Icon = {
  copy: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  check: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  share: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  ),
  rotate: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 4v6h6" />
      <path d="M3.51 15a9 9 0 1 0 .49-4.74" />
    </svg>
  ),
  x: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  eye: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  pause: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="10" y1="5" x2="10" y2="19" />
      <line x1="14" y1="5" x2="14" y2="19" />
    </svg>
  ),
  play: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
    </svg>
  ),
  pencil: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  ),
};
