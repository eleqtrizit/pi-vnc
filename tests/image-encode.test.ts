import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodePng } from "../src/vnc/image-encode.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Minimal PNG chunk parser: returns chunks as { type, data } (skips signature). */
function parseChunks(png: Buffer): { type: string; data: Buffer }[] {
	const chunks: { type: string; data: Buffer }[] = [];
	let offset = 8;
	while (offset < png.length) {
		const length = png.readUInt32BE(offset);
		const type = png.toString("ascii", offset + 4, offset + 8);
		chunks.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
		offset += 12 + length;
	}
	return chunks;
}

describe("encodePng", () => {
	it("produces a valid PNG structure for a 2x2 RGBA image", () => {
		const rgba = Buffer.from([
			255, 0, 0, 255, 0, 255, 0, 255, //
			0, 0, 255, 255, 255, 255, 255, 0,
		]);
		const png = encodePng(2, 2, rgba);

		expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
		const chunks = parseChunks(png);
		expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);

		const ihdr = chunks[0].data;
		expect(ihdr.readUInt32BE(0)).toBe(2); // width
		expect(ihdr.readUInt32BE(4)).toBe(2); // height
		expect(ihdr[8]).toBe(8); // bit depth
		expect(ihdr[9]).toBe(6); // color type RGBA
		expect(ihdr[10]).toBe(0); // compression
		expect(ihdr[11]).toBe(0); // filter
		expect(ihdr[12]).toBe(0); // interlace
	});

	it("round-trips pixels through inflate (filter byte 0 per scanline)", () => {
		const rgba = Buffer.alloc(2 * 1 * 4);
		rgba[0] = 10; // r of pixel 0
		rgba[6] = 200; // b of pixel 1
		const png = encodePng(2, 1, rgba);
		const idat = parseChunks(png).find((c) => c.type === "IDAT")!.data;
		const raw = inflateSync(idat);

		// Single scanline: filter byte 0, then 2 pixels of RGBA
		expect(raw[0]).toBe(0);
		expect([...raw.subarray(1)]).toEqual([10, 0, 0, 0, 0, 0, 200, 0]);
	});
});
