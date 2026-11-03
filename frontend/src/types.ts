// Pi allows extension-defined roles, blocks and entry fields. Keep unknown wire
// fields at this boundary; UI topology and component props are explicitly typed.
export type Wire = Record<string, any>;
export interface Entry extends Wire { id: string; parentId: string | null; type: string; message?: Wire }
export interface TreeNode { entry: Entry; parent: TreeNode | null; children: TreeNode[]; depth: number; column: number; span: number }
export interface Session { id: string; name: string; modified: number; managed: boolean }
export interface Snapshot { agentId?: string; entries: Entry[]; leafId: string | null; state: Wire | null; live: Wire[]; dialogs: Wire[]; connected: boolean; running: boolean; cwd: string; diagnostic: string }
