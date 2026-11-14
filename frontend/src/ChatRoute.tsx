import { Show, createContext, createEffect, useContext, type Component } from 'solid-js';
import { Navigate, useLocation } from '@solidjs/router';
import { chatViewPath, setViewMode, type ViewMode } from './view-mode';
import { sessionPath, sessionUrlIdFromPath } from './session-urls';

export const ChatRouteContext = createContext<Component<{ mode: ViewMode }>>();

function ChatView(props: { mode: ViewMode }) {
  const View = useContext(ChatRouteContext);
  createEffect(() => setViewMode(props.mode));
  return <Show when={View} keyed>{Component => <Component mode={props.mode} />}</Show>;
}

export function SingleChatRoute() {
  return <ChatView mode="focused" />;
}

export function TreeChatRoute() {
  return <ChatView mode="side" />;
}

// Keep existing session/chat links as aliases for the preferred view.
export default function ChatRoute() {
  const location = useLocation();
  return <Navigate href={sessionPath(chatViewPath(), sessionUrlIdFromPath(location.pathname)) + location.search + location.hash} />;
}
