import { For } from 'solid-js';
import Conversation, { type ConversationRouteProps } from './Conversation';
import { ConversationNodes, ConversationPrompt } from './ConversationCards';
import { layoutConversation } from './conversation-model.mjs';

export default function TreeConversation(props: ConversationRouteProps) {
  return <Conversation {...props} mode="side" layout={layoutConversation}>{view => <>
    <svg class="tree-connections" aria-hidden="true" width={view.layout().width} height={view.layout().height}>
      <path class="fork-connection" d={view.layout().paths.map((path: { d: string }) => path.d).join(' ')} />
    </svg>
    <For each={props.graph.leaves}>{(_, index) => <ConversationPrompt view={view} index={index()} />}</For>
    <ConversationNodes view={view} />
  </>}</Conversation>;
}
