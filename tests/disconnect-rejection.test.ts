import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VncConnectionManager } from "../src/vnc/vnc-client.js";

/**
 * Regression tests for the uncaughtException crash reported on Windows:
 * nodejs-rfb's disconnect() synchronously rejects the read loop's pending
 * awaiter (socketBuffer.end() in resetState()). If the unhandledRejection
 * guard is released before disconnect() runs, that rejection reaches Node
 * with no listener attached and the process dies with uncaughtException.
 *
 * FakeVncClient emulates this precisely: connect() starts an un-awaited
 * read awaiter; disconnect() rejects it synchronously before emitting
 * "disconnected".
 */
vi.mock("@computernewb/nodejs-rfb", () => {
	const instances: InstanceType<typeof FakeVncClient>[] = [];

	class FakeVncClient {
		static consts = { encodings: { raw: 0, copyRect: 1, hextile: 2 } };
		clientWidth = 100;
		clientHeight = 100;
		private handlers = new Map<string, ((...args: unknown[]) => void)[]>();
		private pendingReject?: (error: Error) => void;

		on(event: string, handler: (...args: unknown[]) => void): this {
			const list = this.handlers.get(event) ?? [];
			list.push(handler);
			this.handlers.set(event, list);
			return this;
		}

		private emit(event: string, ...args: unknown[]): void {
			for (const handler of [...(this.handlers.get(event) ?? [])]) handler(...args);
		}

		removeAllListeners(): void {
			this.handlers.clear();
		}

		connect(): void {
			// Emulates nodejs-rfb's _readWorker: an un-awaited awaiter whose
			// rejection during disconnect() surfaces as unhandledRejection.
			new Promise((_resolve, reject) => {
				this.pendingReject = reject;
			});
			queueMicrotask(() => {
				this.emit("authenticated");
				this.emit("frameUpdated");
			});
		}

		requestFrameUpdate(): void {
			queueMicrotask(() => this.emit("frameUpdated"));
		}

		disconnect(): void {
			const reject = this.pendingReject;
			this.pendingReject = undefined;
			if (reject) reject(new Error("This socket has been ended by the other party"));
			this.emit("disconnected");
		}
	}

	return { VncClient: FakeVncClient, __instances: instances };
});

describe("disconnect-time rejection handling", () => {
	let baselineListeners: number;
	let lateRejectionSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		baselineListeners = process.listenerCount("unhandledRejection");
		lateRejectionSpy = vi.fn();
		process.on("unhandledRejection", lateRejectionSpy);
	});

	afterEach(() => {
		process.off("unhandledRejection", lateRejectionSpy);
	});

	async function runOperation(manager: VncConnectionManager): Promise<void> {
		await manager.executeWithConnection(async () => "ok");
	}

	it("survives a rejection raised synchronously by disconnect()", async () => {
		const manager = new VncConnectionManager();
		await runOperation(manager);
		await new Promise((resolve) => setTimeout(resolve, 20));

		// The process-level guard routed the rejection; nothing crashed.
		expect(lateRejectionSpy).toHaveBeenCalled();
	});

	it("detaches the guard after the last connection ends", async () => {
		const manager = new VncConnectionManager();
		await runOperation(manager);
		await runOperation(manager);
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(process.listenerCount("unhandledRejection")).toBe(baselineListeners + 1);
	});

	it("re-attaches the guard for a connection created while a release is pending", async () => {
		const manager = new VncConnectionManager();
		await runOperation(manager);
		// Second connection starts in the same tick as the first one's
		// disconnect(); the deferred release must not detach under it.
		const second = manager.executeWithConnection(async () => "ok");
		await second;
		await new Promise((resolve) => setTimeout(resolve, 20));

		// Both connections' late rejections were observed by the guard; the
		// test-level listener plus the guard's own accounting confirm no
		// rejection escaped to Node's default (crashing) handler.
		expect(lateRejectionSpy).toHaveBeenCalled();
	});
});
