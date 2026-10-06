$ErrorActionPreference = 'Stop'
try {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
        $base.DeleteSubKey('Software\Google\Chrome\NativeMessagingHosts\com.shakesave.host', $false); $base.Dispose()
    }
    $root = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'ShakeSave'))
    if ((Split-Path -Leaf $root) -ne 'ShakeSave' -or (Split-Path -Parent $root) -ne [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\')) { throw 'Unexpected install path.' }
    # Only remove known helper files; never touch saved images or unknown files.
    if (Test-Path -LiteralPath $root) {
        if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to remove files through a symbolic link or junction.' }
        foreach ($file in Get-ChildItem -LiteralPath $root -File) {
            if ($file.Name -in @('ShakeSaveHost.exe', 'ShakeSaveHost.new.exe', 'host.json') -or $file.Name -cmatch '^folder-[a-p]{32}\.txt$') { Remove-Item -LiteralPath $file.FullName }
        }
    }
    Write-Host 'Unregistered and removed helper. Saved images were not removed.'
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
