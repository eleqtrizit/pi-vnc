/**
 * The six VNC tools — ported from mcp-vnc (src/tools/input.ts, src/tools/screenshot.ts)
 * into native Pi ToolDefinitions. Behavioral notes:
 *
 * - Errors are thrown (native tool errors) instead of returned as text.
 * - Click/key/typing timing preserved exactly from mcp-vnc.
 * - Screenshot keeps the pixel-format conversion paths (RGB24/RGB565/8bpp -> RGBA),
 *   always encodes at native dimensions (never resized, so click coordinates map
 *   1:1 to the image), and has no delay parameter (the agent controls its own
 *   timing). Pure-JS PNG encoder, no sharp. Dropped: corruption-pattern heuristics and
 *   dead BGRX conversion (never invoked upstream) and all debug logging.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { VncClient } from "@computernewb/nodejs-rfb";
import { encodePng } from "./image-encode.js";
import { VncConnectionManager, sleep } from "./vnc-client.js";
import { charNeedsShift, getKeysym, getUnshiftedChar, parseKeyInput } from "./keyboard.js";

// ── Shared helpers ───────────────────────────────────────────────────────────

const BUTTON_MASK = { left: 0x01, middle: 0x02, right: 0x04 } as const;

function withConnection<T>(work: (client: VncClient, signal?: AbortSignal) => Promise<T>, signal?: AbortSignal) {
	const manager = new VncConnectionManager();
	return manager.executeWithConnection((client) => work(client, signal), signal);
}

function checkCoordinates(client: VncClient, x: number, y: number) {
	const validation = VncConnectionManager.validateCoordinates(client, x, y);
	if (!validation.valid) throw new Error(validation.error!);
}

async function pressKey(client: VncClient, keysym: number, signal: AbortSignal | undefined, downMs: number) {
	client.sendKeyEvent(keysym, true);
	try {
		await sleep(downMs, signal);
	} finally {
		// Release even if the abort signal fired mid-press so we never leave
		// a key held down.
		client.sendKeyEvent(keysym, false);
	}
}

async function typeCharacter(client: VncClient, char: string, holdMs: number, betweenMs: number, signal?: AbortSignal) {
	const needsShift = charNeedsShift(char);
	const keysym = getKeysym(needsShift ? getUnshiftedChar(char) : char);
	const heldKeys: number[] = [];

	try {
		if (needsShift) {
			const shiftKeysym = getKeysym("Shift");
			client.sendKeyEvent(shiftKeysym, true);
			heldKeys.push(shiftKeysym);
			await sleep(10, signal);
		}

		client.sendKeyEvent(keysym, true);
		heldKeys.push(keysym);
		await sleep(holdMs, signal);
	} finally {
		// Release in reverse order even on abort so no key stays held down.
		for (const keysymToRelease of heldKeys.reverse()) {
			client.sendKeyEvent(keysymToRelease, false);
		}
	}

	await sleep(betweenMs, signal);
}

async function typeString(client: VncClient, text: string, signal?: AbortSignal) {
	// Slower timing for text with special chars or long strings — same heuristic as mcp-vnc
	const hasSpecialChars = /[|:;&<>?/\\~`!@#$%^*()+=\[\]{}'",-]/.test(text);
	const useSlowTyping = hasSpecialChars || text.length > 10;
	const holdMs = useSlowTyping ? 75 : 50;
	const betweenMs = useSlowTyping ? 100 : 50;

	for (const char of text) {
		await typeCharacter(client, char, holdMs, betweenMs, signal);
	}
}

// ── vnc_click ────────────────────────────────────────────────────────────────

const clickSchema = Type.Object({
	x: Type.Number({ description: "X coordinate" }),
	y: Type.Number({ description: "Y coordinate" }),
	button: Type.Optional(
		Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")], {
			description: "Mouse button",
			default: "left",
		}),
	),
	double: Type.Optional(Type.Boolean({ description: "Double-click instead of single click", default: false })),
});
type ClickInput = Static<typeof clickSchema>;

export const clickTool: ToolDefinition<typeof clickSchema, undefined> = {
	name: "vnc_click",
	label: "vnc_click",
	description: "Click at specified coordinates on the VNC-controlled desktop. Default is a single left click; supports right/middle buttons and double-click.",
	parameters: clickSchema,
	execute: async (_id, args, signal) => {
		const { x, y, button = "left", double = false } = args;
		const mask = BUTTON_MASK[button];

		return withConnection(async (client) => {
			checkCoordinates(client, x, y);

			if (double) {
				client.sendPointerEvent(x, y, mask);
				await sleep(50, signal);
				client.sendPointerEvent(x, y, 0);
				await sleep(50, signal);
				client.sendPointerEvent(x, y, mask);
				await sleep(50, signal);
				client.sendPointerEvent(x, y, 0);
			} else {
				client.sendPointerEvent(x, y, mask);
				await sleep(100, signal);
				client.sendPointerEvent(x, y, 0);
			}

			return { content: [{ type: "text", text: `${double ? "double-clicked" : "clicked"} ${button} button at (${x}, ${y})` }], details: undefined };
		}, signal);
	},
};

// ── vnc_move_mouse ───────────────────────────────────────────────────────────

const moveSchema = Type.Object({
	x: Type.Number({ description: "X coordinate" }),
	y: Type.Number({ description: "Y coordinate" }),
});
type MoveInput = Static<typeof moveSchema>;

export const moveTool: ToolDefinition<typeof moveSchema, undefined> = {
	name: "vnc_move_mouse",
	label: "vnc_move_mouse",
	description: "Move mouse to specified coordinates on the VNC-controlled desktop without clicking.",
	parameters: moveSchema,
	execute: async (_id, args, signal) => {
		const { x, y } = args;
		return withConnection(async (client) => {
			checkCoordinates(client, x, y);
			client.sendPointerEvent(x, y, 0);
			return { content: [{ type: "text", text: `Moved mouse to (${x}, ${y})` }], details: undefined };
		}, signal);
	},
};

// ── vnc_key_press ────────────────────────────────────────────────────────────

const keySchema = Type.Object({
	key: Type.String({
		description:
			'Key to press. Single keys: "a", "Enter", "F1". Combinations: "Ctrl+c", "Alt+F4", "Ctrl+Alt+Delete", "Shift+Tab"',
	}),
});
type KeyInput = Static<typeof keySchema>;

export const keyTool: ToolDefinition<typeof keySchema, undefined> = {
	name: "vnc_key_press",
	label: "vnc_key_press",
	description: "Press a key or key combination on the VNC-controlled desktop. Supports single keys (e.g. Enter, F1) and modifier combos (Ctrl+c, Alt+F4, Ctrl+Alt+Delete).",
	parameters: keySchema,
	execute: async (_id, args, signal) => {
		const { modifiers, key } = parseKeyInput(args.key);
		// Resolve every keysym before any key-down is sent so an unknown key
		// name fails cleanly instead of leaving modifiers held down.
		const modifierKeysyms = modifiers.map((mod) => getKeysym(mod));
		const keysym = getKeysym(key);

		return withConnection(async (client) => {
			if (modifiers.length === 0) {
				await pressKey(client, keysym, signal, 50);
			} else {
				// Modifiers down, main key, then release in reverse order. The
				// finally guarantees release even if an abort lands mid-press.
				const held: number[] = [];
				try {
					for (const modKeysym of modifierKeysyms) {
						client.sendKeyEvent(modKeysym, true);
						held.push(modKeysym);
						await sleep(10, signal);
					}
					client.sendKeyEvent(keysym, true);
					await sleep(50, signal);
				} finally {
					client.sendKeyEvent(keysym, false);
					// Release synchronously so an abort or throw can't cut the
					// release sequence short.
					for (let i = held.length - 1; i >= 0; i--) {
						client.sendKeyEvent(held[i], false);
					}
				}
			}
			return { content: [{ type: "text", text: `Pressed key combination: ${args.key}` }], details: undefined };
		}, signal);
	},
};

// ── vnc_type_text ────────────────────────────────────────────────────────────

const typeTextSchema = Type.Object({
	text: Type.String({ description: "Single line of text to type" }),
	enter: Type.Optional(Type.Boolean({ description: "Press Enter after typing text", default: false })),
});
type TypeTextInput = Static<typeof typeTextSchema>;

export const typeTextTool: ToolDefinition<typeof typeTextSchema, undefined> = {
	name: "vnc_type_text",
	label: "vnc_type_text",
	description: "Type a single line of text into the VNC-controlled desktop. Optionally press Enter afterwards.",
	parameters: typeTextSchema,
	execute: async (_id, args, signal) => {
		return withConnection(async (client) => {
			await typeString(client, args.text, signal);
			if (args.enter) await pressKey(client, getKeysym("Return"), signal, 50);
			return { content: [{ type: "text", text: `Typed text: ${args.text}${args.enter ? " + Enter" : ""}` }], details: undefined };
		}, signal);
	},
};

// ── vnc_type_multiline ───────────────────────────────────────────────────────

const typeMultilineSchema = Type.Object({
	lines: Type.Array(Type.String(), { description: "Array of lines to type; each line is followed by Enter" }),
});
type TypeMultilineInput = Static<typeof typeMultilineSchema>;

export const typeMultilineTool: ToolDefinition<typeof typeMultilineSchema, undefined> = {
	name: "vnc_type_multiline",
	label: "vnc_type_multiline",
	description: "Type multiple lines of text into the VNC-controlled desktop, pressing Enter after each line.",
	parameters: typeMultilineSchema,
	execute: async (_id, args, signal) => {
		return withConnection(async (client) => {
			for (const line of args.lines) {
				await typeString(client, line, signal);
				await pressKey(client, getKeysym("Return"), signal, 50);
				await sleep(100, signal); // brief pause between lines
			}
			return { content: [{ type: "text", text: `Typed ${args.lines.length} lines: ${args.lines.join(" | ")}` }], details: undefined };
		}, signal);
	},
};

// ── vnc_screenshot ───────────────────────────────────────────────────────────

const screenshotSchema = Type.Object({});
type ScreenshotInput = Static<typeof screenshotSchema>;

/** Convert a non-4-byte-per-pixel framebuffer to RGBA (RGB24, RGB565, 8-bit). */
function convertToRGBA(buffer: Buffer, width: number, height: number): Buffer {
	const pixelCount = width * height;
	const bpp = buffer.length / pixelCount;
	const out = Buffer.alloc(pixelCount * 4);

	if (bpp === 3) {
		// RGB24 -> RGBA
		for (let i = 0; i < pixelCount; i++) {
			const src = i * 3;
			const dst = i * 4;
			out[dst] = buffer[src];
			out[dst + 1] = buffer[src + 1];
			out[dst + 2] = buffer[src + 2];
			out[dst + 3] = 255;
		}
		return out;
	}

	if (bpp === 2) {
		// RGB565 (little-endian) -> RGBA
		for (let i = 0; i < pixelCount; i++) {
			const src = i * 2;
			const dst = i * 4;
			const pixel16 = buffer[src] | (buffer[src + 1] << 8);
			const r5 = (pixel16 >> 11) & 0x1f;
			const g6 = (pixel16 >> 5) & 0x3f;
			const b5 = pixel16 & 0x1f;
			out[dst] = (r5 * 255) / 31;
			out[dst + 1] = (g6 * 255) / 63;
			out[dst + 2] = (b5 * 255) / 31;
			out[dst + 3] = 255;
		}
		return out;
	}

	if (bpp === 1) {
		// 8-bit palette-based: grayscale approximation (same as mcp-vnc)
		for (let i = 0; i < pixelCount; i++) {
			const dst = i * 4;
			const c = buffer[i];
			out[dst] = c;
			out[dst + 1] = c;
			out[dst + 2] = c;
			out[dst + 3] = 255;
		}
		return out;
	}

	throw new Error(`Unsupported VNC pixel format: ${bpp} bytes per pixel`);
}

