# 世界书卡面管理 —— 安装 / 卸载脚本
#
# 用法（在本文件夹里右键「使用 PowerShell 运行」，或者拖到 PowerShell 窗口里）：
#
#   .\install.ps1 -Action install     把插件装进酒馆
#   .\install.ps1 -Action uninstall   从酒馆里删掉插件
#   .\install.ps1 -Action status      只看看装了没，不动任何东西
#
# 这个脚本只做一件事：复制/删除 worldbook-gallery 这一个文件夹。
# 不碰酒馆的其它任何文件，不碰你的角色卡和世界书。

param(
    [ValidateSet('install', 'uninstall', 'status')]
    [string]$Action = 'status',

    # 酒馆的安装根目录。默认留空，脚本会自己去找；
    # 找不到时，用 -TavernRoot '你的酒馆路径' 手动指定。
    [string]$TavernRoot = ''
)

$ErrorActionPreference = 'Stop'

# ---- 路径配置 ----
# 这个扩展可能以两种文件夹名存在：
#   从 Git URL 安装时，酒馆用仓库名 → sillytavern-visual-worldbook
#   手动拷贝本文件夹时               → worldbook-gallery
# 两种情况都要能认出来。
$PluginNames = @('sillytavern-visual-worldbook', 'worldbook-gallery')
$SourceDir   = $PSScriptRoot

function Find-InstalledDir {
    param([string]$ThirdPartyPath)
    foreach ($n in $PluginNames) {
        $p = Join-Path $ThirdPartyPath $n
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Find-TavernRoot {
    param([string]$Hint)

    if ($Hint) {
        if (Test-Path $Hint) { return (Resolve-Path $Hint).Path }
        Write-Host "指定的酒馆目录不存在：$Hint" -ForegroundColor Red
        return $null
    }

    # 常见位置挨个试一遍
    $candidates = @()

    # 从本脚本所在位置往上找（插件装在酒馆里时，这就是最快的路径）
    $walk = $SourceDir
    for ($i = 0; $i -lt 8; $i++) {
        $walk = Split-Path $walk -Parent
        if (-not $walk) { break }
        $candidates += $walk
    }

    # 几个常见盘符下的 SillyTavern
    foreach ($drive in @('C:', 'D:', 'E:', 'F:', 'G:')) {
        $base = "$drive\"
        if (-not (Test-Path $base)) { continue }
        Get-ChildItem $base -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like '*SillyTavern*' } |
            ForEach-Object { $candidates += $_.FullName }
    }

    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c 'public\scripts\extensions')) { return $c }
    }
    return $null
}

$TavernRoot = Find-TavernRoot -Hint $TavernRoot
$ThirdParty = if ($TavernRoot) { Join-Path $TavernRoot 'public\scripts\extensions\third-party' } else { $null }
# 手动安装用本文件夹原名；已经装过的话，按实际存在的那个名字走
$ManualName = 'worldbook-gallery'
$InstalledDir = if ($ThirdParty) { Find-InstalledDir -ThirdPartyPath $ThirdParty } else { $null }
$TargetDir = if ($ThirdParty) { Join-Path $ThirdParty $ManualName } else { $null }

function Write-Head($text) {
    Write-Host ''
    Write-Host "==== $text ====" -ForegroundColor Cyan
}

function Assert-TavernRoot {
    if (-not $TavernRoot) {
        Write-Host '没有自动找到酒馆目录。' -ForegroundColor Red
        Write-Host '请手动指定，例如：' -ForegroundColor Yellow
        Write-Host '  .\install.ps1 -Action install -TavernRoot "D:\SillyTavern"' -ForegroundColor Yellow
        exit 1
    }
    if (-not (Test-Path $ThirdParty)) {
        Write-Host "这个目录下没有 third-party 文件夹：$ThirdParty" -ForegroundColor Red
        Write-Host '通常是酒馆版本太老，或者指错了目录。' -ForegroundColor Yellow
        exit 1
    }
}

