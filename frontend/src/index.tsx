import { render } from 'solid-js/web';
import { Route, Router } from '@solidjs/router';
import App from './App';
import ChatRoute from './ChatRoute';
import SystemPromptRoute from './SystemPromptRoute';
import SystemPromptCreator from './SystemPromptCreator';
import './style.css';

render(() => (
  <Router root={App}>
    <Route path="/" component={ChatRoute} />
    <Route path="/system-prompts/:id?" component={SystemPromptRoute} />
    <Route path="/system-prompt-creator" component={SystemPromptCreator} />
  </Router>
), document.getElementById('root')!);
