<#
.SYNOPSIS
    Game Access Torrent Plugin Installer with Source Selection Wizard.
.DESCRIPTION
    Self-contained installer for Game Access Torrent Source Provider.
    - Detects if Game Access is installed (required).
    - Asks user if they want to auto-add existent sources with a table (online-fix, steamrip, etc.), all unselected by default.
    - Supports selecting one by one, "All", and "None".
    - Copies self-contained plugin with all dependencies into the plugins folder and configures sources.
#>

[CmdletBinding()]
param(
    [string]$TargetPluginsFolder,
    [string[]]$PreselectedSources
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# Known Community Sources catalog
$KnownSources = @(
    [PSCustomObject]@{ Id = "onlinefix"; Name = "Online-Fix"; Url = "https://hydralinks.cloud/sources/onlinefix.json"; Type = "Online Fixes / Torrent"; Description = "Multiplayer fixes & online co-op releases" },
    [PSCustomObject]@{ Id = "steamrip"; Name = "SteamRIP"; Url = "https://hydralinks.cloud/sources/steamrip.json"; Type = "Direct Download"; Description = "Pre-installed games with direct downloads" },
    [PSCustomObject]@{ Id = "steamgg"; Name = "SteamGG"; Url = "https://wkeynhk.online/steamgg.json"; Type = "Direct Download"; Description = "Clean Steam files & pre-installed releases" },
    [PSCustomObject]@{ Id = "gog"; Name = "GOG Games"; Url = "https://hydralinks.cloud/sources/gog.json"; Type = "DRM-Free / Direct"; Description = "DRM-free GOG installers & extras" },
    [PSCustomObject]@{ Id = "fitgirl"; Name = "FitGirl Repacks"; Url = "https://hydralinks.cloud/sources/fitgirl.json"; Type = "Repack / Torrent"; Description = "Lossless ultra-compressed repacks" },
    [PSCustomObject]@{ Id = "dodi"; Name = "DODI Repacks"; Url = "https://hydralinks.cloud/sources/dodi.json"; Type = "Repack / Torrent"; Description = "Fast compressed repacks" },
    [PSCustomObject]@{ Id = "kaoskrew"; Name = "KaOs Krew"; Url = "https://hydralinks.cloud/sources/kaoskrew.json"; Type = "Repack / Torrent"; Description = "Lossless compact game releases" },
    [PSCustomObject]@{ Id = "xatab"; Name = "Xatab Repacks"; Url = "https://hydralinks.cloud/sources/xatab.json"; Type = "Repack / Torrent"; Description = "Classic gaming repack catalog" },
    [PSCustomObject]@{ Id = "tinyrepacks"; Name = "Tiny Repacks"; Url = "https://hydralinks.cloud/sources/tinyrepacks.json"; Type = "Repack / Direct"; Description = "Minimal size repacks" },
    [PSCustomObject]@{ Id = "empress"; Name = "Empress"; Url = "https://hydralinks.cloud/sources/empress.json"; Type = "Torrent"; Description = "Denuvo releases catalog" },
    [PSCustomObject]@{ Id = "anadius"; Name = "Anadius"; Url = "https://hydralinks.cloud/sources/anadius.json"; Type = "Direct Download"; Description = "Sims 4 tools & game content" }
)

function Detect-GameAccess {
    $appData = [Environment]::GetFolderPath('ApplicationData')
    $appDataPlugins = Join-Path $appData "GameAccess\plugins"

    # 1. Check running process
    $procs = Get-Process -Name 'GameAccess-latest', 'gameaccess-desktop', 'gameAccess', 'GameAccess' -ErrorAction SilentlyContinue
    if ($procs) {
        foreach ($p in $procs) {
            try {
                $exePath = $p.Path
                if ($exePath -and (Test-Path $exePath)) {
                    $dir = Split-Path -Parent $exePath
                    return [PSCustomObject]@{
                        IsInstalled = $true
                        InstallPath = $dir
                        PluginsPath = (Join-Path $dir "plugins")
                        AppDataPlugins = $appDataPlugins
                        Message = "Game Access detectado (en ejecucion): $exePath"
                    }
                }
            } catch {}
        }
    }

    # 2. Check Candidate Directories
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\gameAccess",
        "$env:LOCALAPPDATA\Programs\GameAccess",
        "$env:LOCALAPPDATA\gameAccess",
        "$env:ProgramFiles\gameAccess",
        "$env:ProgramFiles\GameAccess",
        "${env:ProgramFiles(x86)}\gameAccess",
        "${env:ProgramFiles(x86)}\GameAccess",
        "C:\DEV\Game Access Dev"
    )

    foreach ($cand in $candidates) {
        if (Test-Path $cand) {
            $signatures = @("GameAccess-latest.exe", "gameaccess-desktop.exe", "gameAccess.exe", "tauri.conf.json", "apps\desktop\src-tauri\tauri.conf.json")
            foreach ($sig in $signatures) {
                if (Test-Path (Join-Path $cand $sig)) {
                    return [PSCustomObject]@{
                        IsInstalled = $true
                        InstallPath = $cand
                        PluginsPath = (Join-Path $cand "plugins")
                        AppDataPlugins = $appDataPlugins
                        Message = "Game Access detectado en: $cand"
                    }
                }
            }
        }
    }

    # 3. Check AppData user data
    $userGa = Join-Path $appData "GameAccess"
    if (Test-Path $userGa) {
        return [PSCustomObject]@{
            IsInstalled = $true
            InstallPath = $userGa
            PluginsPath = (Join-Path $userGa "plugins")
            AppDataPlugins = $appDataPlugins
            Message = "Game Access detectado por datos de usuario en: $userGa"
        }
    }

    return [PSCustomObject]@{
        IsInstalled = $false
        InstallPath = $null
        PluginsPath = $appDataPlugins
        AppDataPlugins = $appDataPlugins
        Message = "Game Access no se encuentra instalado en este equipo."
    }
}

