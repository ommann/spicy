import type { ExtensionFactory } from "../../core/extensions/types.ts";
import { createEditManyToolDefinition } from "../../core/tools/edit-many.ts";

const editManyExtension: ExtensionFactory = (pi) => {
	pi.registerTool(createEditManyToolDefinition(process.cwd()));
};

export default editManyExtension;
