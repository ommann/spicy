import Conversation, { type ConversationRouteProps } from './Conversation';
import { ConversationNodes, ConversationPrompt } from './ConversationCards';
import { layoutSingleConversation } from './single-conversation-model.mjs';
import './single-conversation.css';

export default function SingleConversation(props: ConversationRouteProps) {
  return <Conversation {...props} mode="focused" layout={layoutSingleConversation}>{view => <>
    <ConversationPrompt view={view} index={view.focused()} />
    <ConversationNodes view={view} />
  </>}</Conversation>;
}
