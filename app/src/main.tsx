// Entry: capture the fragment, IMMEDIATELY scrub it from the address bar (decision 13 —
// it holds the owner secret or the shlink key), then render with the fragment in memory.

import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { routeFragment } from './lib/derive.ts';
import './app.css';

const fragment = location.hash.replace(/^#/, '');
if (fragment) history.replaceState(null, '', location.pathname + location.search);

const route = routeFragment(fragment);

createRoot(document.getElementById('root')!).render(<App route={route} fragment={fragment} />);
