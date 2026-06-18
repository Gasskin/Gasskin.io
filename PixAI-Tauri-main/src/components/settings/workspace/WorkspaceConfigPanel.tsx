import { useEffect, useMemo, useState } from 'react'
import { CircleHelp, Save, Settings } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import {
  DEFAULT_IMAGE_OUTPUT_FORMAT,
  DEFAULT_MODEL,
  DEFAULT_PROMPT_MODEL,
  IMAGE_BACKGROUNDS,
  IMAGE_BACKGROUND_LABELS,
  IMAGE_INPUT_FIDELITIES,
  IMAGE_INPUT_FIDELITY_LABELS,
  IMAGE_MODERATIONS,
  IMAGE_MODERATION_LABELS,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_OUTPUT_FORMAT_LABELS,
  IMAGE_QUALITIES,
  IMAGE_RATIOS,
  MAX_IMAGE_MAX_RETRIES,
  formatImageQuality,
  getDefaultImageSize,
  getImageSizeOptions,
  supportsImageInputFidelity
} from '../../../shared/image-options'
import type { ImageBackground, ImageGenerationEndpoint, ImageInputFidelity, ImageModeration, ImageOutputFormat } from '../../../shared/types'
import { useAppStore } from '../../../store/app-store'
import { GallerySelect } from '../../common/GallerySelect'
import { SettingsToggleRow } from '../SettingsToggleRow'
import type { GlobalSettingsTab } from '../global/GlobalSettingsModal'

export type WorkspaceConfigPanelProps = {
  onOpenGlobalSettings: (tab?: GlobalSettingsTab) => void
}