# WinForms GUI Wizard
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = "Game Access - Instalador de Plugin de Fuentes"
$form.Size = New-Object System.Drawing.Size(820, 620)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 28)
$form.ForeColor = [System.Drawing.Color]::FromArgb(240, 240, 245)

# Header
$header = New-Object System.Windows.Forms.Panel
$header.Dock = "Top"
$header.Height = 85
$header.BackColor = [System.Drawing.Color]::FromArgb(32, 32, 38)
$form.Controls.Add($header)

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = "Game Access - Instalador del Plugin Torrent Provider"
$titleLabel.Font = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Bold)
$titleLabel.ForeColor = [System.Drawing.Color]::White
$titleLabel.AutoSize = $true
$titleLabel.Location = New-Object System.Drawing.Point(24, 16)
$header.Controls.Add($titleLabel)

$subLabel = New-Object System.Windows.Forms.Label
$subLabel.Text = "Paso 1: Verificacion de requisitos"
$subLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9.5)
$subLabel.ForeColor = [System.Drawing.Color]::FromArgb(160, 160, 175)
$subLabel.AutoSize = $true
$subLabel.Location = New-Object System.Drawing.Point(24, 48)
$header.Controls.Add($subLabel)

# Footer
$footer = New-Object System.Windows.Forms.Panel
$footer.Dock = "Bottom"
$footer.Height = 65
$footer.BackColor = [System.Drawing.Color]::FromArgb(28, 28, 34)
$form.Controls.Add($footer)

$cancelBtn = New-Object System.Windows.Forms.Button
$cancelBtn.Text = "Cancelar"
$cancelBtn.Size = New-Object System.Drawing.Size(100, 34)
$cancelBtn.Location = New-Object System.Drawing.Point(24, 15)
$cancelBtn.FlatStyle = "Flat"
$cancelBtn.FlatAppearance.BorderSize = 0
$cancelBtn.BackColor = [System.Drawing.Color]::FromArgb(45, 45, 55)
$cancelBtn.ForeColor = [System.Drawing.Color]::FromArgb(200, 200, 210)
$cancelBtn.Add_Click({ $form.Close() })
$footer.Controls.Add($cancelBtn)

$backBtn = New-Object System.Windows.Forms.Button
$backBtn.Text = "< Anterior"
$backBtn.Size = New-Object System.Drawing.Size(105, 34)
$backBtn.Location = New-Object System.Drawing.Point(570, 15)
$backBtn.FlatStyle = "Flat"
$backBtn.FlatAppearance.BorderSize = 0
$backBtn.BackColor = [System.Drawing.Color]::FromArgb(45, 45, 55)
$backBtn.ForeColor = [System.Drawing.Color]::FromArgb(220, 220, 230)
$backBtn.Visible = $false
$footer.Controls.Add($backBtn)

