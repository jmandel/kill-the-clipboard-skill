import { Shell } from './Chrome.tsx';

export function Explainer({ invalid }: { invalid: boolean }) {
  return (
    <Shell title="My Health Link">
      <div className="explainer">
        {invalid && (
          <p className="error-box">
            That link didn’t contain a valid share. It may have been truncated when it was
            copied or sent — try opening the original link again.
          </p>
        )}
        <p>
          This page displays and manages SMART Health Links — a way to share your health
          records as a QR code that you control.
        </p>
        <p>
          There’s nothing to see here on its own: this page is opened from a share link,
          which carries the share details after the <code>#</code> in its address. If you
          created a share with your AI agent, re-open the owner link it gave you.
        </p>
      </div>
    </Shell>
  );
}
