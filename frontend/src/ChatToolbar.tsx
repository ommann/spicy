import ColumnToolbar from './ColumnToolbar';

interface Props {
  path: string;
  mode: 'focused' | 'side';
  notification: { message: string; isError: boolean };
  onChatControls: () => void;
  onResume: () => void;
  onOptions: () => void;
  onMode: (mode: 'focused' | 'side') => void;
  onFork: (direction: number) => void;
}

export default function ChatToolbar(props: Props) {
  return <ColumnToolbar label="Trace navigation" hasContent={true} mode={props.mode}
    onMode={props.onMode} onNavigate={props.onFork} previousLabel="Previous column" nextLabel="Next column"
    actions={<button onClick={() => props.onOptions()}>Options</button>}>
    <button id="session-path" class="tree-title" aria-label="Pi chat controls"
      title="Open Pi chat controls" onClick={() => props.onChatControls()}>{props.path}</button>
    <span id="usage" role="status" classList={{ 'notification-error': props.notification.isError }}>{props.notification.message}</span>
    <button class="resume-button" onClick={() => props.onResume()}>Sessions</button>
  </ColumnToolbar>;
}
