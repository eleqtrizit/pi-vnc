import { describe, expect, it } from "vitest";
import { parsePort, parseVncConfigArgs, parseVncTarget } from "../src/vnc/config.js";

describe("parsePort", () => {
	it("accepts valid ports", () => {
		expect(parsePort("5900")).toEqual({ ok: true, port: 5900 });
		expect(parsePort("1")).toEqual({ ok: true, port: 1 });
		expect(parsePort("65535")).toEqual({ ok: true, port: 65535 });
	});

	it("rejects non-numeric and out-of-range ports", () => {
		expect(parsePort("5900abc").ok).toBe(false);
		expect(parsePort("abc").ok).toBe(false);
		expect(parsePort("0").ok).toBe(false);
		expect(parsePort("65536").ok).toBe(false);
		expect(parsePort("-1").ok).toBe(false);
		expect(parsePort("59.00").ok).toBe(false);
	});
});

describe("parseVncTarget", () => {
	it("parses plain hostnames and IPv4", () => {
		expect(parseVncTarget("myhost")).toEqual({ ok: true, host: "myhost" });
		expect(parseVncTarget("192.168.1.10")).toEqual({ ok: true, host: "192.168.1.10" });
	});

	it("parses host:port", () => {
		expect(parseVncTarget("192.168.1.10:5900")).toEqual({ ok: true, host: "192.168.1.10", port: 5900 });
	});

	it("parses bracketed IPv6 with and without port", () => {
		expect(parseVncTarget("[::1]:5900")).toEqual({ ok: true, host: "::1", port: 5900 });
		expect(parseVncTarget("[fe80::1]")).toEqual({ ok: true, host: "fe80::1" });
	});

	it("rejects unbracketed multi-colon hosts", () => {
		expect(parseVncTarget("::1").ok).toBe(false);
	});

	it("rejects invalid port in target", () => {
		expect(parseVncTarget("host:5900abc").ok).toBe(false);
	});

	it("rejects empty host", () => {
		expect(parseVncTarget(":5900").ok).toBe(false);
	});
});

describe("parseVncConfigArgs", () => {
	it("handles empty args (show config)", () => {
		expect(parseVncConfigArgs("")).toEqual({ ok: true });
		expect(parseVncConfigArgs("   ")).toEqual({ ok: true });
	});

	it("parses target only, leaving password unchanged", () => {
		expect(parseVncConfigArgs("myhost:5900")).toEqual({ ok: true, host: "myhost", port: 5900, password: undefined });
	});

	it("preserves spaces in passwords", () => {
		const result = parseVncConfigArgs("myhost my secret pass");
		expect(result).toEqual({ ok: true, host: "myhost", password: "my secret pass" });
	});

	it("clears password with '-'", () => {
		expect(parseVncConfigArgs("myhost -")).toEqual({ ok: true, host: "myhost", password: null });
	});

	it("parses password after an IPv6 target", () => {
		expect(parseVncConfigArgs("[::1]:5900 pw")).toEqual({ ok: true, host: "::1", port: 5900, password: "pw" });
	});

	it("propagates target errors", () => {
		expect(parseVncConfigArgs("::1").ok).toBe(false);
	});
});
