import { createContext, type JSX } from 'solid-js';

export const NavigationLinksContext = createContext<() => JSX.Element>(() => null);