switch ($Action) {

    'status' {
        Write-Head '检查安装状态'
        Write-Host "插件源目录：$SourceDir"
        Write-Host "酒馆目录  ：$TavernRoot"
        Write-Host ''
        if ($InstalledDir) {
            $files = Get-ChildItem $InstalledDir -Recurse -File -Exclude '.git'
            Write-Host "状态：已安装" -ForegroundColor Green
            Write-Host "位置：$InstalledDir"
            Write-Host "文件：$($files.Count) 个"
        }
        else {
            Write-Host "状态：未安装" -ForegroundColor Yellow
            Write-Host "（酒馆的 third-party 里没有找到这个扩展）"
        }
    }

    'install' {
        Write-Head '安装世界书卡面管理'
        Assert-TavernRoot

        # 已经装过了（用 Git URL 装的那种）就别重复装
        if ($InstalledDir) {
            Write-Host "这个扩展已经装过了：$InstalledDir" -ForegroundColor Yellow
            Write-Host ''
            Write-Host '如果你是用酒馆的「从 Git URL 安装」，那就不需要再跑这个脚本了，' -ForegroundColor Cyan
            Write-Host '直接在酒馆的扩展管理里点「更新」即可。'
            exit 0
        }

        if (Test-Path $TargetDir) {
            Write-Host "目标位置已经有同名文件夹了：$TargetDir" -ForegroundColor Yellow
            $ans = Read-Host '要覆盖它吗？(输入 yes 覆盖，其它任意键取消)'
            if ($ans -ne 'yes') {
                Write-Host '已取消，什么都没动。' -ForegroundColor Yellow
                exit 0
            }
            # 先备份旧的，避免误覆盖用户自己改过的版本
            $stamp  = Get-Date -Format 'yyyyMMdd_HHmmss'
            $backup = Join-Path $SourceDir "_backup_$stamp"
            Move-Item $TargetDir $backup
            Write-Host "旧版本已挪到备份：$backup" -ForegroundColor Green
        }

        New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null

        # 只拷插件本体，跳过自检脚本和备份目录
        $exclude = @('_selftest.mjs', 'install.ps1')
        Get-ChildItem $SourceDir -File | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
            Copy-Item $_.FullName -Destination $TargetDir -Force
        }
        Get-ChildItem $SourceDir -Directory | Where-Object { $_.Name -notlike '_backup_*' } | ForEach-Object {
            Copy-Item $_.FullName -Destination $TargetDir -Recurse -Force
        }

        Write-Host '安装完成。' -ForegroundColor Green
        Write-Host ''
        Write-Host '下一步：' -ForegroundColor Cyan
        Write-Host '  1. 刷新酒馆页面（或重启酒馆）'
        Write-Host '  2. 点右上角的插头按钮打开扩展设置'
        Write-Host '  3. 找到「世界书卡面管理」，点「打开卡面面板」'
    }

    'uninstall' {
        Write-Head '卸载世界书卡面管理'

        $victim = if ($InstalledDir) { $InstalledDir } else { $TargetDir }

        if (-not (Test-Path $victim)) {
            Write-Host "酒馆里本来就没有这个插件" -ForegroundColor Yellow
            Write-Host '不需要做任何事。' -ForegroundColor Green
            exit 0
        }

        Write-Host "将删除：$victim" -ForegroundColor Yellow
        Write-Host '（只删这一个文件夹，酒馆其它内容和你所有的卡、世界书都不受影响）'
        $ans = Read-Host '确认删除？(输入 yes 继续，其它任意键取消)'
        if ($ans -ne 'yes') {
            Write-Host '已取消，什么都没动。' -ForegroundColor Yellow
            exit 0
        }

        Remove-Item $victim -Recurse -Force
        Write-Host '已删除。刷新酒馆页面即可。' -ForegroundColor Green
        Write-Host '如果还想用，随时重新跑一次 install。'
    }
}
