import { logger } from "./logger.js";

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
}

const BUILTIN_SKILLS: SkillDefinition[] = [
  { id: "read-file", name: "Read File", description: "Read a file from disk" },
  { id: "write-file", name: "Write File", description: "Write a file to disk" },
  { id: "edit-file", name: "Edit File", description: "Apply a textual edit" },
  { id: "run-shell", name: "Run Shell", description: "Run a shell command" },
  { id: "search-code", name: "Search Code", description: "Search the codebase" },
];

let skills: Map<string, SkillDefinition> = new Map();

export function initializeSkillRegistry(): void {
  skills = new Map();
  for (const s of BUILTIN_SKILLS) skills.set(s.id, s);
  logger.info({ count: skills.size }, "Initialized skill registry");
}

export function listSkills(): SkillDefinition[] {
  return Array.from(skills.values());
}

export function getSkill(id: string): SkillDefinition | undefined {
  return skills.get(id);
}
