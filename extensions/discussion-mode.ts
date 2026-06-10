/**
 * Discussion Mode Extension
 *
 * Read-only research mode that encourages the agent to explore the codebase
 * and ask the user clarifying questions before making any changes.
 *
 * Features:
 * - /discuss [topic] command to enter discussion mode
 * - /discuss-off command to leave discussion mode
 * - Tools restricted to read-only + ask_user_question
 * - Bash restricted to safe read-only commands
 * - Custom ask_user_question tool for structured Q&A
 * - System prompt injected per-turn to bias toward exploration
 * - State persists across sessions and forks
 * - pi.events for extension-to-extension RPC
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { WRITEABLE_EXTENSIONS, isSafeCommand, isWriteablePath } from "./guardrail";

// ── Constants ──

const STATUS_KEY = "discussion-mode";
const STATE_ENTRY_TYPE = "discussion-mode-state";
const ASK_TOOL_NAME = "ask_user_question";

const DISCUSSION_TOOLS = ["read", "bash", "grep", "find", "ls", "edit", "write", ASK_TOOL_NAME];
const NORMAL_TOOLS = ["read", "bash", "edit", "write"];

// ── Types ──

interface DiscussionState {
	enabled: boolean;
}

interface QuestionOption {
	label: string;
	description: string;
}

interface Question {
	id: string;
	header: string;
	question: string;
	options: QuestionOption[];
}

// ── System Prompt ──

const DISCUSSION_SYSTEM_PROMPT = `You are in discussion mode — a research mode for deep codebase exploration and collaborative discussion.

Core workflow:
- Your primary goal is to understand the problem and align with the user.
- Write your analysis, plans, and decisions as Markdown documents first.
- Only after the user confirms understanding should you consider implementation.

What you can write:
- Markdown files (.md, .mdx): plans, ADRs, PRDs, research notes, meeting summaries.
- Text files (.txt): logs, data extracts, notes.
- HTML files (.html): demos, mockups, visual explanations.
- Do NOT write or modify implementation code (.ts, .js, .rs, .py, .go, etc.).

When blocked:
- If a tool or command is blocked, pause immediately.
- Explain to the user what you were trying to do and why.
- Ask how they'd like to proceed. Do NOT try workarounds.

Available tools: read, bash (safe commands only), grep, find, ls, edit, write, ask_user_question

To exit discussion mode, tell the user to run /discuss-off.`;

// ── Extension ──

export default function discussionMode(pi: ExtensionAPI): void {
	// ── Module-level state ──
	const state: DiscussionState = { enabled: false };
	let previousTools: string[] | undefined;

	// Context bridged from session_start for use in pi.events callbacks
	let savedCtx: ExtensionContext | undefined;

	// ── Helpers ──

	function updateStatus(ctx: ExtensionContext): void {
		if (state.enabled) {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", "💬 discussing"));
		} else {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	}

	function persistState(): void {
		pi.appendEntry(STATE_ENTRY_TYPE, { enabled: state.enabled });
	}

	function broadcastState(): void {
		pi.events.emit("discuss:state-changed", { enabled: state.enabled });
	}

	function enterMode(ctx: ExtensionContext): void {
		if (state.enabled) {
			ctx.ui.notify("Already in discussion mode.", "info");
			return;
		}

		// Save current tools before switching
		previousTools = pi.getActiveTools();
		state.enabled = true;

		// Activate discussion tools (includes ask_user_question)
		pi.setActiveTools(DISCUSSION_TOOLS);

		persistState();
		updateStatus(ctx);
		broadcastState();

		ctx.ui.notify(`Discussion mode enabled. Tools: ${DISCUSSION_TOOLS.join(", ")}`, "info");
	}

	function exitMode(ctx: ExtensionContext): void {
		if (!state.enabled) {
			ctx.ui.notify("Not in discussion mode.", "info");
			return;
		}

		state.enabled = false;

		// Restore previous tools
		if (previousTools && previousTools.length > 0) {
			pi.setActiveTools(previousTools);
		} else {
			pi.setActiveTools(NORMAL_TOOLS);
		}
		previousTools = undefined;

		persistState();
		updateStatus(ctx);
		broadcastState();

		ctx.ui.notify("Discussion mode disabled. Full tool access restored.", "info");
	}

	// ── Tool Registration ──

	pi.registerTool({
		name: ASK_TOOL_NAME,
		label: "Ask User Question",
		description:
			"Ask the user 1-3 structured clarifying questions with 2-4 options each. Use this when you encounter ambiguity or need to understand user preferences during discussion mode.",
		parameters: Type.Object({
			questions: Type.Array(
				Type.Object({
					id: Type.String({ description: "Unique snake_case identifier for this question" }),
					header: Type.String({ description: "Short label for the question, ≤12 characters" }),
					question: Type.String({ description: "One-sentence prompt for the user" }),
					options: Type.Array(
						Type.Object({
							label: Type.String({ description: "Short option label shown to the user" }),
							description: Type.String({ description: "Longer description of what this option means" }),
						}),
						{ minItems: 2, maxItems: 4, description: "2-4 selectable options" },
					),
				}),
				{ minItems: 1, maxItems: 3, description: "1-3 questions to ask the user" },
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const answers: Record<string, string> = {};

			for (const q of params.questions) {
				const choices = [
					...q.options.map((opt: QuestionOption) => `${opt.label}: ${opt.description}`),
					"Other (free-form response)",
				];

				const choice = await ctx.ui.select(`${q.header}: ${q.question}`, choices);

				if (!choice) {
					answers[q.id] = "(no answer)";
					continue;
				}

				if (choice.startsWith("Other")) {
					const freeForm = await ctx.ui.editor(`Your answer for: ${q.question}`, "");
					answers[q.id] = freeForm?.trim() || "(no answer)";
				} else {
					// Extract label from "label: description" format
					const label = choice.split(":")[0].trim();
					answers[q.id] = label;
				}
			}

			const summary = Object.entries(answers)
				.map(([id, answer]) => `- **${id}**: ${answer}`)
				.join("\n");

			return {
				content: [{ type: "text", text: `User answered:\n\n${summary}` }],
				details: { answers },
			};
		},
	});

	// ── Command Registration ──

	pi.registerCommand("discuss", {
		description: "Enter discussion mode for read-only research. Optionally provide a topic.",
		handler: async (args, ctx) => {
			const topic = args.trim();

			// Already in mode: just forward topic text
			if (state.enabled) {
				if (topic) {
					pi.sendUserMessage(topic);
				} else {
					ctx.ui.notify("Already in discussion mode. Use /discuss-off to exit.", "info");
				}
				return;
			}

			enterMode(ctx);

			// If a topic was provided, send it as a user message
			if (topic) {
				pi.sendUserMessage(topic);
			}
		},
	});

	pi.registerCommand("discuss-off", {
		description: "Exit discussion mode and restore full tool access.",
		handler: async (_args, ctx) => {
			exitMode(ctx);
		},
	});

	// ── Event-based RPC (extension-to-extension) ──

	pi.events.on("cmd:discuss:enter", () => {
		if (!savedCtx) return;
		enterMode(savedCtx);
	});

	pi.events.on("cmd:discuss:exit", () => {
		if (!savedCtx || !state.enabled) return;
		exitMode(savedCtx);
	});

	// ── Lifecycle Events ──

	pi.on("session_start", async (_event, ctx) => {
		// Bridge context for use in pi.events callbacks
		savedCtx = ctx;

		// Restore persisted state
		const entries = ctx.sessionManager.getEntries();
		const discussEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === STATE_ENTRY_TYPE)
			.pop() as { data?: DiscussionState } | undefined;

		if (discussEntry?.data?.enabled) {
			state.enabled = true;
			previousTools = pi.getActiveTools();
			pi.setActiveTools(DISCUSSION_TOOLS);
			ctx.ui.notify("Discussion mode restored from previous session.", "info");
		}

		updateStatus(ctx);

		// Broadcast initial state so other extensions (e.g. Web UI) can sync
		if (state.enabled) {
			broadcastState();
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		// Clear status UI
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});

	pi.on("before_agent_start", async () => {
		if (!state.enabled) return;

		return {
			systemPrompt: DISCUSSION_SYSTEM_PROMPT,
		};
	});

	pi.on("tool_call", async (event) => {
		if (!state.enabled) return;

		// Block edits to non-documentation files
		if (event.toolName === "edit" || event.toolName === "write") {
			const path = event.input?.path as string | undefined;
			if (path && !isWriteablePath(path)) {
				return {
					block: true,
					reason: `Discussion mode: you can only edit documentation files (${WRITEABLE_EXTENSIONS.join(", ")}). "${path}" looks like implementation code. Write your analysis as a Markdown document instead, or ask the user if they want to exit discussion mode.`,
				};
			}
		}

		// Block unsafe bash commands
		if (event.toolName === "bash") {
			const command = event.input.command as string;
			if (!isSafeCommand(command)) {
				return {
					block: true,
					reason: `Discussion mode: this command is blocked because it may modify files or system state. The user wants to discuss, not run destructive commands.\nExplain what you were trying to do and ask how to proceed.\n\nCommand: ${command}`,
				};
			}
		}
	});

	// Improve error messages for disabled tools
	pi.on("tool_result", async (event) => {
		if (!state.enabled) return;
		if (!event.isError) return;

		// Tools that existed before discussion mode but are now disabled
		const disabledTools = (previousTools ?? []).filter((t) => !DISCUSSION_TOOLS.includes(t));
		if (disabledTools.includes(event.toolName)) {
			return {
				content: [
					{
						type: "text",
						text: `Discussion mode: the "${event.toolName}" tool is not available. You are in discussion mode — focus on research and alignment with the user. Write your analysis as a Markdown document, or ask the user for direction.`,
					},
				],
				isError: true,
			};
		}
	});
}
