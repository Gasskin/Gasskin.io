import { getCodexSkillStatus, installCodexSkill } from '../lib/platform'
import pixaiCodexScript from '../../scripts/pixai-codex.mjs?raw'
import pixaiOpenAiYaml from './pixai-image-workbench.openai.yaml?raw'
import pixaiSkillMd from './pixai-image-workbench.skill.md?raw'
import type { CodexSkillInstallRequest, CodexSkillStatus } from '../shared/types'

export const PIXAI_CODEX_SKILL_NAME = 'pixai-image-workbench'

export async function getPixaiCodexSkillStatus(): Promise<CodexSkillStatus> {
  return getCodexSkillStatus(PIXAI_CODEX_SKILL_NAME)
}

export async function installPixaiCodexSkill(): Promise<CodexSkillStatus> {
  return installCodexSkill(buildPixaiCodexSkill())
}

export function buildPixaiCodexSkill(): CodexSkillInstallRequest {
  return {
    name: PIXAI_CODEX_SKILL_NAME,
    files: [
      {
        relativePath: 'SKILL.md',
        content: `${pixaiSkillMd.trim()}\n`
      },
      {
        relativePath: 'scripts/pixai-codex.mjs',
        content: `${pixaiCodexScript.trim()}\n`
      },
      {
        relativePath: 'agents/openai.yaml',
        content: `${pixaiOpenAiYaml.trim()}\n`
      }
    ]
  }
}
