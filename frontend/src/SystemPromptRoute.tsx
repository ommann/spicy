import { createContext, Show, useContext, type Accessor } from 'solid-js';
import { A, useNavigate, useParams } from '@solidjs/router';
import Navigation from './Navigation';
import SystemPrompts from './SystemPrompts';
import type { Wire } from './types';

export interface PromptVersion {
  key: string;
  number: number;
  previousNumber?: number;
  previousKey?: string;
  detail: Wire;
  full?: Wire;
  unified?: Wire;
  candidateKey?: string;
  priorityReason?: string;
  title?: string;
}

export const SystemPromptContext = createContext<Accessor<PromptVersion[]>>(() => []);
export const SystemPromptPolicyContext = createContext({
  ignored: (_key: string): boolean => false,
  setIgnored: (_key: string, _ignored: boolean): void => {},
});

export default function SystemPromptRoute() {
  const versions = useContext(SystemPromptContext);
  const policy = useContext(SystemPromptPolicyContext);
  const params = useParams();
  const navigate = useNavigate();

  const selected = () => params.id ? versions().find(version => version.full?.id === params.id) : versions()[0];

  return <Show when={!params.id || selected()} fallback={<>
    <Navigation />
    <p>System prompt not found. <A href="/system-prompts">View system prompts</A></p>
  </>}><SystemPrompts versions={versions()}
    selected={selected()?.key || ''}
    onSelect={key => {
      const version = versions().find(version => version.key === key);
      if (version?.full) navigate(`/system-prompts/${encodeURIComponent(version.full.id)}`, { replace: true });
    }}
    ignored={policy.ignored} onIgnore={policy.setIgnored} /></Show>;
}
