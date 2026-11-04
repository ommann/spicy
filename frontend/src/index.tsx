import { render } from 'solid-js/web';
import { Route, Router } from '@solidjs/router';
import App from './App';
import ChatRoute from './ChatRoute';
import { SessionsRoute } from './Sessions';
import SystemPromptRoute from './SystemPromptRoute';
import SystemPromptCreator from './SystemPromptCreator';
import './style.css';

render(() => (
  <Router root={App}>
    <Route path="/" component={SessionsRoute} />
    <Route path="/chat" component={ChatRoute} />
    <Route path="/system-prompts/:id?" component={SystemPromptRoute} />
    <Route path="/system-prompt-creator" component={SystemPromptCreator} />
    <Route path="/:sessionUrlId" component={ChatRoute} />
    <Route path="/:sessionUrlId/system-prompts/:id?" component={SystemPromptRoute} />
    <Route path="/:sessionUrlId/system-prompt-creator" component={SystemPromptCreator} />
  </Router>
), document.getElementById('root')!);
