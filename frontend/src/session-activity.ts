import { createSignal, onCleanup, onMount } from 'solid-js';

export function activityTime(modified: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - modified) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  if (minutes < 2880) return 'yesterday';
  return `${Math.floor(minutes / 1440)} days ago`;
}

// Keep labels current while the page stays open.
export function createActivityClock() {
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    onCleanup(() => clearInterval(timer));
  });
  return now;
}
