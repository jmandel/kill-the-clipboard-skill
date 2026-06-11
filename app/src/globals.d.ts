// @types/react-dom is not in the frozen dependency set; minimal ambient typing for the
// one entrypoint API we use, plus the bundled-CSS side-effect import.

declare module 'react-dom/client' {
  import type { ReactNode } from 'react';
  export interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
}

declare module '*.css' {}
