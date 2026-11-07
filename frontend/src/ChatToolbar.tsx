import ColumnToolbar from './ColumnToolbar';

interface Props {
  active?: boolean;
  empty?: boolean;
  mode: 'focused' | 'side';
  notification: { message: string; isError: boolean };
  onOptions: () => void;
  onMode: (mode: 'focused' | 'side') => void;
  onFork: (direction: number) => void;
}

export default function ChatToolbar(props: Props) {
  return <ColumnToolbar active={props.active} label="Trace navigation" hasContent={true} mode={props.mode}
    onMode={props.onMode} onNavigate={props.onFork} previousLabel="Previous column" nextLabel="Next column"
    previousDisabled={props.empty} nextDisabled={props.empty}
    onOptions={props.onOptions}>
    <span id="usage" role="status" classList={{ 'notification-error': props.notification.isError }}>{props.notification.message}</span>
  </ColumnToolbar>;
}