interface ScreenshotDetails {
	width: number;
	height: number;
}

export const screenshotTool: ToolDefinition<typeof screenshotSchema, ScreenshotDetails> = {
	name: "vnc_screenshot",
	label: "vnc_screenshot",
	description: "Take a screenshot of the VNC-controlled desktop and return it as an image. Returns the framebuffer at native dimensions, so click coordinates map 1:1 to the image.",
	parameters: screenshotSchema,
	execute: async (_id, _args, signal) => {
		return withConnection(async (client) => {
			const width = client.clientWidth || 0;
			const height = client.clientHeight || 0;
			if (!width || !height) throw new Error(`Invalid screen dimensions: ${width}x${height}`);

			// Fresh frame with a short timeout; fall back to the existing framebuffer
			let framebuffer: Buffer | null = null;
			try {
				client.requestFrameUpdate(true, 0, 0, width, height);
				framebuffer = await new Promise<Buffer>((resolve, reject) => {
					let settled = false;
					const handler = (fb: Buffer) => done(() => resolve(fb));
					const timer = setTimeout(() => done(() => reject(new Error("Frame update timeout"))), 2000);
					const onAbort = () => done(() => reject(new Error("Operation aborted")));
					const done = (fn: () => void) => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						client.removeListener("frameUpdated", handler);
						signal?.removeEventListener("abort", onAbort);
						fn();
					};
					client.once("frameUpdated", handler);
					signal?.addEventListener("abort", onAbort, { once: true });
				});
			} catch (error) {
				// A timeout falls back to the existing framebuffer; an explicit
				// abort must cancel the tool call instead.
				if (signal?.aborted) throw error;
				framebuffer = client.fb;
			}

			if (!framebuffer) throw new Error("No framebuffer available");

			// Convert non-RGBA formats
			if (framebuffer.length / (width * height) !== 4) {
				framebuffer = convertToRGBA(framebuffer, width, height);
			}

			const expectedSize = width * height * 4;
			if (framebuffer.length !== expectedSize) {
				throw new Error(`Framebuffer size mismatch: expected ${expectedSize}, got ${framebuffer.length}`);
			}

			const imageBuffer = encodePng(width, height, framebuffer);

			return {
				content: [
					{ type: "text", text: `Screenshot captured (${width}x${height}) — ${
						(imageBuffer.length / 1024).toFixed(0)
					}KB` },
					{ type: "image", data: imageBuffer.toString("base64"), mimeType: "image/png" },
				],
				details: { width, height },
			};
		}, signal);
	},
};

// ── Exports ──────────────────────────────────────────────────────────────────

export const vncTools = [clickTool, moveTool, keyTool, typeTextTool, typeMultilineTool, screenshotTool];