$nextBtn = New-Object System.Windows.Forms.Button
$nextBtn.Text = "Siguiente >"
$nextBtn.Size = New-Object System.Drawing.Size(115, 34)
$nextBtn.Location = New-Object System.Drawing.Point(685, 15)
$nextBtn.FlatStyle = "Flat"
$nextBtn.FlatAppearance.BorderSize = 0
$nextBtn.BackColor = [System.Drawing.Color]::FromArgb(59, 130, 246)
$nextBtn.ForeColor = [System.Drawing.Color]::White
$footer.Controls.Add($nextBtn)

# Body panels
$bodyPanel = New-Object System.Windows.Forms.Panel
$bodyPanel.Dock = "Fill"
$bodyPanel.Padding = New-Object System.Windows.Forms.Padding(24, 16, 24, 16)
$form.Controls.Add($bodyPanel)

# Step 1: Detection
$step1 = New-Object System.Windows.Forms.Panel
$step1.Dock = "Fill"
$bodyPanel.Controls.Add($step1)

$step1Title = New-Object System.Windows.Forms.Label
$step1Title.Text = "Deteccion de Game Access"
$step1Title.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
$step1Title.ForeColor = [System.Drawing.Color]::White
$step1Title.Location = New-Object System.Drawing.Point(12, 12)
$step1Title.AutoSize = $true
$step1.Controls.Add($step1Title)

$step1Desc = New-Object System.Windows.Forms.Label
$step1Desc.Text = "Este plugin requiere que Game Access este instalado en el sistema para poder registrarse y activarse automaticamente."
$step1Desc.Font = New-Object System.Drawing.Font("Segoe UI", 9.5)
$step1Desc.ForeColor = [System.Drawing.Color]::FromArgb(180, 180, 195)
$step1Desc.Location = New-Object System.Drawing.Point(12, 45)
$step1Desc.Size = New-Object System.Drawing.Size(740, 40)
$step1.Controls.Add($step1Desc)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10.5, [System.Drawing.FontStyle]::Bold)
$statusLabel.Location = New-Object System.Drawing.Point(12, 100)
$statusLabel.Size = New-Object System.Drawing.Size(740, 28)
$step1.Controls.Add($statusLabel)

$pathLabel = New-Object System.Windows.Forms.Label
$pathLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9.5)
$pathLabel.ForeColor = [System.Drawing.Color]::FromArgb(170, 170, 185)
$pathLabel.Location = New-Object System.Drawing.Point(12, 135)
$pathLabel.Size = New-Object System.Drawing.Size(740, 45)
$step1.Controls.Add($pathLabel)

$browseBtn = New-Object System.Windows.Forms.Button
$browseBtn.Text = "Examinar carpeta de Game Access..."
$browseBtn.Size = New-Object System.Drawing.Size(240, 34)
$browseBtn.Location = New-Object System.Drawing.Point(12, 195)
$browseBtn.FlatStyle = "Flat"
$browseBtn.FlatAppearance.BorderSize = 0
$browseBtn.BackColor = [System.Drawing.Color]::FromArgb(45, 45, 55)
$browseBtn.ForeColor = [System.Drawing.Color]::FromArgb(220, 220, 230)
$step1.Controls.Add($browseBtn)

$noticeLabel = New-Object System.Windows.Forms.Label
$noticeLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9.5, [System.Drawing.FontStyle]::Italic)
$noticeLabel.ForeColor = [System.Drawing.Color]::FromArgb(239, 68, 68)
$noticeLabel.Location = New-Object System.Drawing.Point(12, 245)
$noticeLabel.Size = New-Object System.Drawing.Size(740, 50)
$step1.Controls.Add($noticeLabel)

# Step 2: Sources Selection
$step2 = New-Object System.Windows.Forms.Panel
$step2.Dock = "Fill"
$step2.Visible = $false
$bodyPanel.Controls.Add($step2)

