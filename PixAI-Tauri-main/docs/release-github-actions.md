# PixAI GitHub Actions 发布流程

这份文档记录正式版本发布流程。后续 Windows 和 macOS 安装包都走 GitHub Actions 构建和发布，本机只用于改版本号、提交、打 tag、观察结果。

## 发布原则

- 默认从 `main` 最新提交发布，tag 应指向包含最新 release workflow 的提交。
- 推荐 tag 使用纯版本号，例如 `0.0.11`。workflow 也支持 `v0.0.11`，但 package 版本仍然必须是 `0.0.11`。
- 生产 updater 私钥只放在 GitHub Secrets，不写入 workflow、README、脚本或 release asset。
- `src-tauri/tauri.conf.json` 中只提交 updater public key。
- 正式 release 必须同时包含 Windows x64、macOS arm64、macOS x64 的 updater 平台条目。

## GitHub Secrets

仓库需要配置：

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

`TAURI_SIGNING_PRIVATE_KEY` 必填，内容是生产 updater 私钥。`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 只有私钥加密时才需要；当前生产 key 不需要密码。

检查 secret 是否存在：

```bash
gh secret list --repo FingerCaster/PixAI-Tauri
```

首次设置或轮换私钥时：

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY \
  --repo FingerCaster/PixAI-Tauri \
  --body-file artifacts/release-updater/keys/updater.key
```

轮换私钥会导致旧版本客户端不再信任后续更新，除非确认需要，否则不要更换。

## 发版前检查

同步主分支：

```bash
git switch main
git fetch origin --tags
git pull --ff-only origin main
git status --short --branch
```

确认要发布的版本号：

```bash
VERSION=0.0.11
TAG="$VERSION"
```

确认 tag 和 release 还不存在：

```bash
git rev-parse -q --verify "refs/tags/$TAG"
gh release view "$TAG" --repo FingerCaster/PixAI-Tauri
```

上面两个命令如果找不到 tag/release，才适合继续发布这个新版本。

## 更新版本号

把以下文件中的应用版本统一改成同一个版本：

```text
package.json
src-tauri/tauri.conf.json
src-tauri/Cargo.toml
src-tauri/Cargo.lock
```

`src-tauri/Cargo.lock` 中要确认 `name = "pixai-tauri"` 对应的 `version` 也更新了。

检查版本是否一致：

```bash
node -p "require('./package.json').version"
node -p "JSON.parse(require('node:fs').readFileSync('src-tauri/tauri.conf.json', 'utf8')).version"
rg -n '^(version = )|name = "pixai-tauri"' src-tauri/Cargo.toml src-tauri/Cargo.lock
```

运行本地检查：

```bash
pnpm install --frozen-lockfile
pnpm check
```

提交版本号变更：

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: release $VERSION"
```

## 触发发布

正常新版本发布使用 tag push：

```bash
git tag "$TAG"
git push origin main "$TAG"
```

tag push 会触发 `.github/workflows/release.yml`。workflow 会执行：

```text
prepare -> check -> build matrix -> publish
```

构建矩阵：

```text
Windows x64       windows-latest
macOS arm64       macos-14
macOS x64         macos-14 + x86_64-apple-darwin target
```

发布阶段会先创建 draft GitHub Release，合并三个平台的 staging artifact，上传完整 release assets，然后把 release 发布为 latest。

Release 正文使用 GitHub 自动生成的 release notes。`latest.json` 的 `notes` 会复用 Release 正文，所以正式发布后更新提示里也应该能看到本次版本的更新内容，而不是只有版本号。

## 手动重跑

如果同版本发布因为 GitHub runner、网络、workflow bug 等原因失败，且需要使用 `main` 上的最新 workflow 重跑，可以手动 dispatch：

```bash
gh workflow run release.yml \
  --repo FingerCaster/PixAI-Tauri \
  --ref main \
  -f version="$VERSION" \
  -f tag="$TAG"
```

同版本重跑会通过 `gh release upload --clobber` 覆盖同名 assets。确认 release 状态后再重跑，避免覆盖已经确认无误的产物。

## 观察 Actions

查看最近的 release run：

```bash
gh run list --repo FingerCaster/PixAI-Tauri --workflow release.yml --limit 5
```

跟踪某个 run：

```bash
gh run watch <run-id> --repo FingerCaster/PixAI-Tauri
```

查看失败日志：

```bash
gh run view <run-id> --repo FingerCaster/PixAI-Tauri --log-failed
```

## 验证发布结果

Release 应该不是 draft：

```bash
gh release view "$TAG" \
  --repo FingerCaster/PixAI-Tauri \
  --json tagName,isDraft,isPrerelease,url,assets
```

必须包含这些 assets：

```text
latest.json
PixAI_<version>_x64_en-US.msi
PixAI_<version>_x64-setup.exe
PixAI_<version>_macos-aarch64.app.tar.gz
PixAI_<version>_macos-aarch64.dmg
PixAI_<version>_macos-x64.app.tar.gz
PixAI_<version>_macos-x64.dmg
```

验证 updater feed。这个地址使用 GitHub latest release，能确认最新公开 release 正在被 updater 读取：

```bash
curl -fsSL \
  https://github.com/FingerCaster/PixAI-Tauri/releases/latest/download/latest.json \
  | jq '{version, pub_date, platforms: (.platforms | keys)}'
```

`platforms` 必须包含：

```text
darwin-aarch64
darwin-x86_64
windows-x86_64-msi
windows-x86_64-nsis
```

## 常见失败

`Missing secret`

检查 `TAURI_SIGNING_PRIVATE_KEY` 是否配置到 GitHub Secrets。

`Version mismatch`

tag 去掉开头的 `v` 后必须等于 `package.json` 的 `version`。

`Merged latest.json is missing required platforms`

某个 build matrix 没有产出 staging artifact。先看失败平台日志，不要手动上传半套 assets。

tag 触发的 workflow 不是最新版本

tag push 使用 tag 指向提交中的 workflow 文件。以后新版本必须先把 workflow 修复提交到 `main`，再打 tag。已存在同版本如需用最新 workflow 重跑，使用手动 dispatch，并把 `--ref` 指向 `main`。

`windows-latest` runner notice

GitHub 可能提示 `windows-latest` 将切换到新镜像。只要构建没失败就不是发布阻塞；如果未来工具链不兼容，再把 workflow pin 到具体 Windows 镜像。

## 本地脚本定位

正式发布默认不在本机打 Windows/macOS 包。下面这些脚本只用于调试、应急或理解 CI 的分步行为：

```bash
pnpm updater:release:build -- --version "$VERSION"
pnpm updater:release:manifest -- --version "$VERSION" --tag "$TAG"
pnpm updater:release:publish -- --version "$VERSION" --tag "$TAG"
pnpm updater:release:publish-staged -- --version "$VERSION" --tag "$TAG"
```

本地生成的 `artifacts/` 已被 gitignore。不要提交 `artifacts/release-updater/keys/updater.key`。
