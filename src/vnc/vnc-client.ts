/**
 * VNC connection manager — ported from mcp-vnc (src/vnc/client.ts),
 * adapted for native Pi tools (live config, AbortSignal support).
 *
 * Each operation opens a fresh connection that resolves once the first
 * full framebuffer has been received, runs the operation, then disconnects.
 */

import { VncClient } from "@computernewb/nodejs-rfb";

export interface VncConfig {
	host: string;
	port: number;
	password?: string;
}

/** Live connection config. Seeded from env; mutable via the /vnc-config command. */
const configuredPort = Number(process.env.VNC_PORT ?? "");
export const vncConfig: VncConfig = {
	host: process.env.VNC_HOST || "localhost",
	port: Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65535 ? configuredPort : 5900,
	password: process.env.VNC_PASSWORD || undefined,
};

/** Sleep that rejects promptly when the abort signal fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(done, ms);
		const onAbort = () => done();
		function done() {
			clearTimeout(t);
			signal?.removeEventListener("abort", onAbort);
			if (signal?.aborted) reject(new Error("Operation aborted"));
			else resolve();
		}
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

const CONNECT_TIMEOUT_MS = 15000;

/**
 * Fail callbacks for every in-flight VNC connection.
 *
 * nodejs-rfb invokes _readWorker() un-awaited, so a throw inside the read
 * loop (e.g. "No password supplied for VNC authentication.") surfaces as an
 * unhandled rejection, which Node escalates to uncaughtException and kills
 * the whole Pi process with it. We install a process-level unhandledRejection
 * guard while any VNC connection is live and route library-originated
 * rejections to the affected connections instead.
 */
const activeFailers = new Set<(message: string) => void>();
const failersByClient = new WeakMap<VncClient, (message: string) => void>();

const NODEJS_RFB_ORIGIN = /nodejs-rfb/;

/** Match a rejection to a VNC cause and translate it into an actionable message. */
export function classifyRejection(reason: unknown): { isVnc: boolean; message: string } {
	const isFromRfb = reason instanceof Error && NODEJS_RFB_ORIGIN.test(reason.stack ?? "");
	if (!isFromRfb) return { isVnc: false, message: reason instanceof Error ? reason.message : String(reason) };

	const raw = reason instanceof Error ? reason.message : String(reason);
	if (/no password supplied/i.test(raw)) {
		return {
			isVnc: true,
			message:
				"VNC server requires authentication but no password is configured. " +
				"Set one with /vnc-config <host[:port]> <password> or the VNC_PASSWORD env var.",
		};
	}
	return { isVnc: true, message: `VNC connection error: ${raw}` };
}

function onUnhandledRejection(reason: unknown): void {
	const { isVnc, message } = classifyRejection(reason);
	if (!isVnc) {
		// Not ours: log it rather than silently swallowing it. Node's default
		// crash-on-unhandled-rejection is already suppressed for the duration
		// of this guard because a listener is registered.
		console.error("[pi-vnc] Unhandled rejection (not VNC-related):", reason);
		return;
	}
	for (const fail of [...activeFailers]) fail(message);
}

function ensureRejectionGuard(): void {
	if (activeFailers.size === 0) process.on("unhandledRejection", onUnhandledRejection);
}

function releaseRejectionGuard(): void {
	if (activeFailers.size === 0) process.off("unhandledRejection", onUnhandledRejection);
}

export class VncConnectionManager {
	/** Execute a callback with a fresh VNC connection that has received its initial frame. */
	async executeWithConnection<T>(
		callback: (client: VncClient) => Promise<T>,
		signal?: AbortSignal,
	): Promise<T> {
		const client = await this.createConnection(signal);
		try {
			return await callback(client);
		} finally {
			this.disconnect(client);
		}
	}

	private createConnection(signal?: AbortSignal): Promise<VncClient> {
		const { host, port, password } = vncConfig;

		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				reject(new Error("Operation aborted"));
				return;
			}
			const client = new VncClient({
				debug: false,
				encodings: [
					// Raw first: avoids "Invalid subencoding" errors on some servers.
					VncClient.consts.encodings.raw,
					VncClient.consts.encodings.copyRect,
					VncClient.consts.encodings.hextile,
				],
			});

