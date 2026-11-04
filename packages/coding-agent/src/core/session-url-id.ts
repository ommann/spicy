import { randomInt } from "node:crypto";

export const SESSION_URL_ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Allocate a permanent URL ID, retrying rather than truncating an existing ID. */
export function createSessionUrlId(used: ReadonlySet<string>, pick: (max: number) => number = randomInt): string {
	for (;;) {
		let id = "";
		for (let i = 0; i < 8; i++) id += SESSION_URL_ID_ALPHABET[pick(SESSION_URL_ID_ALPHABET.length)];
		if (!used.has(id)) return id;
	}
}
