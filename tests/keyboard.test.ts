import { describe, expect, it } from "vitest";
import { charNeedsShift, getKeysym, getUnshiftedChar, parseKeyInput } from "../src/vnc/keyboard.js";

describe("parseKeyInput", () => {
	it("returns a bare key unchanged", () => {
		expect(parseKeyInput("Enter")).toEqual({ modifiers: [], key: "Enter" });
	});

	it("splits modifier combinations", () => {
		expect(parseKeyInput("Ctrl+c")).toEqual({ modifiers: ["Ctrl"], key: "c" });
		expect(parseKeyInput("Ctrl+Alt+Delete")).toEqual({ modifiers: ["Ctrl", "Alt"], key: "Delete" });
	});
});

describe("getKeysym", () => {
	it("maps known special keys", () => {
		expect(getKeysym("Return")).toBe(0xff0d);
		expect(getKeysym("Shift")).toBe(0xffe1);
		expect(getKeysym("F12")).toBe(0xffc9);
	});

	it("maps newly added keys", () => {
		expect(getKeysym("CapsLock")).toBe(0xffe5);
		expect(getKeysym("NumLock")).toBe(0xff7f);
		expect(getKeysym("PrintScreen")).toBe(0xff61);
		expect(getKeysym("Pause")).toBe(0xff13);
		expect(getKeysym("KP_Enter")).toBe(0xff8d);
		expect(getKeysym("KP_5")).toBe(0xffb5);
	});

	it("falls back to charCodeAt for single characters", () => {
		expect(getKeysym("a")).toBe(0x61);
		expect(getKeysym("$")).toBe(0x24);
	});

	it("throws for unknown multi-character key names", () => {
		expect(() => getKeysym("NonexistentKey")).toThrow(/Unknown key/);
	});
});

describe("charNeedsShift / getUnshiftedChar", () => {
	it("flags shift-required characters", () => {
		expect(charNeedsShift("!")).toBe(true);
		expect(charNeedsShift("a")).toBe(false);
	});

	it("maps shifted to base characters", () => {
		expect(getUnshiftedChar("!")).toBe("1");
		expect(getUnshiftedChar("?")).toBe("/");
		expect(getUnshiftedChar("a")).toBe("a");
	});
});
