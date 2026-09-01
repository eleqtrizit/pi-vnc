/**
 * pi-vnc — remote desktop control for Pi via VNC.
 *
 * Registers six native tools:
 *   vnc_click, vnc_move_mouse, vnc_key_press, vnc_type_text,
 *   vnc_type_multiline, vnc_screenshot
 *
 * Connection config:
 *   - Defaults from VNC_HOST / VNC_PORT / VNC_PASSWORD env vars
 *   - Show or change at runtime with /vnc-config <host>[:<port>] [password]
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	clickTool,
	keyTool,
	moveTool,
	screenshotTool,
	typeMultilineTool,
	typeTextTool,
} from "../src/vnc/tools.js";
import { parseVncConfigArgs } from "../src/vnc/config.js";
import { vncConfig } from "../src/vnc/vnc-client.js";

export default function (pi: ExtensionAPI): void {
	pi.registerTool(clickTool);
	pi.registerTool(moveTool);
	pi.registerTool(keyTool);
	pi.registerTool(typeTextTool);
	pi.registerTool(typeMultilineTool);
	pi.registerTool(screenshotTool);

	pi.registerCommand("vnc-config", {
		description:
			'Show or set the VNC connection. Usage: /vnc-config <host[:port]> [password] (password may contain spaces; pass "-" to clear it)',
		handler: async (args, ctx) => {
			const parsed = parseVncConfigArgs(args);
			if (!parsed.ok) {
				ctx.ui.notify(parsed.error, "error");
				ctx.ui.notify('Usage: /vnc-config <host[:port]> [password] (e.g. "/vnc-config [::1]:5900 my secret")', "error");
				return;
			}

			if (parsed.host === undefined) {
				ctx.ui.notify(
					`VNC: ${vncConfig.host}:${vncConfig.port} (password: ${vncConfig.password ? "set" : "not set"})`,
					"info",
				);
				return;
			}

			vncConfig.host = parsed.host;
			if (parsed.port !== undefined) vncConfig.port = parsed.port;
			if (parsed.password === null) vncConfig.password = undefined;
			else if (parsed.password !== undefined) vncConfig.password = parsed.password;

			ctx.ui.notify(
				`VNC set to ${vncConfig.host}:${vncConfig.port} (password: ${vncConfig.password ? "set" : "not set"})`,
				"info",
			);
		},
	});
}