			let settled = false;
			const settle = (fn: () => void) => {
				if (!settled) {
					settled = true;
					cleanup();
					fn();
				}
			};
			const cleanup = () => {
				client.removeAllListeners();
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
			};


			let hasReceivedInitialFramebuffer = false;

			const timer = setTimeout(() => {
				settle(() => {
					activeFailers.delete(fail);
					failersByClient.delete(client);
					releaseRejectionGuard();
					try {
						client.disconnect();
					} catch {}
					reject(new Error("VNC connection timeout"));
				});
			}, CONNECT_TIMEOUT_MS);

			const onAbort = () => {
				settle(() => {
					activeFailers.delete(fail);
					failersByClient.delete(client);
					releaseRejectionGuard();
					try {
						client.disconnect();
					} catch {}
					reject(new Error("Operation aborted"));
				});
			};
			signal?.addEventListener("abort", onAbort, { once: true });

			// The library never emits "error" on the client. It emits these
			// dedicated events instead (verified against nodejs-rfb 0.4.x dist):
			// connectError (socket failure), connectTimeout, authError, closed,
			// disconnected. Without these listeners a refused connection would
			// hang until the 15s timer fires and mask the real cause.
			const fail = (message: string) => {
				settle(() => {
					activeFailers.delete(fail);
					failersByClient.delete(client);
					releaseRejectionGuard();
					try {
						client.disconnect();
					} catch {}
					reject(new Error(message));
				});
			};

			// Route nodejs-rfb's escaped rejections (its _readWorker runs
			// un-awaited) to this connection's fail(). Registered until
			// disconnect() runs: _readWorker keeps running mid-session and can
			// still throw asynchronously after the initial frame was received.
			activeFailers.add(fail);
			ensureRejectionGuard();
			failersByClient.set(client, fail);

			client.on("connectError", (error: Error) => fail(`VNC connection failed: ${error.message}`));
			client.on("connectTimeout", () => fail("VNC connection timed out"));
			client.on("authError", () => fail("VNC authentication failed"));
			client.on("closed", () => fail("VNC connection closed before the initial frame was received"));
			client.on("disconnected", () => fail("VNC disconnected before the initial frame was received"));

			client.on("authenticated", () => {
				// Server dimensions arrive in ServerInit, processed just after auth.
				// Requesting earlier is a no-op (requestFrameUpdate drops requests
				// until the framebuffer is ready and dimensions are 0), so poll
				// briefly and request a full frame once dimensions are known.
				const poll = setInterval(() => {
					if (settled) {
						clearInterval(poll);
						return;
					}
					if (client.clientWidth > 0 && client.clientHeight > 0) {
						clearInterval(poll);
						client.requestFrameUpdate(true, 0, 0, 0, client.clientWidth, client.clientHeight);
					}
				}, 50);
			});

			client.on("frameUpdated", () => {
				if (!hasReceivedInitialFramebuffer) {
					hasReceivedInitialFramebuffer = true;
					settle(() => resolve(client));
				}
			});

			client.connect({
				host,
				port,
				path: null, // required by nodejs-rfb: selects TCP instead of unix socket
				auth: password ? { password } : undefined,
			});
		});
	}

	private disconnect(client: VncClient): void {
		const fail = failersByClient.get(client);
		if (fail !== undefined) {
			activeFailers.delete(fail);
			failersByClient.delete(client);
		}
		releaseRejectionGuard();
		try {
			client.disconnect();
		} catch {}
	}

	/** Validate that coordinates are within the server's screen bounds. */
	static validateCoordinates(client: VncClient, x: number, y: number): { valid: boolean; error?: string } {
		const w = client.clientWidth || 0;
		const h = client.clientHeight || 0;

		if (w === 0 || h === 0) return { valid: true }; // dimensions not yet known

		if (x < 0 || x >= w || y < 0 || y >= h) {
			return {
				valid: false,
				error: `Coordinates (${x}, ${y}) are outside screen bounds (0, 0) to (${w - 1}, ${h - 1})`,
			};
		}
		return { valid: true };
	}
}
