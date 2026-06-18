import { Plus, Save, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { GallerySelect } from '../../common/GallerySelect'
import { DEFAULT_MODEL, DEFAULT_PROMPT_MODEL } from '../../../shared/image-options'
import type { ImageGenerationEndpoint, ProviderProfile } from '../../../shared/types'

type ProviderProfileDialogProps = {
  mode: 'create' | 'edit'
  profileDraft: ProviderProfile | null
  profileApiKey: string
  profileCount: number
  onClose: () => void
  onSave: () => void
  onDelete: () => void
  onProfileChange: (profile: ProviderProfile) => void
  onApiKeyChange: (value: string) => void
}

export function ProviderProfileDialog({
  mode,
  profileDraft,
  profileApiKey,
  profileCount,
  onClose,
  onSave,
  onDelete,
  onProfileChange,
  onApiKeyChange
}: ProviderProfileDialogProps) {
  return (
    <Dialog open={Boolean(profileDraft)} onOpenChange={(open) => { if (!open) onClose() }}>
      {profileDraft ? (
        <DialogContent className="provider-modal max-w-2xl" aria-label={mode === 'create' ? '新增供应商' : '编辑供应商'} aria-describedby={undefined}>
        <DialogHeader className="modal-head">
          <DialogTitle>{mode === 'create' ? '新增供应商' : '编辑供应商'}</DialogTitle>
        </DialogHeader>
        <div className="profile-editor grid gap-3">
          <div className="field grid gap-1.5">
            <span className="text-xs text-muted-foreground">用途</span>
            <div className="segmented provider-usage grid grid-cols-3 gap-1 rounded-xl border border-border bg-muted p-1">
              <Button
                className={cn('h-8', hasSameUsages(profileDraft, ['image']) ? 'on bg-background shadow-sm' : '')}
                variant={hasSameUsages(profileDraft, ['image']) ? 'secondary' : 'ghost'}
                size="sm"
                type="button"
                onClick={() => onProfileChange({ ...profileDraft, enabledUsages: ['image'] })}
              >
                生图
              </Button>
              <Button
                className={cn('h-8', hasSameUsages(profileDraft, ['prompt']) ? 'on bg-background shadow-sm' : '')}
                variant={hasSameUsages(profileDraft, ['prompt']) ? 'secondary' : 'ghost'}
                size="sm"
                type="button"
                onClick={() => onProfileChange({ ...profileDraft, enabledUsages: ['prompt'] })}
              >
                提示词
              </Button>
              <Button
                className={cn('h-8', hasSameUsages(profileDraft, ['image', 'prompt']) ? 'on bg-background shadow-sm' : '')}
                variant={hasSameUsages(profileDraft, ['image', 'prompt']) ? 'secondary' : 'ghost'}
                size="sm"
                type="button"
                onClick={() => onProfileChange({ ...profileDraft, enabledUsages: ['image', 'prompt'] })}
              >
                二者都可
              </Button>
            </div>
          </div>
          <Label className="grid gap-1.5 text-xs text-muted-foreground">
            配置名称
            <Input value={profileDraft.name} onChange={(event) => onProfileChange({ ...profileDraft, name: event.target.value })} />
          </Label>
          <Label className="grid gap-1.5 text-xs text-muted-foreground">
            接口地址
            <Input value={profileDraft.baseUrl} onChange={(event) => onProfileChange({ ...profileDraft, baseUrl: event.target.value })} />
          </Label>
          <Label className="grid gap-1.5 text-xs text-muted-foreground">
            API 密钥
            <Input
              value={profileApiKey}
              type="password"
              placeholder={mode === 'edit' && profileDraft.apiKeyStored ? '留空保持不变' : 'sk-...'}
              onChange={(event) => onApiKeyChange(event.target.value)}
            />
          </Label>
          {profileDraft.enabledUsages.includes('image') ? (
            <>
              <Label className="grid gap-1.5 text-xs text-muted-foreground">
                图片默认模型
                <Input
                  value={profileDraft.defaultImageModel}
                  onChange={(event) => onProfileChange({ ...profileDraft, defaultImageModel: event.target.value })}
                />
              </Label>
              <div className="field grid gap-1.5">
                <span className="text-xs text-muted-foreground">生图端点</span>
                <GallerySelect
                  value={profileDraft.imageGenerationEndpoint}
                  options={[
                    { value: 'images-api', label: 'Images API' },
                    { value: 'responses-api', label: 'Responses 图像工具' }
                  ]}
                  ariaLabel="生图端点"
                  className="settings-select"
                  onChange={(imageGenerationEndpoint) =>
                    onProfileChange({ ...profileDraft, imageGenerationEndpoint: imageGenerationEndpoint as ImageGenerationEndpoint })
                  }
                />
              </div>
            </>
          ) : null}
          {profileDraft.enabledUsages.includes('prompt') ? (
            <Label className="grid gap-1.5 text-xs text-muted-foreground">
              提示词助手模型
              <Input
                value={profileDraft.defaultPromptModel}
                onChange={(event) => onProfileChange({ ...profileDraft, defaultPromptModel: event.target.value })}
              />
            </Label>
          ) : null}
        </div>
        <div className="button-row modal-actions flex justify-end gap-2">
          {mode === 'edit' && profileCount > 0 ? (
            <Button className="danger-button mr-auto" variant="destructive" type="button" onClick={onDelete}>
              <Trash2 size={15} />
              删除
            </Button>
          ) : null}
          <Button variant="outline" type="button" onClick={onClose}>
            <X size={15} />
            取消
          </Button>
          <Button className="primary-button" type="button" onClick={onSave}>
            {mode === 'create' ? <Plus size={15} /> : <Save size={15} />}
            {mode === 'create' ? '添加供应商' : '保存供应商'}
          </Button>
        </div>
      </DialogContent>
      ) : null}
    </Dialog>
  )
}

export function createProviderProfileDraft(): ProviderProfile {
  const now = new Date().toISOString()
  return {
    id: '',
    name: 'OpenAI 兼容接口',
    type: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:37123',
    defaultImageModel: DEFAULT_MODEL,
    defaultPromptModel: DEFAULT_PROMPT_MODEL,
    imageGenerationEndpoint: 'images-api',
    enabledUsages: ['image', 'prompt'],
    capabilities: ['text-to-image', 'image-to-image', 'prompt-assist', 'connection-test', 'streaming', 'input-fidelity'],
    apiKeyStored: false,
    insecureStorage: false,
    createdAt: now,
    updatedAt: now
  }
}

function hasSameUsages(profile: ProviderProfile, usages: Array<'image' | 'prompt'>): boolean {
  return profile.enabledUsages.length === usages.length && usages.every((usage) => profile.enabledUsages.includes(usage))
}
