import { For, Show } from 'solid-js';
import Card from './Card';
import { ConversationCard, type ConversationView } from './Conversation';
import SystemPromptReference from './SystemPromptReference';
import SystemPromptPlaceholder from './SystemPromptPlaceholder';
import { isUnstartedCompaction } from './conversation-model.mjs';
import { promptLabel } from './prompt-numbers';

export function ConversationPrompt(value: { view: ConversationView; index: number }) {
  const { props, layout, gridPlacement, spacing, workingWidth, versionFor } = value.view;
  const leaf = () => props.graph.leaves[value.index];
  return <Show when={leaf()?.entry.type !== 'branch_draft' && props.graph.prefix.get(leaf().id).captured}>
    <article class="tree-node"
      style={{ ...gridPlacement(layout().inset + layout().starts[value.index], layout().promptTop ?? spacing().row, workingWidth()), width: `${workingWidth()}px` }}>
      <Card><Show when={isUnstartedCompaction(props.graph, leaf().id)} fallback={
        <SystemPromptReference entryId={leaf().id} promptId={versionFor(leaf().id)?.full?.id || ''}
          title={versionFor(leaf().id)?.title} number={versionFor(leaf().id)?.number || 1}
          health={props.health(leaf().id)} href={props.systemPromptHref(versionFor(leaf().id)?.full?.id || '')} />
      }>
        <SystemPromptPlaceholder
          number={(props.prompts.find(prompt => prompt.key === props.pendingPromptKey?.(leaf().id)) ?? versionFor(leaf().id))?.number}
          title={(props.prompts.find(prompt => prompt.key === props.pendingPromptKey?.(leaf().id)) ?? versionFor(leaf().id))?.title}
          selection={{
            value: props.pendingPromptKey?.(leaf().id) ?? versionFor(leaf().id)?.key ?? '',
            options: props.prompts.map(prompt => ({ value: prompt.key,
              label: `${promptLabel(prompt.number, prompt.title)}${prompt.key === versionFor(leaf().id)?.key ? ' (inherited)' : ''}` })),
            onChange: key => props.onSelectBranchPrompt(leaf().id, key === versionFor(leaf().id)?.key ? undefined : key),
          }} />
      </Show></Card>
    </article>
  </Show>;
}

export function ConversationNodes(value: { view: ConversationView }) {
  const { props, nodeIds, inheritedVersion, versionFor, layout, gridPlacement, scroll, spacing,
    registerSection, workingWidth, dismissBranch, observe, unobserve } = value.view;
  return <For each={nodeIds()}>{id => {
    const node = () => props.graph.nodes.get(id);
    const inheritedKey = () => inheritedVersion(id)?.key;
    const selection = () => node().entry.type === 'branch_draft' && node().entry.draftSourceId ? {
      value: node().entry.draftPromptKey ?? inheritedKey() ?? '',
      options: props.prompts.map(prompt => ({ value: prompt.key,
        label: `${promptLabel(prompt.number, prompt.title)}${prompt.key === inheritedKey() ? ' (inherited)' : ''}` })),
      onChange: (key: string) => props.onSelectBranchPrompt(id, key === inheritedKey() ? undefined : key),
    } : undefined;
    const promptRoot = () => props.graph.prefix.get(id).rootId;
    return <ConversationCard id={id} node={node()} position={layout().items.get(id)}
      gridStyle={gridPlacement(layout().items.get(id).left, layout().items.get(id).top, layout().items.get(id).span)}
      promptNumber={versionFor(id)?.number} promptTitle={versionFor(id)?.title} scrollTop={scroll().top}
      promptRowTop={layout().items.get(promptRoot())?.top ?? layout().promptTop ?? spacing().row} selection={selection()}
      registerSection={registerSection} width={workingWidth()}
      onBranch={sourceId => props.onBranch(sourceId, props.graph.leaves[layout().items.get(id).column]?.id)} onDismiss={dismissBranch}
      measure={(key, element) => observe(key, element, 'node')} unmeasure={unobserve} />;
  }}</For>;
}
