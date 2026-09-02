/**
 * Pure-JS RGBA → PNG encoder and box-average downscaler.
 *
 * Replaces sharp so the extension has no native, per-arch binaries
 * (sharp ships linux-x64 prebuilds only, which broke arm64 hosts).
 * Node's zlib handles both the deflate and the CRC.
 */

import { deflateSync, crc32 } from "node:zlib";

function chunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body) >>> 0);
	return Buffer.concat([len, body, crc]);
}

/**
 * Encode a raw RGBA framebuffer as PNG (8-bit, color type 6).
 *
 * :param width: Image width in pixels
 * :param height: Image height in pixels
 * :param rgba: Raw RGBA pixel data (width * height * 4 bytes)
 * :return: Encoded PNG
 */
export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type RGBA

	// Each scanline gets a filter byte; filter 0 (none) is fine for zlib.
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0;
		rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
	}

	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	return Buffer.concat([
		signature,
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw, { level: 6 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}


