import { describe, expect, it } from "vitest";
import { classifyRejection } from "../src/vnc/vnc-client.js";

describe("classifyRejection", () => {
	it("recognizes nodejs-rfb missing-password errors and gives actionable guidance", () => {
		const error = new Error("No password supplied for VNC authentication.");
		error.stack = "Error: No password supplied for VNC authentication.\n    at authenticate (file:///x/node_modules/@computernewb/nodejs-rfb/dist/index.js:862:35)";

		const result = classifyRejection(error);

		expect(result.isVnc).toBe(true);
		expect(result.message).toContain("no password is configured");
		expect(result.message).toContain("/vnc-config");
	});

	it("recognizes other nodejs-rfb-originated rejections", () => {
		const error = new Error("Security type was null somehow");
		error.stack = "Error: Security type was null somehow\n    at _handleAuthChallenge (file:///x/node_modules/@computernewb/nodejs-rfb/dist/index.js:1401:35)";

		const result = classifyRejection(error);

		expect(result.isVnc).toBe(true);
		expect(result.message).toBe("VNC connection error: Security type was null somehow");
	});

	it("does not claim unrelated rejections", () => {
		const error = new Error("something else broke");
		error.stack = "Error: something else broke\n    at fn (/app/src/other.js:1:1)";

		const result = classifyRejection(error);

		expect(result.isVnc).toBe(false);
		expect(result.message).toBe("something else broke");
	});

	it("handles non-Error reasons from nodejs-rfb control flow", () => {
		const result = classifyRejection("plain string failure");

		expect(result.isVnc).toBe(false);
		expect(result.message).toBe("plain string failure");
	});
});
