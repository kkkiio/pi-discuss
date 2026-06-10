/**
 * E2E tests for arch-mode extension using pi RPC mode.
 *
 * Two test suites:
 *   commands     — fast state-transition tests (no LLM needed)
 *   conversation — full enter → explore → exit flow (needs DEEPSEEK_API_KEY)
 *
 * Usage:
 *   just test              # runs both suites (conversation skips without API key)
 *   DEEPSEEK_API_KEY=... just test
 */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

// Load .env
function loadEnv(): void {
	try {
		const content = readFileSync(join(process.cwd(), ".env"), "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq === -1) continue;
			const key = trimmed.slice(0, eq).trim();
			if (!process.env[key]) process.env[key] = trimmed.slice(eq + 1).trim();
		}
	} catch {
		/* .env not found */
	}
}
loadEnv();

// ── Helpers ──

interface RpcClient {
	proc: ChildProcess;
	buffer: string;
	notifications: Array<{ message: string }>;
	events: unknown[];
	pending: Map<string, (data: unknown) => void>;
	done: boolean;
}

function spawnPi(cwd: string, extensionPath: string, extraArgs: string[] = []): RpcClient {
	const proc = spawn("pi", ["--mode", "rpc", "--no-session", "--offline", "-e", extensionPath, ...extraArgs], {
		cwd,
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env },
	});

	const client: RpcClient = {
		proc,
		buffer: "",
		notifications: [],
		events: [],
		pending: new Map(),
		done: false,
	};

	proc.stdout?.on("data", (chunk: Buffer) => {
		client.buffer += chunk.toString();
		const lines = client.buffer.split("\n");
		client.buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const msg = JSON.parse(line);
				client.events.push(msg);

				if (msg.type === "extension_ui_request" && msg.method === "notify") {
					client.notifications.push({ message: msg.message ?? "" });
				}
				if (msg.type === "response" && msg.id && client.pending.has(msg.id)) {
					client.pending.get(msg.id)?.(msg);
					client.pending.delete(msg.id);
				}
				if (msg.type === "agent_end") {
					client.done = true;
				}
			} catch {
				/* ignore parse errors */
			}
		}
	});

	proc.stderr?.on("data", () => {});
	proc.on("error", (err) => console.error("pi error:", err));

	return client;
}

function send(client: RpcClient, cmd: Record<string, unknown>): Promise<unknown> {
	const id = `t-${client.pending.size}`;
	const line = `${JSON.stringify({ id, ...cmd })}\n`;
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => {
			client.pending.delete(id);
			reject(new Error(`timeout: ${JSON.stringify(cmd)}`));
		}, 30000);
		client.pending.set(id, (d) => {
			clearTimeout(t);
			(resolve as (d: unknown) => void)(d);
		});
		client.proc.stdin?.write(line);
	});
}

async function prompt(client: RpcClient, message: string) {
	return send(client, { type: "prompt", message });
}

async function notifyMatch(client: RpcClient, pred: (m: string) => boolean, timeoutMs = 5000): Promise<string | null> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const i = client.notifications.findIndex((n) => pred(n.message));
		if (i !== -1) {
			const m = client.notifications[i].message;
			client.notifications.splice(i, 1);
			return m;
		}
		await sleep(50);
	}
	return null;
}

async function waitForAgentEnd(client: RpcClient, timeoutMs = 30000): Promise<unknown[]> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (client.done) return client.events;
		await sleep(200);
	}
	throw new Error("agent_end not received within timeout");
}

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

async function kill(client: RpcClient) {
	client.proc.kill();
	await sleep(200);
}

function extractAssistantText(events: unknown[]): string {
	const parts: string[] = [];
	for (const ev of events) {
		const e = ev as any;
		if (e.type === "message_update" || e.type === "message_end") {
			const msg = e.message;
			if (msg?.role === "assistant" && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "text" && block.text) parts.push(block.text);
				}
			}
		}
	}
	return parts.join("");
}

// ── Temp dirs (project-local) ──

const TMP_DIR = join(process.cwd(), "tmp");

function tmpDir(name: string): string {
	const dir = join(TMP_DIR, name);
	mkdirSync(dir, { recursive: true });
	return dir;
}

// ── Commands suite (no LLM, fast) ──

describe("commands", () => {
	let cwd: string;
	let extPath: string;

	before(() => {
		cwd = tmpDir("pi-commands");
		extPath = join(process.cwd(), "extensions", "arch-mode.ts");
	});

	after(() => rmSync(TMP_DIR, { recursive: true, force: true }));

	it("enters via /arch", async () => {
		const c = spawnPi(cwd, extPath);
		try {
			await prompt(c, "/arch");
			const m = await notifyMatch(c, (s) => s.includes("Architecture mode enabled"));
			assert.ok(m);
		} finally {
			await kill(c);
		}
	});

	it("exits via /arch-off", async () => {
		const c = spawnPi(cwd, extPath);
		try {
			await prompt(c, "/arch");
			await notifyMatch(c, (s) => s.includes("enabled"));
			await prompt(c, "/arch-off");
			const m = await notifyMatch(c, (s) => s.includes("disabled"));
			assert.ok(m);
		} finally {
			await kill(c);
		}
	});

	it("rejects re-enter when already in mode", async () => {
		const c = spawnPi(cwd, extPath);
		try {
			await prompt(c, "/arch");
			await notifyMatch(c, (s) => s.includes("enabled"));
			await prompt(c, "/arch");
			const m = await notifyMatch(c, (s) => s.includes("Already"));
			assert.ok(m);
		} finally {
			await kill(c);
		}
	});
});

// ── Conversation suite (needs LLM) ──

const hasApiKey = Boolean(process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY);

const LLM_ARGS = hasApiKey ? ["--provider", "deepseek", "--model", "deepseek-v4-flash"] : [];

describe("conversation", { skip: !hasApiKey ? "No API key set" : false }, () => {
	const extPath = join(process.cwd(), "extensions", "arch-mode.ts");

	it("enter → explore → exit (full flow)", { timeout: 60000 }, async () => {
		const c = spawnPi(process.cwd(), extPath, LLM_ARGS);

		try {
			// 1. Enter architecture mode
			await prompt(c, "/arch");
			const enterNotify = await notifyMatch(c, (s) => s.includes("enabled"));
			assert.ok(enterNotify, "should notify mode enabled");

			// 2. Ask agent to analyze a real project file
			await prompt(c, "Read the justfile and the README.md, then tell me what this project does. Be brief.");
			await waitForAgentEnd(c);

			const response = extractAssistantText(c.events);
			assert.ok(
				response.toLowerCase().includes("architecture"),
				`Expected response to mention 'architecture', got: ${response.slice(0, 300)}`,
			);

			// 3. Exit
			await prompt(c, "/arch-off");
			const exitNotify = await notifyMatch(c, (s) => s.includes("disabled"));
			assert.ok(exitNotify, "should notify mode disabled");
		} finally {
			await kill(c);
		}
	});
});
