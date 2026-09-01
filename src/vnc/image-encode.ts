/**
 * Pure-JS RGBA → PNG encoder and box-average downscaler.
 *
 * Replaces sharp so the extension has no native, per-arch binaries
 * (sharp ships linux-x64 prebuilds only, which broke arm64 hosts).
 * Node's zlib handles both the deflate and the CRC.
 */

import { deflateSync, crc32 } from "node:zlib";

interface PngResult {
	buffer: Buffer;
	width: number;
	height: number;
}

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

/**
 * Downscale RGBA by box averaging: each output pixel averages the input
 * square that maps onto it. Good enough for the oversized-screenshot path.
 *
 * :param width: Source width
 * :param height: Source height
 * :param rgba: Source RGBA data
 * :param outWidth: Target width (must be <= width)
 * :param outHeight: Target height (must be <= height)
 * :return: Downscaled RGBA data
 */
export function downscaleRgba(
	width: number,
	height: number,
	rgba: Buffer,
	outWidth: number,
	outHeight: number,
): Buffer {
	const out = Buffer.alloc(outWidth * outHeight * 4);
	const stepX = width / outWidth;
	const stepY = height / outHeight;

	for (let oy = 0; oy < outHeight; oy++) {
		const y0 = Math.floor(oy * stepY);
		const y1 = Math.min(height, Math.max(y0 + 1, Math.floor((oy + 1) * stepY)));
		for (let ox = 0; ox < outWidth; ox++) {
			const x0 = Math.floor(ox * stepX);
			const x1 = Math.min(width, Math.max(x0 + 1, Math.floor((ox + 1) * stepX)));

			let r = 0, g = 0, b = 0, a = 0, n = 0;
			for (let y = y0; y < y1; y++) {
				let i = (y * width + x0) * 4;
				for (let x = x0; x < x1; x++, i += 4) {
					r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; a += rgba[i + 3];
					n++;
				}
			}
			const o = (oy * outWidth + ox) * 4;
			out[o] = Math.round(r / n);
			out[o + 1] = Math.round(g / n);
			out[o + 2] = Math.round(b / n);
			out[o + 3] = Math.round(a / n);
		}
	}
	return out;
}

/**
 * Encode a framebuffer as PNG, downscaling once if the result exceeds the
 * size budget (same policy as the previous sharp-based JPEG path, but PNG).
 *
 * :param width: Framebuffer width
 * :param height: Framebuffer height
 * :param framebuffer: Raw RGBA pixel data
 * :param maxBytes: Maximum encoded size before downscaling
 * :return: Encoded image with final dimensions
 */
export function encodeFramebuffer(
	width: number,
	height: number,
	framebuffer: Buffer,
	maxBytes: number,
): PngResult {
	const encoded = encodePng(width, height, framebuffer);
	if (encoded.length <= maxBytes) {
		return { buffer: encoded, width, height };
	}

	// Shrink area by the same ratio the sharp path used.
	const scaleFactor = Math.sqrt(maxBytes / encoded.length);
	const finalWidth = Math.max(1, Math.floor(width * scaleFactor));
	const finalHeight = Math.max(1, Math.floor(height * scaleFactor));
	const resized = downscaleRgba(width, height, framebuffer, finalWidth, finalHeight);
	return { buffer: encodePng(finalWidth, finalHeight, resized), width: finalWidth, height: finalHeight };
}
