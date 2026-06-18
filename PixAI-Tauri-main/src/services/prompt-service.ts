import { getAdapter } from '../adapters/registry'
import type { PromptAssistInput } from '../shared/types'
import type { ProviderSettingsStore } from './provider-settings'

export class PromptService {
  constructor(private readonly providers: ProviderSettingsStore) {}

  async inspire(input: PromptAssistInput = {}): Promise<string> {
    const runtimeProfile = await this.getPromptProfile()
    return getAdapter(runtimeProfile.type).inspirePrompt(runtimeProfile, input)
  }

  async enrich(input: PromptAssistInput & { prompt: string }): Promise<string> {
    const runtimeProfile = await this.getPromptProfile()
    return getAdapter(runtimeProfile.type).enrichPrompt(runtimeProfile, input)
  }

  private async getPromptProfile() {
    const settings = await this.providers.get()
    return this.providers.getRuntimeProfile(settings.selectedPromptProfileId)
  }
}