$srcPrompt = New-Object System.Windows.Forms.Label
$srcPrompt.Text = "Deseas agregar fuentes existentes automaticamente?`nSelecciona las fuentes que deseas configurar (todas desmarcadas por defecto):"
$srcPrompt.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$srcPrompt.ForeColor = [System.Drawing.Color]::White
$srcPrompt.Location = New-Object System.Drawing.Point(12, 8)
$srcPrompt.Size = New-Object System.Drawing.Size(740, 40)
$step2.Controls.Add($srcPrompt)

$allBtn = New-Object System.Windows.Forms.Button
$allBtn.Text = "Marcar todas (All)"
$allBtn.Size = New-Object System.Drawing.Size(140, 30)
$allBtn.Location = New-Object System.Drawing.Point(12, 55)
$allBtn.FlatStyle = "Flat"
$allBtn.FlatAppearance.BorderSize = 0
$allBtn.BackColor = [System.Drawing.Color]::FromArgb(45, 45, 55)
$allBtn.ForeColor = [System.Drawing.Color]::FromArgb(220, 220, 230)
$step2.Controls.Add($allBtn)

$noneBtn = New-Object System.Windows.Forms.Button
$noneBtn.Text = "Desmarcar todas (None)"
$noneBtn.Size = New-Object System.Drawing.Size(160, 30)
$noneBtn.Location = New-Object System.Drawing.Point(160, 55)
$noneBtn.FlatStyle = "Flat"
$noneBtn.FlatAppearance.BorderSize = 0
$noneBtn.BackColor = [System.Drawing.Color]::FromArgb(45, 45, 55)
$noneBtn.ForeColor = [System.Drawing.Color]::FromArgb(220, 220, 230)
$step2.Controls.Add($noneBtn)

$countLabel = New-Object System.Windows.Forms.Label
$countLabel.Text = "Fuentes seleccionadas: 0 de $($KnownSources.Count)"
$countLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9.5)
$countLabel.ForeColor = [System.Drawing.Color]::FromArgb(160, 160, 180)
$countLabel.Location = New-Object System.Drawing.Point(480, 60)
$countLabel.Size = New-Object System.Drawing.Size(270, 24)
$countLabel.TextAlign = "TopRight"
$step2.Controls.Add($countLabel)

$grid = New-Object System.Windows.Forms.DataGridView
$grid.Location = New-Object System.Drawing.Point(12, 95)
$grid.Size = New-Object System.Drawing.Size(745, 300)
$grid.BackgroundColor = [System.Drawing.Color]::FromArgb(32, 32, 38)
$grid.BorderStyle = "None"
$grid.RowHeadersVisible = $false
$grid.AllowUserToAddRows = $false
$grid.AllowUserToDeleteRows = $false
$grid.AllowUserToResizeRows = $false
$grid.SelectionMode = "FullRowSelect"
$grid.MultiSelect = $false
$grid.EnableHeadersVisualStyles = $false
$grid.GridColor = [System.Drawing.Color]::FromArgb(45, 45, 55)
$grid.ColumnHeadersDefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(40, 40, 48)
$grid.ColumnHeadersDefaultCellStyle.ForeColor = [System.Drawing.Color]::White
$grid.ColumnHeadersDefaultCellStyle.Font = New-Object System.Drawing.Font("Segoe UI", 9.5, [System.Drawing.FontStyle]::Bold)
$grid.ColumnHeadersHeight = 32
$grid.DefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(28, 28, 34)
$grid.DefaultCellStyle.ForeColor = [System.Drawing.Color]::FromArgb(230, 230, 240)
$grid.DefaultCellStyle.SelectionBackColor = [System.Drawing.Color]::FromArgb(48, 56, 75)
$grid.DefaultCellStyle.SelectionForeColor = [System.Drawing.Color]::White
$grid.DefaultCellStyle.Font = New-Object System.Drawing.Font("Segoe UI", 9.5)
$grid.RowTemplate.Height = 28

$colCheck = New-Object System.Windows.Forms.DataGridViewCheckBoxColumn
$colCheck.Name = "Select"
$colCheck.HeaderText = "Incluir"
$colCheck.Width = 60
$colCheck.FalseValue = $false
$colCheck.TrueValue = $true

$colName = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
$colName.Name = "Name"
$colName.HeaderText = "Fuente"
$colName.Width = 140
$colName.ReadOnly = $true

$colType = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
$colType.Name = "Type"
$colType.HeaderText = "Tipo"
$colType.Width = 160
$colType.ReadOnly = $true

