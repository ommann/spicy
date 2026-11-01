import { render } from 'solid-js/web';
import { Route, Router } from '@solidjs/router';
import App from './App';
import SystemPromptRoute from './SystemPromptRoute';
import './style.css';

render(() => (
  <Router root={App}>
    <Route path="/" component={() => null} />
    <Route path="/system-prompts/:number?" component={SystemPromptRoute} />
  </Router>
), document.getElementById('root')!);
