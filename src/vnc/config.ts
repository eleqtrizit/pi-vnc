/**
 * Parsing for /vnc-config command input.
 *
 * Accepted forms:
 *   host                      -> host only (port/password unchanged)
 *   host:port                 -> IPv4 or hostname with port
 *   [::1]                     -> bare IPv6
 *   [::1]:5900                -> bracketed IPv6 with port
 *   host port password        -> password is everything after the first space
 *                                (spaces in the password are preserved)
 *   host -                    -> clears a previously set password
 *
 * :param input: Raw command argument string
 * :return: Parsed target, or an { error } describing the problem
 */

export type ParsedVncArgs = { ok: true; host?: string; port?: number; password?: string | null } | { ok: false; error: string };

/** Strict port parse: digits only, 1-65535. */
export function parsePort(raw: string): { ok: true; port: number } | { ok: false; error: string } {
	if (!/^\d+$/.test(raw)) {
		return { ok: false, error: `Invalid port: ${raw}` };
	}
	const port = Number(raw);
	if (port < 1 || port > 65535) {
		return { ok: false, error: `Port must be between 1 and 65535, got: ${raw}` };
	}
	return { ok: true, port };
}

/**
 * Parse a host[:port] target, bracket-aware for IPv6.
 *
 * :param input: The host/port token (whitespace already removed)
 * :return: Parsed host and optional port, or an { error }
 */
export function parseVncTarget(input: string): { ok: true; host: string; port?: number } | { ok: false; error: string } {
	// Bracketed IPv6: [::1] or [::1]:5900
	const bracketed = input.match(/^\[([^\]]+)\](?::(\d+))?$/);
	if (bracketed) {
		const [, host, portRaw] = bracketed;
		if (!host) return { ok: false, error: "Empty IPv6 host" };
		if (portRaw === undefined) return { ok: true, host };
		const port = parsePort(portRaw);
		return port.ok ? { ok: true, host, port: port.port } : port;
	}

	const segments = input.split(":");
	if (segments.length === 1) {
		return { ok: true, host: input };
	}
	// Single colon: IPv4 or hostname with port. Bare unbracketed IPv6
	// (multiple colons, no port) is rejected to keep :port unambiguous.
	if (segments.length === 2) {
		const [host, portRaw] = segments;
		if (!host) return { ok: false, error: "Empty host" };
		const port = parsePort(portRaw);
		return port.ok ? { ok: true, host, port: port.port } : port;
	}
	return { ok: false, error: `Ambiguous host: ${input} (use [host]:port form for IPv6)` };
}

/**
 * Parse full /vnc-config arguments: "<host[:port]> [-|password]".
 *
 * :param args: Raw command argument string
 * :return: Parsed fields; omitted fields leave the current config unchanged;
 *          password === null clears the stored password
 */
export function parseVncConfigArgs(args: string): ParsedVncArgs {
	const trimmed = args.trim();
	if (!trimmed) {
		return { ok: true };
	}

	const firstSpace = trimmed.indexOf(" ");
	const target = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
	const passwordRaw = firstSpace === -1 ? undefined : trimmed.slice(firstSpace + 1).trim();

	const targetResult = parseVncTarget(target);
	if (!targetResult.ok) return targetResult;

	let password: string | null | undefined;
	if (passwordRaw === undefined) {
		password = undefined;
	} else if (passwordRaw === "-") {
		password = null;
	} else {
		password = passwordRaw;
	}

	return {
		ok: true,
		host: targetResult.host,
		port: targetResult.port,
		password,
	};
}
