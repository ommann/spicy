import { expect, test } from "vitest";
import { undent } from "../src/utils/undent.ts";

test("removes shared indentation and preserves the ending newline", () => {
	expect(undent`
		first
		  nested
		last
	`).toBe("first\n  nested\nlast\n");
});

test("preserves interpolated text exactly, including its indentation", () => {
	const content = "first\n    indented\nlast\n";
	expect(undent`
		${content}
		end
	`).toBe(`${content}\nend\n`);
});

test("omits undefined paragraphs without changing spacing inside supplied text", () => {
	const content = "second\n\n\n  indented";
	expect(undent`
		first

		${undefined}

		${content}

		${undefined}`).toBe(`first\n\n${content}`);
});

test("handles inline templates and empty values", () => {
	expect(undent`hello ${"world"}`).toBe("hello world");
	expect(undent``).toBe("");
	expect(undent`
		${""}
	`).toBe("\n");
});
