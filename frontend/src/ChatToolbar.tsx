import ColumnToolbar from './ColumnToolbar';

interface Props {
  active?: boolean;
  mode: 'focused' | 'side';
  notification: { message: string; isError: boolean };
  onOptions: () => void;
  onMode: (mode: 'focused' | 'side') => void;
  modeHref?: (mode: 'focused' | 'side') => string;
  onModeLink?: (mode: 'focused' | 'side') => void;
}

export default function ChatToolbar(props: Props) {
  return <ColumnToolbar active={props.active} label="Trace navigation" hasContent={true} mode={props.mode}
    onMode={props.onMode} modeHref={props.modeHref} onModeLink={props.onModeLink}
    onOptions={props.onOptions}>
    <span id="usage" role="status" classList={{ 'notification-error': props.notification.isError }}>{props.notification.message}</span>
  </ColumnToolbar>;
}
