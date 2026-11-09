import { createMemo, type JSX } from 'solid-js';

export default function BranchLabel(props: { text: string; color: string; screen: boolean; muted: boolean; style: JSX.CSSProperties }) {
  const bounds = createMemo(() => {
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = '900 100px monospace';
    const metrics = context.measureText(props.text);
    const left = metrics.actualBoundingBoxLeft;
    const ascent = metrics.actualBoundingBoxAscent;
    const width = Math.max(1, left + metrics.actualBoundingBoxRight);
    const height = Math.max(1, ascent + metrics.actualBoundingBoxDescent);
    return { viewBox: `${-left} ${-ascent} ${width} ${height}`, width, height };
  });
  return <div class="branch-label"
    classList={{ 'branch-label-screen': props.screen, 'branch-label-muted': props.muted }} aria-hidden="true"
    style={{ ...props.style, position: props.screen ? 'fixed' : 'absolute', 'pointer-events': 'none', color: props.color }}>
    <svg viewBox={bounds().viewBox} width="90%" height="90%" preserveAspectRatio="xMidYMid meet"
      style={{ 'max-width': `${bounds().width * 4.8}px`, 'max-height': `${bounds().height * 4.8}px`, overflow: 'visible' }}>
      <text x="0" y="0" fill="currentColor" font-family="monospace" font-weight="900" font-size="100">{props.text}</text>
    </svg>
  </div>;
}
