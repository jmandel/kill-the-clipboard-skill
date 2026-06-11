import type { Route } from './lib/derive.ts';
import { Explainer } from './components/Explainer.tsx';
import { OwnerView } from './components/OwnerView.tsx';
import { ViewerView } from './components/ViewerView.tsx';

export function App({ route, fragment }: { route: Route; fragment: string }) {
  switch (route.mode) {
    case 'owner':
      return <OwnerView masterSecret={route.masterSecret} api={route.api} fragment={fragment} />;
    case 'viewer':
      return <ViewerView payload={route.payload} />;
    case 'invalid':
      return <Explainer invalid />;
    case 'none':
      return <Explainer invalid={false} />;
  }
}
