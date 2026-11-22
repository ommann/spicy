import { showcaseViews, withDatabase } from '../packages/coding-agent/src/core/session-storage.ts';
import type { ShowcaseView } from '../shared/showcase-view.ts';

export function saveShowcaseView(directory: string, view: ShowcaseView) {
  const payload = JSON.stringify(view);
  withDatabase(directory, true, db => db.insert(showcaseViews).values({ name: view.name, payload })
    .onConflictDoUpdate({ target: showcaseViews.name, set: { payload } }).run());
}
