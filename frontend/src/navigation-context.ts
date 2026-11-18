import { createContext, type JSX } from 'solid-js';

export const NavigationLinksContext = createContext<(navigation?: JSX.Element, controls?: JSX.Element) => JSX.Element>(() => null);
