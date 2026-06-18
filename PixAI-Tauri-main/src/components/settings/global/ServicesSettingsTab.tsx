import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DEFAULT_MODEL } from '../../../shared/image-options'
import { confirmDestructiveAction } from '../../../lib/confirm'
import type { ProviderProfile } from '../../../shared/types'
import { useAppStore } from '../../../store/app-store'
import { GallerySelect } from '../../common/GallerySelect'
import { ProviderProfileDialog, createProviderProfileDraft } from '../providers/ProviderProfileDialog'

export function ServicesSettingsTab() {
  const {
    activeConversationId,
    conversations,
    settings,
    updateActiveConversation,
    updateSettings,
    upsertProfile,
    deleteProfile
  } = useAppStore()
  const conversation = conversations.find((item) => item.id === activeConversationId) || null
  const profiles = useMemo(() => settings?.profiles || [], [settings])
  const imageProfiles = useMemo(() => profiles.filter((profile) => profile.enabledUsages.includes('image')), [profiles])
  const promptProfiles = useMemo(() => profiles.filter((profile) => profile.enabledUsages.includes('prompt')), [profiles])
  const [selectedImageProfileId, setSelectedImageProfileId] = useState(settings?.selectedImageProfileId || '')
  const [selectedPromptProfileId, setSelectedPromptProfileId] = useState(settings?.selectedPromptProfileId || '')
  const [imageModel, setImageModel] = useState(DEFAULT_MODEL)
  const [profileDraft, setProfileDraft] = useState<ProviderProfile | null>(null)
  const [profileDraftMode, setProfileDraftMode] = useState<'create' | 'edit'>('create')
  const [profileApiKey, setProfileApiKey] = useState('')

  useEffect(() => {
    if (!settings) return
    const imageProfile = profiles.find((profile) => profile.id === settings.selectedImageProfileId) || imageProfiles[0]
    const promptProfile = profiles.find((profile) => profile.id === settings.selectedPromptProfileId) || promptProfiles[0]
    setSelectedImageProfileId(imageProfile?.id || '')
    setSelectedPromptProfileId(promptProfile?.id || '')
    setImageModel(imageProfile?.defaultImageModel || DEFAULT_MODEL)
  }, [imageProfiles, profiles, promptProfiles, settings])

  if (!settings || !conversation) return null

  const imageSelectedProfile = profiles.find((profile) => profile.id === selectedImageProfileId) || imageProfiles[0] || null
  const promptSelectedProfile = profiles.find((profile) => profile.id === selectedPromptProfileId) || promptProfiles[0] || null
  const hasImageProfiles = imageProfiles.length > 0
  const hasPromptProfiles = promptProfiles.length > 0

  const openNewProfileDialog = () => {
    setProfileApiKey('')
    setProfileDraftMode('create')
    setProfileDraft(createProviderProfileDraft())
  }

  const openEditProfileDialog = (profile: ProviderProfile) => {
    setProfileApiKey('')
    setProfileDraftMode('edit')
    setProfileDraft({ ...profile })
  }

  const closeProfileDialog = () => {
    setProfileDraft(null)
    setProfileApiKey('')
  }

  const saveProfileDraft = async () => {
    if (!profileDraft) return
    await upsertProfile({
      ...profileDraft,
      id: profileDraftMode === 'create' ? undefined : profileDraft.id,
      apiKey: profileApiKey.trim() || undefined
    })
    closeProfileDialog()
  }

  const deleteProfileDraft = async () => {
    if (!profileDraft || profileDraftMode !== 'edit') return
    if (!(await confirmDestructiveAction('删除此服务配置？'))) return
    await deleteProfile(profileDraft.id)
    closeProfileDialog()
  }

  const saveServiceDefaults = async () => {
    const imageProfile = imageSelectedProfile
    const promptProfile = promptSelectedProfile
    if (!imageProfile && !promptProfile) {
      openNewProfileDialog()
      return
    }
    await updateSettings({
      selectedImageProfileId: imageProfile?.id,
      selectedPromptProfileId: promptProfile?.id
    })
    await updateActiveConversation({ model: imageModel.trim() || DEFAULT_MODEL })
  }

  const setAsImageDefault = async (profile: ProviderProfile) => {
    setSelectedImageProfileId(profile.id)
    setImageModel(profile.defaultImageModel || DEFAULT_MODEL)
    await updateSettings({ selectedImageProfileId: profile.id })
    await updateActiveConversation({ model: profile.defaultImageModel || DEFAULT_MODEL })
  }

  const setAsPromptDefault = async (profile: ProviderProfile) => {
    setSelectedPromptProfileId(profile.id)
    await updateSettings({ selectedPromptProfileId: profile.id })
  }

  return (
    <>
      <Card className="settings-status-card settings-status-card-highlight rounded-2xl shadow-none">
        <CardHeader className="section-title flex items-center justify-between space-y-0">
          <CardTitle className="text-base">默认服务摘要</CardTitle>
          <Button type="button" size="sm" onClick={openNewProfileDialog}>
            <Plus />
            新增 Provider
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          {!profiles.length ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-3 text-sm leading-6 text-muted-foreground">
              还没有 Provider。请先添加 Provider，再设置图片生成和提示词助手的默认服务。
            </div>
          ) : null}
          <div className="provider-default-grid grid grid-cols-2 gap-3">
            <div className="field grid gap-1.5">
              <span className="text-xs text-muted-foreground">图片默认 Provider</span>
              {hasImageProfiles ? (
                <GallerySelect
                  value={selectedImageProfileId}
                  options={imageProfiles.map((profile) => ({ value: profile.id, label: profile.name }))}
                  ariaLabel="图片默认 Provider"
                  className="settings-select"
                  onChange={(profileId) => {
                    const profile = profiles.find((item) => item.id === profileId)
                    setSelectedImageProfileId(profileId)
                    setImageModel(profile?.defaultImageModel || DEFAULT_MODEL)
                  }}
                />
              ) : (
                <div className="grid min-h-9 place-items-start rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  先添加支持图片的 Provider
                </div>
              )}
            </div>
            <div className="field grid gap-1.5">
              <span className="text-xs text-muted-foreground">提示词默认 Provider</span>
              {hasPromptProfiles ? (
                <GallerySelect
                  value={selectedPromptProfileId}
                  options={promptProfiles.map((profile) => ({ value: profile.id, label: profile.name }))}
                  ariaLabel="提示词默认 Provider"
                  className="settings-select"
                  onChange={(profileId) => {
                    setSelectedPromptProfileId(profileId)
                  }}
                />
              ) : (
                <div className="grid min-h-9 place-items-start rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  先添加支持提示词的 Provider
                </div>
              )}
            </div>
          </div>
          <div className="button-row provider-summary-actions flex justify-end">
            <Button className="primary-button" type="button" disabled={!hasImageProfiles && !hasPromptProfiles} onClick={() => void saveServiceDefaults()}>
              <Save />
              保存默认设置
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="provider-summary-list grid gap-3">
        {profiles.map((profile) => {
          const isImageDefault = settings.selectedImageProfileId === profile.id
          const isPromptDefault = settings.selectedPromptProfileId === profile.id
          return (
            <Card key={profile.id} className="settings-status-card provider-summary-card rounded-2xl shadow-none">
              <CardHeader className="provider-summary-head flex items-start justify-between space-y-0">
                <div className="provider-summary-copy grid min-w-0 gap-1">
                  <div className="provider-summary-title-row flex items-center gap-2">
                    <CardTitle className="truncate text-base">{profile.name}</CardTitle>
                    <div className="provider-badges flex shrink-0 gap-1">
                      {isImageDefault ? <Badge variant="default" className="pill tiny good">图片默认</Badge> : null}
                      {isPromptDefault ? <Badge variant="secondary" className="pill tiny blue">提示词默认</Badge> : null}
                    </div>
                  </div>
                  <span className="truncate text-sm text-muted-foreground">{profile.baseUrl}</span>
                  <span className="text-sm text-muted-foreground">
                    {profile.enabledUsages.includes('image') ? `图片模型 ${profile.defaultImageModel}` : '不提供生图'}
                    {' · '}
                    {profile.enabledUsages.includes('prompt') ? `提示词模型 ${profile.defaultPromptModel}` : '不提供提示词'}
                  </span>
                </div>
                <Button variant="outline" size="icon-sm" type="button" onClick={() => openEditProfileDialog(profile)} title="编辑 Provider">
                  <Pencil />
                </Button>
              </CardHeader>
              <CardContent className="button-row provider-summary-actions flex justify-start gap-2">
                <Button
                  variant="outline"
                  type="button"
                  disabled={!profile.enabledUsages.includes('image') || isImageDefault}
                  onClick={() => void setAsImageDefault(profile)}
                >
                  设为图片默认
                </Button>
                <Button
                  variant="outline"
                  type="button"
                  disabled={!profile.enabledUsages.includes('prompt') || isPromptDefault}
                  onClick={() => void setAsPromptDefault(profile)}
                >
                  设为提示词默认
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <ProviderProfileDialog
        mode={profileDraftMode}
        profileDraft={profileDraft}
        profileApiKey={profileApiKey}
        profileCount={settings.profiles.length}
        onClose={closeProfileDialog}
        onSave={() => void saveProfileDraft()}
        onDelete={() => void deleteProfileDraft()}
        onProfileChange={setProfileDraft}
        onApiKeyChange={setProfileApiKey}
      />
    </>
  )
}
