import { createContext, useContext, type Component } from 'solid-js';

export const ChatRouteContext = createContext<Component>();

export default function ChatRoute() {
  const View = useContext(ChatRouteContext);
  return View ? <View /> : null;
}
