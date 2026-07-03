# ===========================================================================
# Live2D Nito 模型下载与部署脚本
# ===========================================================================
# 用途：
#   - 引导用户从 Live2D 官网手动下载 Nito 示例模型
#   - 协助将 runtime 文件夹内的模型文件部署到 assets\live2d\nito\ 目录
#   - 校验部署结果，并枚举差分角色清单（用于换皮肤功能）
#
# 背景：
#   Live2D 官网下载需浏览器手动操作（含许可协议同意步骤），无法脚本化下载。
#   下载页面：https://www.live2d.com/zh-CHS/learn/sample/nito/
#
# 模型特征：
#   - 二头身角色，多差分角色（适合换皮肤）
#   - 含「张大嘴」表情（适合桌宠交互）
#   - Live2D 官方免费示例模型
# ===========================================================================

# 严格模式，便于及早发现问题
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ------------------------- 路径与常量定义 -------------------------

# 脚本所在目录（即 assets\live2d\）
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Definition
# Nito 模型目标目录（assets\live2d\nito\）
$NitoDir     = Join-Path $ScriptDir 'nito'
# Live2D 官网下载页面
$DownloadUrl = 'https://www.live2d.com/zh-CHS/learn/sample/nito/'

# ------------------------- 工具函数 -------------------------

function Write-Step   { param([string]$Msg) Write-Host "`n>>> $Msg" -ForegroundColor Cyan }
function Write-Ok     { param([string]$Msg) Write-Host "    [OK] $Msg" -ForegroundColor Green }
function Write-Warn   { param([string]$Msg) Write-Host "    [!!] $Msg" -ForegroundColor Yellow }
function Write-Info   { param([string]$Msg) Write-Host "    -- $Msg" -ForegroundColor DarkGray }

# 读取用户确认（Y/N），默认 Y
function Read-YesNo {
    param(
        [string]$Prompt,
        [switch]$DefaultNo
    )
    $hint = if ($DefaultNo) { '[y/N]' } else { '[Y/n]' }
    $ans = Read-Host "$Prompt $hint"
    if ([string]::IsNullOrWhiteSpace($ans)) {
        return -not $DefaultNo
    }
    return $ans.Trim().ToLower() -eq 'y'
}

# ------------------------- Step 1: 检查目标目录 -------------------------

Write-Step 'Step 1: 检查 Nito 模型目标目录'
if (-not (Test-Path -LiteralPath $NitoDir -PathType Container)) {
    New-Item -ItemType Directory -Path $NitoDir -Force | Out-Null
    Write-Info "已创建目录: $NitoDir"
} else {
    Write-Info "目录已存在: $NitoDir"
}

# ------------------------- Step 2: 检测是否已部署 -------------------------

Write-Step 'Step 2: 检测 Nito 模型是否已部署'

$modelFiles = @()
if (Test-Path -LiteralPath $NitoDir -PathType Container) {
    $modelFiles = @(Get-ChildItem -LiteralPath $NitoDir -Filter '*.model3.json' -File -ErrorAction SilentlyContinue)
}

if ($modelFiles.Count -gt 0) {
    Write-Ok "已检测到 $($modelFiles.Count) 个 .model3.json 文件，模型似乎已部署。"
    # 直接跳到清单输出
    $alreadyDeployed = $true
} else {
    Write-Warn '尚未检测到 .model3.json 文件，需要下载并部署模型。'
    $alreadyDeployed = $false
}

# ------------------------- Step 3: 引导手动下载 -------------------------

