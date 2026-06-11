// Entry: capture the fragment, then scrub it from the address bar ONLY for owner mode
// (decision 13 — the owner token is the control secret). Viewer links (#shlink:/...)
// keep their fragment: they're the shareable form, and stripping would break reload.

import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { routeFragment } from './lib/derive.ts';
import './app.css';

const fragment = location.hash.replace(/^#/, '');
const route = routeFragment(fragment);
if (route.mode === 'owner') history.replaceState(null, '', location.pathname + location.search);

createRoot(document.getElementById('root')!).render(<App route={route} fragment={fragment} />);