$colDesc = New-Object System.Windows.Forms.DataGridViewTextBoxColumn
$colDesc.Name = "Desc"
$colDesc.HeaderText = "Descripcion"
$colDesc.Width = 360
$colDesc.ReadOnly = $true

$grid.Columns.AddRange($colCheck, $colName, $colType, $colDesc)
$step2.Controls.Add($grid)

# Populate grid (all unselected by default)
foreach ($s in $KnownSources) {
    [void]$grid.Rows.Add($false, $s.Name, $s.Type, $s.Description)
}

function Update-Count {
    $sel = 0
    for ($i = 0; $i -lt $grid.Rows.Count; $i++) {
        if ($grid.Rows[$i].Cells[0].Value -eq $true) { $sel++ }
    }
    $countLabel.Text = "Fuentes seleccionadas: $sel de $($grid.Rows.Count)"
}

$grid.Add_CellValueChanged({ Update-Count })
$grid.Add_CurrentCellDirtyStateChanged({
    if ($grid.IsCurrentCellDirty) { $grid.CommitEdit([System.Windows.Forms.DataGridViewDataErrorContexts]::Commit) }
})

$allBtn.Add_Click({
    for ($i = 0; $i -lt $grid.Rows.Count; $i++) { $grid.Rows[$i].Cells[0].Value = $true }
    Update-Count
})
$noneBtn.Add_Click({
    for ($i = 0; $i -lt $grid.Rows.Count; $i++) { $grid.Rows[$i].Cells[0].Value = $false }
    Update-Count
})

# Step 3: Progress
$step3 = New-Object System.Windows.Forms.Panel
$step3.Dock = "Fill"
$step3.Visible = $false
$bodyPanel.Controls.Add($step3)

$step3Title = New-Object System.Windows.Forms.Label
$step3Title.Text = "Instalando plugin y dependencias..."
$step3Title.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
$step3Title.ForeColor = [System.Drawing.Color]::White
$step3Title.Location = New-Object System.Drawing.Point(12, 24)
$step3Title.AutoSize = $true
$step3.Controls.Add($step3Title)

$progressStatus = New-Object System.Windows.Forms.Label
$progressStatus.Text = "Preparando archivos..."
$progressStatus.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$progressStatus.ForeColor = [System.Drawing.Color]::FromArgb(200, 200, 215)
$progressStatus.Location = New-Object System.Drawing.Point(12, 70)
$progressStatus.Size = New-Object System.Drawing.Size(740, 25)
$step3.Controls.Add($progressStatus)

$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Location = New-Object System.Drawing.Point(12, 110)
$progressBar.Size = New-Object System.Drawing.Size(740, 26)
$progressBar.Minimum = 0
$progressBar.Maximum = 100
$step3.Controls.Add($progressBar)

$progressDetail = New-Object System.Windows.Forms.Label
$progressDetail.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$progressDetail.ForeColor = [System.Drawing.Color]::FromArgb(150, 150, 165)
$progressDetail.Location = New-Object System.Drawing.Point(12, 150)
$progressDetail.Size = New-Object System.Drawing.Size(740, 60)
$step3.Controls.Add($progressDetail)

# Step 4: Finish
$step4 = New-Object System.Windows.Forms.Panel
$step4.Dock = "Fill"
$step4.Visible = $false
$bodyPanel.Controls.Add($step4)

$finishTitle = New-Object System.Windows.Forms.Label
$finishTitle.Text = "Instalacion completada exitosamente!"
$finishTitle.Font = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Bold)
$finishTitle.ForeColor = [System.Drawing.Color]::FromArgb(34, 197, 94)
$finishTitle.Location = New-Object System.Drawing.Point(12, 20)
$finishTitle.Size = New-Object System.Drawing.Size(740, 35)
$step4.Controls.Add($finishTitle)

$finishSummary = New-Object System.Windows.Forms.Label
$finishSummary.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$finishSummary.ForeColor = [System.Drawing.Color]::FromArgb(210, 210, 225)
$finishSummary.Location = New-Object System.Drawing.Point(12, 70)
$finishSummary.Size = New-Object System.Drawing.Size(740, 150)
$step4.Controls.Add($finishSummary)

