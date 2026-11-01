export default function NavigationArrow(props: { direction: number }) {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d={props.direction < 0 ? 'M13 8H3M7 4L3 8L7 12' : 'M3 8H13M9 4L13 8L9 12'} />
  </svg>;
}
