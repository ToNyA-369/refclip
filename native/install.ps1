param([string]$ExtensionId)
$ErrorActionPreference = 'Stop'
try {
    $project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
    if (-not $ExtensionId) {
        $found = @()
        $profiles = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
        if (Test-Path -LiteralPath $profiles) {
            foreach ($profile in Get-ChildItem -LiteralPath $profiles -Directory) {
                foreach ($file in @('Preferences', 'Secure Preferences')) {
                    $prefsPath = Join-Path $profile.FullName $file
                    if (-not (Test-Path -LiteralPath $prefsPath)) { continue }
                    try {
                        $prefs = Get-Content -LiteralPath $prefsPath -Raw -Encoding UTF8 | ConvertFrom-Json
                        foreach ($ext in $prefs.extensions.settings.PSObject.Properties) {
                            if ($ext.Value.path -and [IO.Path]::IsPathRooted($ext.Value.path) -and [IO.Path]::GetFullPath($ext.Value.path).TrimEnd('\') -eq $project) { $found += $ext.Name }
                        }
                    } catch { }
                }
            }
        }
        $found = @($found | Select-Object -Unique)
        if ($found.Count -eq 1) { $ExtensionId = $found[0]; Write-Host "Detected extension ID: $ExtensionId" }
        else { $ExtensionId = Read-Host 'Paste extension ID from RefClip settings (32 letters)' }
    }
    if ($ExtensionId -cnotmatch '^[a-p]{32}$') { throw 'Invalid extension ID. Copy the ID from RefClip settings.' }
    $destination = Join-Path $env:LOCALAPPDATA 'ShakeSave'
    if ((Test-Path -LiteralPath $destination) -and ((Get-Item -LiteralPath $destination).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Install directory must not be a symbolic link or junction.' }
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
    if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.x compiler not found. Enable .NET Framework 4.8 in Windows.' }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    $stage = Join-Path $destination 'ShakeSaveHost.new.exe'
    & $compiler /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll /reference:System.Xml.dll "/out:$stage" (Join-Path $PSScriptRoot 'Host.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Compilation failed.' }
    $executable = Join-Path $destination 'ShakeSaveHost.exe'
    Move-Item -LiteralPath $stage -Destination $executable -Force
    $manifestPath = Join-Path $destination 'host.json'
    $origins = @("chrome-extension://$ExtensionId/")
    if (Test-Path -LiteralPath $manifestPath) {
        $old = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $origins += @($old.allowed_origins | Where-Object { $_ -cmatch '^chrome-extension://[a-p]{32}/$' })
    }
    $manifest = @{ name='com.shakesave.host'; description='RefClip image writer'; path=$executable; type='stdio'; allowed_origins=@($origins | Select-Object -Unique) } | ConvertTo-Json
    [IO.File]::WriteAllText($manifestPath, $manifest, (New-Object Text.UTF8Encoding($false)))
    # Register both registry views, including Chrome's first (32-bit) lookup.
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
        $key = $base.CreateSubKey('Software\Google\Chrome\NativeMessagingHosts\com.shakesave.host')
        $key.SetValue('', $manifestPath); $key.Dispose(); $base.Dispose()
    }
    Write-Host 'Installed. In RefClip settings, choose a folder and save Native mode.' -ForegroundColor Green
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