$launchCheck = New-Object System.Windows.Forms.CheckBox
$launchCheck.Text = "Iniciar el plugin de fuentes ahora"
$launchCheck.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$launchCheck.ForeColor = [System.Drawing.Color]::White
$launchCheck.Checked = $true
$launchCheck.Location = New-Object System.Drawing.Point(12, 240)
$launchCheck.Size = New-Object System.Drawing.Size(400, 30)
$step4.Controls.Add($launchCheck)

# Detection state
$detection = Detect-GameAccess
if ($detection.IsInstalled) {
    $statusLabel.Text = "[OK] " + $detection.Message
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(34, 197, 94)
    $pathLabel.Text = "Ubicacion detectada: $($detection.InstallPath)`nCarpeta destino plugins: $($detection.PluginsPath)"
    $noticeLabel.Text = ""
    $nextBtn.Enabled = $true
} else {
    $statusLabel.Text = "[!] Game Access NO detectado"
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(239, 68, 68)
    $pathLabel.Text = "No se localizo la instalacion de Game Access en las rutas predeterminadas."
    $noticeLabel.Text = "ATENCION: Se requiere tener Game Access instalado previamente. Si tienes Game Access en otra carpeta, usa 'Examinar' para seleccionarla."
    $nextBtn.Enabled = $false
}

$browseBtn.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = "Selecciona la carpeta donde esta instalado Game Access:"
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $chosen = $dlg.SelectedPath
        $detection.IsInstalled = $true
        $detection.InstallPath = $chosen
        $detection.PluginsPath = (Join-Path $chosen "plugins")
        $statusLabel.Text = "[OK] Game Access seleccionado: $chosen"
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(34, 197, 94)
        $pathLabel.Text = "Ubicacion: $chosen`nCarpeta de plugins: $($detection.PluginsPath)"
        $noticeLabel.Text = ""
        $nextBtn.Enabled = $true
    }
})

$currentStep = 1
function Set-Step($step) {
    $script:currentStep = $step
    $step1.Visible = ($step -eq 1)
    $step2.Visible = ($step -eq 2)
    $step3.Visible = ($step -eq 3)
    $step4.Visible = ($step -eq 4)

    $backBtn.Visible = ($step -eq 2)
    $cancelBtn.Visible = ($step -le 2)

    if ($step -eq 1) {
        $subLabel.Text = "Paso 1: Deteccion y verificacion de Game Access"
        $nextBtn.Text = "Siguiente >"
        $nextBtn.Enabled = $detection.IsInstalled
    } elseif ($step -eq 2) {
        $subLabel.Text = "Paso 2: Seleccion de fuentes comunitarias"
        $nextBtn.Text = "Instalar >"
        $nextBtn.Enabled = $true
    } elseif ($step -eq 3) {
        $subLabel.Text = "Paso 3: Instalando plugin y dependencias..."
        $nextBtn.Enabled = $false
    } elseif ($step -eq 4) {
        $subLabel.Text = "Paso 4: Instalacion completada"
        $nextBtn.Text = "Finalizar"
        $nextBtn.Enabled = $true
    }
}

$backBtn.Add_Click({
    if ($script:currentStep -eq 2) { Set-Step 1 }
})

$nextBtn.Add_Click({
    if ($script:currentStep -eq 1) {
        if ($detection.IsInstalled) { Set-Step 2 }
    } elseif ($script:currentStep -eq 2) {
        Set-Step 3
        Install-PluginWork
    } elseif ($script:currentStep -eq 4) {
        if ($launchCheck.Checked) {
            $targetDir = Join-Path $detection.PluginsPath "ga-torrent-provider"
            $exe = Join-Path $targetDir "Game Access Torrent Provider.exe"
            if (Test-Path $exe) {
                Start-Process -FilePath $exe -WorkingDirectory $targetDir
            }
        }
        $form.Close()
    }
})

