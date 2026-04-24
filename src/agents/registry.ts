import base2 from "./base2.js";
import {
  base2Fast,
  base2FastNoValidation,
  base2Free,
  base2Lite,
  base2Max,
  base2Plan,
  baseDeep,
} from "./base2-variants.js";
import editor, { editorGpt5, editorLite } from "./editor.js";
import filePicker, {
  codeSearcher,
  directoryLister,
  fileLister,
  fileListerMax,
  filePickerMax,
  globMatcher,
} from "./file-explorer.js";
import { researcherDocs, researcherWeb } from "./researcher.js";
import codeReviewer, { codeReviewerGpt, codeReviewerLite } from "./reviewer.js";
import thinker, {
  thinkerGemini,
  thinkerGpt,
  thinkerWithFilesGemini,
} from "./thinker.js";
import { gpt5Agent, opusAgent } from "./general-agent.js";
import basher from "./basher.js";
import browserUse from "./browser-use.js";
import contextPruner from "./context-pruner.js";
import librarian from "./librarian.js";
import tmuxCli from "./tmux-cli.js";
import type { AgentDef } from "./types.js";

const all: AgentDef[] = [
  base2,
  base2Max,
  base2Lite,
  base2Free,
  base2Fast,
  base2FastNoValidation,
  base2Plan,
  baseDeep,
  editor,
  editorLite,
  editorGpt5,
  filePicker,
  filePickerMax,
  fileLister,
  fileListerMax,
  codeSearcher,
  directoryLister,
  globMatcher,
  researcherWeb,
  researcherDocs,
  codeReviewer,
  codeReviewerLite,
  codeReviewerGpt,
  thinker,
  thinkerGpt,
  thinkerGemini,
  thinkerWithFilesGemini,
  opusAgent,
  gpt5Agent,
  basher,
  browserUse,
  contextPruner,
  librarian,
  tmuxCli,
];

export const AGENTS: Record<string, AgentDef> = Object.fromEntries(
  all.map((a) => [a.id, a]),
);

export function getAgent(id: string): AgentDef | undefined {
  return AGENTS[id];
}

export function listAgentIds(): string[] {
  return all.map((a) => a.id);
}

export function describeAgents(ids: string[]): string {
  return ids
    .map((id) => {
      const a = AGENTS[id];
      return a ? `- ${a.id} (${a.displayName}): ${a.spawnerPrompt}` : `- ${id}: (unknown)`;
    })
    .join("\n");
}
