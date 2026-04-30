/**
 * Skill loader — discovers `.factory/skills/*.md` and applies trigger matching.
 *
 * Skills are markdown files with optional YAML frontmatter:
 *
 *   ---
 *   triggers: ["payment", "auth", "OWASP"]
 *   agent:
 *     name: security-auditor
 *     outputs: ["vulnerabilities.md"]
 *   ---
 *   # Body (free-form domain knowledge)
 *
 * Skills with no triggers are *always* candidates for explicit inclusion in
 * a station's `bot.skills:` list. Skills with triggers are auto-matched
 * against the input text and surfaced for inclusion.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { SkillFile } from "../core/types.js";
import { factoryPaths } from "../utils/paths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function bundledSkillDir(): string {
  const candidates = [
    path.join(__dirname, "..", "templates", "skills"),
    path.join(__dirname, "..", "..", "src", "templates", "skills"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

export function listSkills(projectRoot: string): SkillFile[] {
  const out: SkillFile[] = [];
  const userDir = factoryPaths(projectRoot).skillsDir;
  const bundled = bundledSkillDir();

  for (const dir of [userDir, bundled]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const full = path.join(dir, f);
      const skill = parseSkillFile(full);
      if (out.some((s) => s.name === skill.name)) continue; // user shadows bundled
      out.push(skill);
    }
  }
  return out;
}

export function parseSkillFile(filePath: string): SkillFile {
  const raw = readFileSync(filePath, "utf-8");
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  let frontmatter: Record<string, unknown> = {};
  let body = raw;
  if (fmMatch) {
    try {
      frontmatter = (parseYaml(fmMatch[1]) as Record<string, unknown>) ?? {};
      body = fmMatch[2];
    } catch {
      /* Bad frontmatter — treat whole file as body */
    }
  }
  const triggers = Array.isArray(frontmatter.triggers)
    ? (frontmatter.triggers as unknown[]).filter((t): t is string => typeof t === "string")
    : undefined;
  const agentRaw = frontmatter.agent as
    | { name?: string; triggers?: string[]; inputs?: string[]; outputs?: string[] }
    | undefined;
  const agent = agentRaw?.name
    ? {
        name: agentRaw.name,
        triggers: Array.isArray(agentRaw.triggers) ? agentRaw.triggers : undefined,
        inputs: Array.isArray(agentRaw.inputs) ? agentRaw.inputs : undefined,
        outputs: Array.isArray(agentRaw.outputs) ? agentRaw.outputs : undefined,
      }
    : undefined;

  return {
    name: path.basename(filePath, path.extname(filePath)),
    path: filePath,
    content: body.trim(),
    triggers,
    agent,
  };
}

/**
 * Match skills against an input text (case-insensitive substring match).
 * Returns the names of skills whose triggers fire.
 */
export function autoMatchSkills(skills: SkillFile[], text: string): SkillFile[] {
  const lower = text.toLowerCase();
  return skills.filter((s) => {
    if (!s.triggers || s.triggers.length === 0) return false;
    return s.triggers.some((t) => lower.includes(t.toLowerCase()));
  });
}

export function resolveSkillPaths(
  projectRoot: string,
  skillRefs: string[] | undefined
): string[] {
  if (!skillRefs) return [];
  const all = listSkills(projectRoot);
  const out: string[] = [];
  for (const ref of skillRefs) {
    // Direct path?
    const asPath = path.isAbsolute(ref) ? ref : path.join(projectRoot, ref);
    if (existsSync(asPath)) {
      out.push(asPath);
      continue;
    }
    // Skill name lookup?
    const found = all.find((s) => s.name === ref);
    if (found) {
      out.push(found.path);
      continue;
    }
    // Silently skip — this is intentional: skills are best-effort context.
  }
  return out;
}
