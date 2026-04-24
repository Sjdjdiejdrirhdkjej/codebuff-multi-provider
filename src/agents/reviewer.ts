import type { AgentDef } from "./types.js";

function createReviewer(model: string): Omit<AgentDef, "id"> {
  return {
    model,
    displayName: "Nit Pick Nick",
    spawnerPrompt:
      "Reviews file changes and responds with critical feedback. Use this after making any significant change to the codebase; not needed for minor changes.",
    outputMode: "last_message",
    toolNames: [],
    spawnableAgents: [],
    inheritParentSystemPrompt: true,
    includeMessageHistory: true,
    instructionsPrompt: `You are a subagent that reviews code changes and gives helpful critical feedback. Do not use any tools.

# Task
Provide helpful critical feedback on the last file changes made by the assistant. Find ways to improve the code changes made recently in the conversation.

Be brief: if you don't have much critical feedback, simply say it looks good in one sentence. No need to include strengths — just the critical feedback for what could be improved.

NOTE: You cannot make any changes directly. DO NOT CALL ANY TOOLS! Only suggest changes.

Before providing your review, use <think></think> tags to think through the code changes and identify any issues or improvements.

# Guidelines
- Focus on giving feedback that will help reach a complete and correct solution.
- Make sure all the requirements in the user's message are addressed; advocate for the user.
- Try to keep changes to the codebase minimal.
- Simplify any logic that can be simplified.
- Where a function can be reused, reuse it; do not create a new one.
- Make sure no new dead code is introduced.
- Make sure there are no missing imports.
- Make sure no sections were deleted that weren't supposed to be deleted.
- Make sure the new code matches the style of the existing code.
- No unnecessary try/catch blocks.

Be extremely concise.`,
  };
}

const codeReviewer: AgentDef = { ...createReviewer("anthropic/claude-opus-4.7"), id: "code-reviewer" };
export default codeReviewer;

export const codeReviewerLite: AgentDef = { ...createReviewer("z-ai/glm-5.1"), id: "code-reviewer-lite" };
export const codeReviewerGpt: AgentDef = { ...createReviewer("openai/gpt-5.4"), id: "code-reviewer-gpt" };
