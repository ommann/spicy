/** Remove shared indentation; omit standalone undefined paragraphs. Interpolated text stays unchanged. */
export function undent(strings: TemplateStringsArray, ...values: unknown[]): string {
	let marker = "\0";
	while (strings.some((text) => text.includes(marker))) marker += "\0";

	const source = strings
		.reduce((text, literal, index) => text + (index ? `${marker}${index - 1}${marker}` : "") + literal, "")
		.replace(/^\r?\n/, "");
	const indents = [...source.matchAll(/^[\t ]*(?=\S)/gm)].map((match) => match[0].length);
	const indentation = Math.min(...indents);
	const unindented = source.replace(/^[\t ]+/gm, (spaces) => spaces.slice(indentation));
	const slot = new RegExp(`^${marker}(\\d+)${marker}$`);
	const paragraphs = unindented
		.split("\n\n")
		.filter((paragraph) => {
			const match = paragraph.match(slot);
			return !match || values[Number(match[1])] !== undefined;
		})
		.join("\n\n");
	return paragraphs.replace(new RegExp(`${marker}(\\d+)${marker}`, "g"), (_, index: string) =>
		String(values[Number(index)]),
	);
}
