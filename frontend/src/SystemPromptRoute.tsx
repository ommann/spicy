import { createContext, useContext, type Accessor } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
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

  return <SystemPrompts versions={versions()} selected={Number(params.number) || 1}
    onSelect={number => navigate(`/system-prompts/${number}`, { replace: true })}
    ignored={policy.ignored} onIgnore={policy.setIgnored} />;
}
