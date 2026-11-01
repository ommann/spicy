// UTW's task-handle contract, shared by the browser and proxy.
export const taskIdSegment = '[a-z][a-z0-9_-]{0,63}-[23456789abcdefghjkmnpqrstuvwxyz]{6}';
export const taskIdPattern = new RegExp(`^${taskIdSegment}$`);