if (-not $alreadyDeployed) {

    Write-Step 'Step 3: 手动下载 Nito 模型包'

    Write-Host ''
    Write-Host '    由于 Live2D 官网需要浏览器手动操作（同意许可协议），脚本无法自动下载。'
    Write-Host '    请按以下步骤操作：'
    Write-Host ''
    Write-Host '      1) 在浏览器打开下载页面：' -ForegroundColor White
    Write-Host "         $DownloadUrl" -ForegroundColor White
    Write-Host '      2) 阅读并同意 Live2D Sample Data License Agreement' -ForegroundColor White
    Write-Host '      3) 点击「下载」按钮，保存 zip 压缩包到本地' -ForegroundColor White
    Write-Host '      4) 解压压缩包' -ForegroundColor White
    Write-Host '      5) 进入解压目录中的 runtime 文件夹' -ForegroundColor White
    Write-Host '         （其中应包含 .moc3 / .motion3.json / .model3.json' -ForegroundColor White
    Write-Host '           / .pose3.json / .cdi3.json + 贴图 .png 等文件）' -ForegroundColor White
    Write-Host ''

    if (-not (Read-YesNo '是否已下载并解压完成？准备好后继续部署步骤。')) {
        Write-Warn '已取消。请完成下载后重新运行本脚本。'
        exit 0
    }

    # ------------------------- Step 4: 选择 runtime 目录并复制 -------------------------

    Write-Step 'Step 4: 选择 runtime 目录并复制模型文件'

    # 弹出文件夹选择对话框
    Add-Type -AssemblyName System.Windows.Forms
    $fb = New-Object System.Windows.Forms.FolderBrowserDialog
    $fb.Description = '请选择解压后的 runtime 目录（包含 .model3.json 的文件夹）'
    $fb.ShowNewFolderButton = $false

    $dialogResult = $fb.ShowDialog()
    if ($dialogResult -ne [System.Windows.Forms.DialogResult]::OK -or [string]::IsNullOrWhiteSpace($fb.SelectedPath)) {
        Write-Warn '未选择目录，已取消部署。'
        Write-Info "请手动将 runtime 目录下的全部文件复制到: $NitoDir"
        exit 0
    }

    $RuntimeDir = $fb.SelectedPath
    Write-Info "已选目录: $RuntimeDir"

    # 校验所选目录是否包含 .model3.json
    $selectedModelFiles = @(Get-ChildItem -LiteralPath $RuntimeDir -Filter '*.model3.json' -File -ErrorAction SilentlyContinue)
    if ($selectedModelFiles.Count -eq 0) {
        Write-Warn '所选目录中未找到 .model3.json 文件，可能选错了目录。'
        Write-Info '请确认选择的是解压后的 runtime 子目录（而非外层文件夹）。'
        if (-not (Read-YesNo '是否仍要继续复制？（不会清空目标目录）' -DefaultNo)) {
            exit 0
        }
    }

    # 列举将复制的文件类型
    $allowedExt = @('.moc3', '.motion3.json', '.model3.json', '.pose3.json', '.cdi3.json', '.png', '.physics3.json', '.exp3.json', '.grp3.json')
    Write-Info '将复制的文件类型：'
    foreach ($ext in $allowedExt) { Write-Host "        - $ext" -ForegroundColor DarkGray }

    # 复制文件（递归，保留子目录结构 - 例如不同差分角色可能分目录存放）
    $copiedCount = 0
    Get-ChildItem -LiteralPath $RuntimeDir -Recurse -File | Where-Object {
        $name = $_.Name
        $matched = $false
        foreach ($ext in $allowedExt) {
            if ($name -like "*$ext") { $matched = $true; break }
        }
        $matched
    } | ForEach-Object {
        # 计算相对路径，保留 runtime 内的目录结构
        $relPath = $_.FullName.Substring($RuntimeDir.Length).TrimStart('\','/')
        $destPath = Join-Path $NitoDir $relPath
        $destDir = Split-Path -Parent $destPath
        if (-not (Test-Path -LiteralPath $destDir -PathType Container)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
        Copy-Item -LiteralPath $_.FullName -Destination $destPath -Force
        $copiedCount++
    }

    Write-Ok "已复制 $copiedCount 个文件到 $NitoDir"

    # 重新检测
    $modelFiles = @(Get-ChildItem -LiteralPath $NitoDir -Filter '*.model3.json' -File -Recurse -ErrorAction SilentlyContinue)
}

# ------------------------- Step 5: 校验与清单输出 -------------------------

Write-Step 'Step 5: 校验部署结果并枚举差分角色清单'

if ($modelFiles.Count -eq 0) {
    Write-Warn '部署后仍未检测到 .model3.json 文件，部署可能失败。'
    Write-Info '请检查 nito 目录：'
    Write-Info "    $NitoDir"
    Write-Info '或重新运行本脚本完成部署。'
    exit 1
}

# 校验所需文件类型是否齐全（仅警告，不阻塞）
$requiredExt = @('.moc3', '.model3.json')
foreach ($ext in $requiredExt) {
    $found = Get-ChildItem -LiteralPath $NitoDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*$ext" }
    if (@($found).Count -eq 0) {
        Write-Warn "缺少 $ext 文件，模型可能无法正常加载。"
    }
}

Write-Ok "部署成功！检测到 $($modelFiles.Count) 个差分角色（.model3.json）："
Write-Host ''
Write-Host '    差分角色清单（用于换皮肤功能）：' -ForegroundColor White
Write-Host '    ----------------------------------------' -ForegroundColor DarkGray
$index = 0
foreach ($mf in $modelFiles) {
    $index++
    $relName = $mf.FullName.Substring($NitoDir.Length).TrimStart('\','/')
    Write-Host ("    [{0}] {1}" -f $index, $relName) -ForegroundColor Green
}
Write-Host '    ----------------------------------------' -ForegroundColor DarkGray
Write-Host ''
Write-Info '提示：'
Write-Info "  - 以上 .model3.json 即为可切换的差分角色（皮肤）"
Write-Info '  - 后续 Task 8（换皮肤功能）会将此清单写入：'
Write-Info "      $(Join-Path $NitoDir 'skins.json')"

# 提示用户确认是否生成 skins.json 草稿
if (Read-YesNo '是否现在将检测到的差分角色写入 skins.json？（仅生成草稿，不影响后续 Task）' -DefaultNo) {
    $skins = @()
    foreach ($mf in $modelFiles) {
        $relName = $mf.FullName.Substring($NitoDir.Length).TrimStart('\','/')
        $skins += [PSCustomObject]@{
            name  = [System.IO.Path]::GetFileNameWithoutExtension($mf.Name)
            model = $relName
        }
    }
    $skinsJson = $skins | ConvertTo-Json -Depth 5
    if ($modelFiles.Count -eq 1) {
        # ConvertTo-Json 单对象会输出散列，包裹一下
        $skinsJson = @($skinsJson) | ConvertTo-Json -Depth 5 -AsArray
    }
    $skinsPath = Join-Path $NitoDir 'skins.json'
    # 注意：此处覆盖 skins.json 仅在用户确认后发生；默认 skins.json 保留为空数组 []
    Set-Content -LiteralPath $skinsPath -Value $skinsJson -Encoding UTF8
    Write-Ok "已写入草稿清单：$skinsPath"
}

Write-Host ''
Write-Ok 'Nito 模型部署流程完成。'
Write-Host ''