function Install-PluginWork {
    $selectedUrls = @()
    for ($i = 0; $i -lt $grid.Rows.Count; $i++) {
        if ($grid.Rows[$i].Cells[0].Value -eq $true) {
            $selectedUrls += $KnownSources[$i].Url
        }
    }

    $targetDir = Join-Path $detection.PluginsPath "ga-torrent-provider"
    $appDataDir = $detection.AppDataPlugins

    $progressBar.Value = 10
    $progressStatus.Text = "Creando directorios..."
    $progressDetail.Text = "Destino: $targetDir"
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    New-Item -ItemType Directory -Path $appDataDir -Force | Out-Null
    [System.Windows.Forms.Application]::DoEvents()

    $progressBar.Value = 30
    $progressStatus.Text = "Copiando plugin auto-contenido y dependencias..."
    
    # Locate package files
    $unpacked = "C:\DEV\ga-torrent-plugin\dist\win-unpacked"
    $localZip = Join-Path $PSScriptRoot "plugin-payload.zip"
    $parentZip = Join-Path $root "tools/plugin-installer/plugin-payload.zip"

    if (Test-Path $localZip) {
        $progressDetail.Text = "Extrayendo $localZip..."
        [System.IO.Compression.ZipFile]::ExtractToDirectory($localZip, $targetDir, $true)
    } elseif (Test-Path $parentZip) {
        $progressDetail.Text = "Extrayendo $parentZip..."
        [System.IO.Compression.ZipFile]::ExtractToDirectory($parentZip, $targetDir, $true)
    } elseif (Test-Path $unpacked) {
        $progressDetail.Text = "Copiando binarios desde $unpacked..."
        Copy-Item -Path "$unpacked\*" -Destination $targetDir -Recurse -Force
    } else {
        [System.Windows.Forms.MessageBox]::Show($form, "No se encontro el paquete con las dependencias del plugin.", "Error", "OK", "Error")
        Set-Step 2
        return
    }

    $progressBar.Value = 75
    $progressStatus.Text = "Configurando fuentes seleccionadas..."
    $progressDetail.Text = "$($selectedUrls.Count) fuentes activas."

    # Write sources_config.json
    $cfgJson = @{ sourceUrls = $selectedUrls } | ConvertTo-Json -Depth 5
    Set-Content -LiteralPath (Join-Path $targetDir "sources_config.json") -Value $cfgJson -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $appDataDir "sources_config.json") -Value $cfgJson -Encoding UTF8

    $progressBar.Value = 88
    $progressStatus.Text = "Registrando plugin con Game Access..."
    $manifest = @{
        id = "ga-torrent-provider"
        name = "Torrent Source Provider"
        type = "source_provider"
        endpoint = "http://127.0.0.1:45000"
        executable = "Game Access Torrent Provider.exe"
        autostart = $true
    } | ConvertTo-Json -Depth 5

    Set-Content -LiteralPath (Join-Path $targetDir "torrent_provider.json") -Value $manifest -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $appDataDir "torrent_provider.json") -Value $manifest -Encoding UTF8

    $progressBar.Value = 95
    $progressStatus.Text = "Configurando perfiles de ejecucion..."
    $execProfilePath = Join-Path $appDataDir "execution-profiles.json"
    if (-not (Test-Path $execProfilePath)) {
        $profile = @{
            games = @{}
            sources = @{}
            default = @{
                version = 1
                name = "Perfil opcional"
                id = "provider-default"
                archivePasswords = @("online-fix.me")
                beforePlay = @(
                    @{
                        type = "ini-set"
                        glob = "OnlineFix.ini"
                        section = "Hashes"
                        key = "1337"
                        value = "defa34f9d4e76c16eeb47f057f337934d4e47da373fd5dced397e2db05370865c9a75a0314d14d7fc15f1da4cab85f769ea958825210af06be6c4e253abeaf73"
                    }
                )
            }
        } | ConvertTo-Json -Depth 6
        Set-Content -LiteralPath $execProfilePath -Value $profile -Encoding UTF8
        Set-Content -LiteralPath (Join-Path $targetDir "execution-profiles.json") -Value $profile -Encoding UTF8
    }

    $progressBar.Value = 100
    $progressStatus.Text = "Instalacion completada!"
    
    $finishSummary.Text = "El plugin ha sido instalado satisfactoriamente con todas sus dependencias.`n`n" +
        "• Carpeta del plugin: $targetDir`n" +
        "• Fuentes comunitarias configuradas: $($selectedUrls.Count)`n" +
        "• Integracion automatica: Activa en Game Access`n`n" +
        "Cuando Game Access inicie, el plugin se ejecutara automaticamente."

    Set-Step 4
}

[void]$form.ShowDialog()
