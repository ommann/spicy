import type { ExtensionFactory } from "../../core/extensions/types.ts";
import { createReadManyToolDefinition } from "../../core/tools/read-many.ts";

const readManyExtension: ExtensionFactory = (pi) => {
	pi.registerTool(createReadManyToolDefinition(process.cwd()));
};

export default readManyExtension;
