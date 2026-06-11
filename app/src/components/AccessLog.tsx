import type { AccessEntry } from '../../../lib/types.ts';

const OUTCOME_LABEL: Record<string, string> = {
  ok: 'OK',
  'bad-passcode': 'Bad passcode',
  inactive: 'Blocked (not live)',
};

export function AccessLog({ entries }: { entries: AccessEntry[] }) {
  return (
    <section className="access-log">
      {entries.length === 0 ? (
        <p className="log-empty">No one has accessed this link yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Recipient</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} className={e.outcome !== 'ok' ? 'log-row-warn' : ''}>
                <td>{new Date(e.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                <td>{e.recipient || '(not given)'}</td>
                <td>{OUTCOME_LABEL[e.outcome] ?? e.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
