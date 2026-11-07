import { For } from 'solid-js';
import Conversation, { type ConversationRouteProps } from './Conversation';
import { ConversationNodes, ConversationPrompt } from './ConversationCards';
import { layoutConversation } from './conversation-model.mjs';

export default function TreeConversation(props: ConversationRouteProps) {
  return <Conversation {...props} mode="side" layout={layoutConversation}>{view => <>
    <svg class="tree-connections" aria-hidden="true" width={view.layout().width} height={view.layout().height}>
      <For each={view.layout().paths}>{path => <path d={path.d} classList={{ 'fork-connection': path.fork }} />}</For>
    </svg>
    <For each={props.graph.leaves}>{(_, index) => <ConversationPrompt view={view} index={index()} />}</For>
    <ConversationNodes view={view} />
  </>}</Conversation>;
}