export function WorkspaceConfigPanel({ onOpenGlobalSettings }: WorkspaceConfigPanelProps) {
  const {
    activeConversationId,
    conversations,
    settings,
    updateActiveConversation,
    updateSettings,
    upsertProfile
  } = useAppStore()
  const conversation = conversations.find((item) => item.id === activeConversationId) || null
  const profiles = useMemo(() => settings?.profiles || [], [settings])
  const imageProfiles = useMemo(() => profiles.filter((profile) => profile.enabledUsages.includes('image')), [profiles])
  const promptProfiles = useMemo(() => profiles.filter((profile) => profile.enabledUsages.includes('prompt')), [profiles])
  const [selectedImageProfileId, setSelectedImageProfileId] = useState(settings?.selectedImageProfileId || '')
  const [selectedPromptProfileId, setSelectedPromptProfileId] = useState(settings?.selectedPromptProfileId || '')
  const [imageModel, setImageModel] = useState(DEFAULT_MODEL)
  const [imageGenerationEndpoint, setImageGenerationEndpoint] = useState<ImageGenerationEndpoint>('images-api')
  const [promptModel, setPromptModel] = useState(DEFAULT_PROMPT_MODEL)

  useEffect(() => {
    if (!settings) return
    const imageProfile = profiles.find((profile) => profile.id === settings.selectedImageProfileId) || imageProfiles[0]
    const promptProfile = profiles.find((profile) => profile.id === settings.selectedPromptProfileId) || promptProfiles[0]
    setSelectedImageProfileId(imageProfile?.id || '')
    setSelectedPromptProfileId(promptProfile?.id || '')
    setImageModel(imageProfile?.defaultImageModel || DEFAULT_MODEL)
    setImageGenerationEndpoint(imageProfile?.imageGenerationEndpoint || 'images-api')
    setPromptModel(promptProfile?.defaultPromptModel || DEFAULT_PROMPT_MODEL)
  }, [imageProfiles, profiles, promptProfiles, settings])

  if (!settings || !conversation) return <aside className="settings-panel workspace-config-panel border-l border-border bg-card" />

  const imageSelectedProfile = profiles.find((profile) => profile.id === selectedImageProfileId) || imageProfiles[0] || null
  const promptSelectedProfile = profiles.find((profile) => profile.id === selectedPromptProfileId) || promptProfiles[0] || null
  const hasImageProfiles = imageProfiles.length > 0
  const hasPromptProfiles = promptProfiles.length > 0
  const isImageToImage = conversation.referenceImages.length > 0
  const sizeOptions = getImageSizeOptions(conversation.ratio)
  const selectedSize = sizeOptions.some((option) => option.value === conversation.size)
    ? conversation.size
    : getDefaultImageSize(conversation.ratio)

  const saveProviderConfig = async () => {
    const imageProfile = imageSelectedProfile
    const promptProfile = promptSelectedProfile
    if (!imageProfile && !promptProfile) {
      onOpenGlobalSettings('services')
      return
    }
    if (imageProfile && promptProfile && imageProfile.id === promptProfile.id) {
      await upsertProfile({
        ...imageProfile,
        defaultImageModel: imageModel.trim() || DEFAULT_MODEL,
        imageGenerationEndpoint,
        defaultPromptModel: promptModel.trim() || DEFAULT_PROMPT_MODEL
      })
    } else {
      if (imageProfile) {
        await upsertProfile({
          ...imageProfile,
          defaultImageModel: imageModel.trim() || DEFAULT_MODEL,
          imageGenerationEndpoint
        })
      }
      if (promptProfile) await upsertProfile({ ...promptProfile, defaultPromptModel: promptModel.trim() || DEFAULT_PROMPT_MODEL })
    }
    await updateSettings({
      selectedImageProfileId: imageProfile?.id,
      selectedPromptProfileId: promptProfile?.id
    })
    await updateActiveConversation({ model: imageModel.trim() || DEFAULT_MODEL })
  }

  return (
    <aside className="settings-panel workspace-config-panel min-h-0 border-l border-border bg-card">
      <ScrollArea className="h-full">
        <div className="grid gap-3 p-3">
      <Card className="settings-section gap-3 rounded-2xl shadow-none">
        <CardHeader className="section-title flex items-center justify-between space-y-0 pb-0">
          <CardTitle className="text-sm">引擎</CardTitle>
          <Button variant="outline" size="sm" type="button" onClick={() => onOpenGlobalSettings('services')}>
            <Settings size={15} />
            管理服务
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3">
        {!hasImageProfiles && !hasPromptProfiles ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
            请先添加 Provider，再选择图片生成或提示词助手服务。
          </div>
        ) : null}
        <Label className="grid gap-1.5 text-xs text-muted-foreground">
          图片生成
          {hasImageProfiles ? (
            <GallerySelect
              value={selectedImageProfileId}
              options={imageProfiles.map((profile) => ({ value: profile.id, label: profile.name }))}
              ariaLabel="图片生成 Provider"
              className="settings-select"
              onChange={(profileId) => {
                const profile = profiles.find((item) => item.id === profileId)
                setSelectedImageProfileId(profileId)
                setImageModel(profile?.defaultImageModel || DEFAULT_MODEL)
                setImageGenerationEndpoint(profile?.imageGenerationEndpoint || 'images-api')
              }}
            />
          ) : (
            <Button variant="outline" type="button" onClick={() => onOpenGlobalSettings('services')}>
              添加 Provider
            </Button>
          )}
        </Label>
        <Label className="grid gap-1.5 text-xs text-muted-foreground">
          提示词助手
          {hasPromptProfiles ? (
            <GallerySelect
              value={selectedPromptProfileId}
              options={promptProfiles.map((profile) => ({ value: profile.id, label: profile.name }))}
              ariaLabel="提示词助手 Provider"
              className="settings-select"
              onChange={(profileId) => {
                const profile = profiles.find((item) => item.id === profileId)
                setSelectedPromptProfileId(profileId)
                setPromptModel(profile?.defaultPromptModel || DEFAULT_PROMPT_MODEL)
              }}
            />
          ) : (
            <Button variant="outline" type="button" onClick={() => onOpenGlobalSettings('services')}>
              添加 Provider
            </Button>
          )}
        </Label>
        <Label className="grid gap-1.5 text-xs text-muted-foreground">
          图片模型
          <Input value={imageModel} disabled={!hasImageProfiles} placeholder="先添加 Provider" onChange={(event) => setImageModel(event.target.value)} />
        </Label>
        <div className="field grid gap-1.5">
          <span className="text-xs text-muted-foreground">生图端点</span>
          <GallerySelect
            value={imageGenerationEndpoint}
            options={[
              { value: 'images-api', label: 'Images API' },
              { value: 'responses-api', label: 'Responses 图像工具' }
            ]}
            ariaLabel="生图端点"
            className="settings-select"
            disabled={!hasImageProfiles}
            onChange={(endpoint) => setImageGenerationEndpoint(endpoint as ImageGenerationEndpoint)}
          />
        </div>
        <Label className="grid gap-1.5 text-xs text-muted-foreground">
          提示词模型
          <Input value={promptModel} disabled={!hasPromptProfiles} placeholder="先添加 Provider" onChange={(event) => setPromptModel(event.target.value)} />
        </Label>
        <Button className="primary-button full w-full" type="button" disabled={!hasImageProfiles && !hasPromptProfiles} onClick={() => void saveProviderConfig()}>
          <Save size={15} />
          保存引擎设置
        </Button>
        </CardContent>
      </Card>

      <Card className="settings-section gap-3 rounded-2xl shadow-none">
        <CardHeader className="section-title flex items-center justify-between space-y-0 pb-0">
          <CardTitle className="text-sm">基础参数</CardTitle>
          <Badge variant="outline" className="pill tiny">高频</Badge>
        </CardHeader>
        <CardContent className="grid gap-3">
        <div className="field grid gap-1.5">
          <span className="text-xs text-muted-foreground">图片比例</span>
          <div className="segmented grid grid-cols-4 gap-1 rounded-xl border border-border bg-muted p-1">
            {IMAGE_RATIOS.map((ratio) => (
              <Button
                key={ratio}
                className={cn('h-8 px-1', conversation.ratio === ratio ? 'on bg-background shadow-sm' : '')}
                variant={conversation.ratio === ratio ? 'secondary' : 'ghost'}
                size="sm"
                type="button"
                onClick={() => void updateActiveConversation({ ratio, size: getDefaultImageSize(ratio) })}
              >
                {ratio}
              </Button>
            ))}
          </div>
        </div>
        <div className="field grid gap-1.5">
          <span className="text-xs text-muted-foreground">分辨率</span>
          <GallerySelect
            value={selectedSize}
            options={sizeOptions}
            ariaLabel="选择分辨率"
            className="settings-select"
            onChange={(size) => void updateActiveConversation({ size })}
          />
        </div>
        <div className="field grid gap-1.5">
          <span className="field-label-with-help flex items-center gap-2 text-xs text-muted-foreground">
            <span>质量</span>
            <Button
              type="button"
              className="info-icon size-6"
              variant="ghost"
              size="icon-sm"
              title="质量越高，细节通常更多，但生成会更慢，也更容易放大成本。"
              aria-label="质量说明"
            >
              <CircleHelp size={14} />
            </Button>
          </span>
          <div className="segmented grid grid-cols-3 gap-1 rounded-xl border border-border bg-muted p-1">
            {IMAGE_QUALITIES.map((quality) => (
              <Button
                key={quality}
                className={cn('h-8 px-1', conversation.quality === quality ? 'on bg-background shadow-sm' : '')}
                variant={conversation.quality === quality ? 'secondary' : 'ghost'}
                size="sm"
                type="button"
                onClick={() => void updateActiveConversation({ quality })}
              >
                {formatImageQuality(quality)}
              </Button>
            ))}
          </div>
        </div>
        <Label className="grid gap-1.5 text-xs text-muted-foreground">
          生成数量
          <Input type="number" min={1} max={10} value={conversation.n} onChange={(event) => void updateActiveConversation({ n: Number(event.target.value) })} />
        </Label>
        </CardContent>
      </Card>

      <Card className="settings-section gap-3 rounded-2xl shadow-none">
        <CardHeader className="section-title flex items-center justify-between space-y-0 pb-0">
          <CardTitle className="text-sm">高级参数</CardTitle>
          <Badge variant={isImageToImage ? 'default' : 'outline'} className={`pill tiny ${isImageToImage ? 'blue' : ''}`}>{isImageToImage ? '图生图' : '文生图'}</Badge>
        </CardHeader>
        <CardContent>
        <details className="advanced-settings group">
          <summary className="flex min-h-10 cursor-pointer items-center justify-between rounded-lg border border-border bg-muted px-3 text-sm font-medium">
            <span>展开高级配置</span>
            <Badge variant="outline" className="pill tiny">低频</Badge>
          </summary>
          <div className="advanced-settings-body grid gap-3 pt-3">
            <Label className="grid gap-1.5 text-xs text-muted-foreground">
              失败重试次数
              <Input
                type="number"
                min={0}
                max={MAX_IMAGE_MAX_RETRIES}
                step={1}
                value={conversation.maxRetries}
                onChange={(event) => void updateActiveConversation({ maxRetries: Number(event.target.value) })}
              />
            </Label>
            <SettingsToggleRow
              label="流式输出"
              help="开启后会以流式方式接收图片结果；默认关闭。"
              checked={conversation.stream}
              onChange={() => void updateActiveConversation({ stream: !conversation.stream })}
            />
            <Label className="grid gap-1.5 text-xs text-muted-foreground">
              <span className="field-label-with-help flex items-center gap-2">
                <span>超时时间(秒)</span>
                <Button
                  type="button"
                  className="info-icon size-6"
                  variant="ghost"
                  size="icon-sm"
                  title="单张图片的最大等待时间；每次重试都会重新计时。"
                  aria-label="超时时间说明"
                >
                  <CircleHelp size={14} />
                </Button>
              </span>
              <Input
                type="number"
                min={1}
                max={1800}
                step={1}
                value={conversation.generationTimeoutSeconds}
                onChange={(event) => void updateActiveConversation({ generationTimeoutSeconds: Number(event.target.value) })}
              />
            </Label>
            <div className="field grid gap-1.5">
              <span className="field-label-with-help flex items-center gap-2 text-xs text-muted-foreground">
                <span>输出格式</span>
                <Button
                  type="button"
                  className="info-icon size-6"
                  variant="ghost"
                  size="icon-sm"
                  title={`控制最终图片文件格式，默认使用 ${DEFAULT_IMAGE_OUTPUT_FORMAT.toUpperCase()}。`}
                  aria-label="输出格式说明"
                >
                  <CircleHelp size={14} />
                </Button>
              </span>
              <GallerySelect
                value={conversation.outputFormat}
                options={IMAGE_OUTPUT_FORMATS.map((value) => ({ value, label: IMAGE_OUTPUT_FORMAT_LABELS[value] }))}
                ariaLabel="输出格式"
                className="settings-select"
                onChange={(outputFormat) => void updateActiveConversation({ outputFormat: outputFormat as ImageOutputFormat })}
              />
            </div>
            <Label className="grid gap-1.5 text-xs text-muted-foreground">
              <span className="field-label-with-help flex items-center gap-2">
                <span>输出压缩</span>
                <Button
                  type="button"
                  className="info-icon size-6"
                  variant="ghost"
                  size="icon-sm"
                  title="仅 JPEG 和 WebP 有效，数值越高画质越好、文件越大。"
                  aria-label="输出压缩说明"
                >
                  <CircleHelp size={14} />
                </Button>
              </span>
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                value={conversation.outputCompression ?? ''}
                disabled={conversation.outputFormat === 'png'}
                placeholder="留空"
                onChange={(event) => {
                  const value = event.target.value.trim()
                  void updateActiveConversation({ outputCompression: value ? Number(value) : null })
                }}
              />
            </Label>
            <div className="field grid gap-1.5">
              <span className="field-label-with-help flex items-center gap-2 text-xs text-muted-foreground">
                <span>背景</span>
                <Button
                  type="button"
                  className="info-icon size-6"
                  variant="ghost"
                  size="icon-sm"
                  title="选择是否保持自动背景或强制不透明背景。"
                  aria-label="背景说明"
                >
                  <CircleHelp size={14} />
                </Button>
              </span>
              <GallerySelect
                value={conversation.background}
                options={IMAGE_BACKGROUNDS.map((value) => ({ value, label: IMAGE_BACKGROUND_LABELS[value] }))}
                ariaLabel="背景"
                className="settings-select"
                onChange={(background) => void updateActiveConversation({ background: background as ImageBackground })}
              />
            </div>
            <div className="field grid gap-1.5">
              <span className="field-label-with-help flex items-center gap-2 text-xs text-muted-foreground">
                <span>审核策略</span>
                <Button
                  type="button"
                  className="info-icon size-6"
                  variant="ghost"
                  size="icon-sm"
                  title="控制内容审核强度，默认使用自动策略。"
                  aria-label="审核策略说明"
                >
                  <CircleHelp size={14} />
                </Button>
              </span>
              <GallerySelect
                value={conversation.moderation}
                options={IMAGE_MODERATIONS.map((value) => ({ value, label: IMAGE_MODERATION_LABELS[value] }))}
                ariaLabel="审核策略"
                className="settings-select"
                onChange={(moderation) => void updateActiveConversation({ moderation: moderation as ImageModeration })}
              />
            </div>
            <Label className="grid gap-1.5 text-xs text-muted-foreground">
              <span className="field-label-with-help flex items-center gap-2">
                <span>中间图数量</span>
                <Button
                  type="button"
                  className="info-icon size-6"
                  variant="ghost"
                  size="icon-sm"
                  title="仅流式输出时有效，范围为 0 到 3。"
                  aria-label="中间图数量说明"
                >
                  <CircleHelp size={14} />
                </Button>
              </span>
              <Input
                type="number"
                min={0}
                max={3}
                step={1}
                value={conversation.partialImages ?? 0}
                disabled={!conversation.stream}
                onChange={(event) => void updateActiveConversation({ partialImages: Number(event.target.value) })}
              />
            </Label>
            {isImageToImage && supportsImageInputFidelity(conversation.model) ? (
              <div className="field grid gap-1.5">
                <span className="field-label-with-help flex items-center gap-2 text-xs text-muted-foreground">
                  <span>输入保真度</span>
                  <Button
                    type="button"
                    className="info-icon size-6"
                    variant="ghost"
                    size="icon-sm"
                    title="编辑场景下控制对输入参考图细节的保留程度。"
                    aria-label="输入保真度说明"
                  >
                    <CircleHelp size={14} />
                  </Button>
                </span>
                <GallerySelect
                  value={conversation.inputFidelity || ''}
                  options={[
                    { value: '', label: '保持默认' },
                    ...IMAGE_INPUT_FIDELITIES.map((value) => ({ value, label: IMAGE_INPUT_FIDELITY_LABELS[value] }))
                  ]}
                  ariaLabel="输入保真度"
                  className="settings-select"
                  onChange={(inputFidelity) =>
                    void updateActiveConversation({
                      inputFidelity: inputFidelity === '' ? null : inputFidelity as ImageInputFidelity
                    })
                  }
                />
              </div>
            ) : null}
          </div>
        </details>
        </CardContent>
      </Card>

      <Card className="settings-section gap-3 rounded-2xl shadow-none">
        <CardHeader className="section-title flex items-center justify-between space-y-0 pb-0">
          <CardTitle className="text-sm">会话选项</CardTitle>
          <Badge variant="outline" className="pill tiny">轻量</Badge>
        </CardHeader>
        <CardContent>
        <div className="toggle-stack grid gap-2">
          <SettingsToggleRow
            label="自动写入历史"
            checked={conversation.autoSaveHistory}
            onChange={() => void updateActiveConversation({ autoSaveHistory: !conversation.autoSaveHistory })}
          />
          <SettingsToggleRow
            label="失败详情保留"
            checked={conversation.keepFailureDetails}
            onChange={() => void updateActiveConversation({ keepFailureDetails: !conversation.keepFailureDetails })}
          />
        </div>
        </CardContent>
      </Card>
        <Separator />
        </div>
      </ScrollArea>
    </aside>
  )
}
