import { render } from 'solid-js/web';
import { Route, Router } from '@solidjs/router';
import App from './App';
import ChatRoute, { SingleChatRoute, TreeChatRoute } from './ChatRoute';
import { SessionsRoute } from './Sessions';
import SystemPromptRoute from './SystemPromptRoute';
import SystemPromptCreator from './SystemPromptCreator';
import './style.css';

render(() => (
  <Router root={App}>
    <Route path="/" component={SessionsRoute} />
    <Route path="/chat" component={ChatRoute} />
    <Route path="/single" component={SingleChatRoute} />
    <Route path="/tree" component={TreeChatRoute} />
    <Route path="/system-prompts/:id?" component={SystemPromptRoute} />
    <Route path="/system-prompt-creator" component={SystemPromptCreator} />
    <Route path="/b/:branchId" component={SingleChatRoute} />
    <Route path="/t/:treeId/:branchId?" component={TreeChatRoute} />
    <Route path="/b/:branchId/system-prompts/:id?" component={SystemPromptRoute} />
    <Route path="/b/:branchId/system-prompt-creator" component={SystemPromptCreator} />
    <Route path="/:sessionUrlId" component={ChatRoute} />
    <Route path="/:sessionUrlId/single" component={SingleChatRoute} />
    <Route path="/:sessionUrlId/tree" component={TreeChatRoute} />
    <Route path="/:sessionUrlId/system-prompts/:id?" component={SystemPromptRoute} />
    <Route path="/:sessionUrlId/system-prompt-creator" component={SystemPromptCreator} />
  </Router>
), document.getElementById('root')!);
