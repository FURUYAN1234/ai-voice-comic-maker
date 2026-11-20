[CmdletBinding()]
param(
    [ValidateSet('Menu','Start','Stop','Check','Update')]
    [string] $Action = 'Menu',
    [switch] $NoBrowser
)
$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'launcher.json') -Raw | ConvertFrom-Json
if ($config.id -notmatch '^[a-z0-9-]+$' -or $config.repo -notmatch '^FURUYAN1234/[a-zA-Z0-9-]+$') {
    throw 'Invalid application launcher identity.'
}
$installRoot = Join-Path $env:LOCALAPPDATA ("FURU Apps\" + $config.id)
$versionsRoot = Join-Path $installRoot 'versions'
$pointer = Join-Path $installRoot 'active.json'
$requestOptions = @{ TimeoutSec=30; Headers=@{ 'User-Agent'='FURU-App-Launcher'; 'Accept'='application/vnd.github+json' } }

function Read-Version([string] $AppRoot) {
    $manifest = Get-Content -LiteralPath (Join-Path $AppRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.name -ne $config.package -or $manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Application identity mismatch.' }
    return [version] $manifest.version
}

function Get-ActiveRoot {
    if (!(Test-Path -LiteralPath $pointer -PathType Leaf)) { return $sourceRoot }
    $record = Get-Content -LiteralPath $pointer -Raw | ConvertFrom-Json
    if ($record.app -ne $config.id -or $record.directory -notmatch '^v\d+\.\d+\.\d+-[0-9a-f]{40}$') { throw 'Invalid managed application pointer.' }
    $candidate = Join-Path $versionsRoot $record.directory
    $resolved = Get-Item -LiteralPath $candidate
    if (!$resolved.PSIsContainer -or ($resolved.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid managed application directory.' }
    if ((Read-Version $candidate).ToString() -ne $record.version) { throw 'Managed application version mismatch.' }
    return $candidate
}

function Get-Release {
    $api = 'https://api.github.com/repos/' + $config.repo
    $release = Invoke-RestMethod @requestOptions -Uri ($api + '/releases/latest')
    if ($release.draft -or $release.prerelease -or $release.tag_name -notmatch '^v(\d+\.\d+\.\d+)$') { throw 'A stable versioned release is unavailable.' }
    $advertisedVersion = [version] $Matches[1]
    $commit = Invoke-RestMethod @requestOptions -Uri ($api + '/commits/' + $release.tag_name)
    if ($commit.sha -notmatch '^[0-9a-f]{40}$') { throw 'GitHub did not return a release commit.' }
    return @{ Version=$advertisedVersion; Sha=$commit.sha; Archive=($api + '/zipball/' + $commit.sha) }
}

function Run-Npm([string] $AppRoot, [string[]] $Arguments) {
    Push-Location -LiteralPath $AppRoot
    try {
        & npm.cmd @Arguments
        if ($LASTEXITCODE -ne 0) { throw ('npm failed: ' + ($Arguments -join ' ')) }
    } finally { Pop-Location }
}

function Prepare-App([string] $AppRoot, [switch] $Fresh) {
    if ($Fresh -or !(Test-Path -LiteralPath (Join-Path $AppRoot 'node_modules\vite'))) { Run-Npm $AppRoot @('ci') }
    if ($Fresh -or !(Test-Path -LiteralPath (Join-Path $AppRoot 'mcp\node_modules\@modelcontextprotocol\server'))) { Run-Npm $AppRoot @('--prefix','mcp','ci') }
    Run-Npm $AppRoot @('run','build')
}

function Install-Release($Release) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $null = New-Item -ItemType Directory -Path $versionsRoot -Force
    $stage = Join-Path $installRoot ('stage-' + [Guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $stage
    $archive = Join-Path $stage 'source.zip'
    Invoke-WebRequest @requestOptions -UseBasicParsing -Uri $Release.Archive -OutFile $archive
    $target = Join-Path $stage 'source'
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $extractRoot = [IO.Path]::GetFullPath($target) + [IO.Path]::DirectorySeparatorChar
        foreach ($entry in $zip.Entries) {
            $entryName = $entry.FullName
            if ($entryName -match '[\\:]' -or $entryName.StartsWith('/') -or $entryName -match '(^|/)\.\.?(/|$)') { throw 'The release archive contains an unsafe path.' }
            $entryTarget = [IO.Path]::GetFullPath((Join-Path $target $entryName))
            if (!$entryTarget.StartsWith($extractRoot, [StringComparison]::OrdinalIgnoreCase) -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'The release archive contains an unsafe entry.' }
        }
    } finally { $zip.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($archive, $target)
    $sources = @(Get-ChildItem -LiteralPath $target -Directory)
    if ($sources.Count -ne 1) { throw 'The release archive must have one source directory.' }
    $newApp = $sources[0].FullName
    if ((Read-Version $newApp) -ne $Release.Version -or !(Test-Path -LiteralPath (Join-Path $newApp 'mcp\server.mjs') -PathType Leaf)) {
        throw 'The release source does not match the advertised application version and MCP entry.'
    }
    Prepare-App $newApp -Fresh
    $versionDirName = 'v' + $Release.Version + '-' + $Release.Sha
    $versionDir = Join-Path $versionsRoot $versionDirName
    if (Test-Path -LiteralPath $versionDir) { throw 'This version directory already exists. Inspect it before activating.' }
    Move-Item -LiteralPath $newApp -Destination $versionDir
    $record = @{ app=$config.id; directory=$versionDirName; version=$Release.Version.ToString(); commit=$Release.Sha }
    $temp = Join-Path $installRoot ('active-' + [Guid]::NewGuid().ToString('N') + '.json')
    [IO.File]::WriteAllText($temp, ($record | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    if (Test-Path -LiteralPath $pointer) { [IO.File]::Replace($temp, $pointer, (Join-Path $stage 'previous-active.json')) }
    else { [IO.File]::Move($temp, $pointer) }
    Write-Host ('Installed v' + $Release.Version + ' from ' + $Release.Sha)
}

if ($Action -eq 'Menu') {
    Write-Host ('FURU Apps - ' + $config.id)
    Write-Host '1) Start MCP and open the application'
    Write-Host '2) Check for an application update'
    Write-Host '3) Update the application'
    Write-Host '4) Stop the local MCP service'
    $Action = @{ '1'='Start'; '2'='Check'; '3'='Update'; '4'='Stop' }[(Read-Host 'Select 1-4')]
    if (!$Action) { exit 0 }
}

$appRoot = Get-ActiveRoot
$version = Read-Version $appRoot
if ($Action -in @('Check','Update')) {
    $latest = Get-Release
    Write-Host ('Installed v' + $version + ' / Latest v' + $latest.Version)
    if ($Action -eq 'Check' -or $latest.Version -le $version) { exit 0 }
    $answer = Read-Host ('Save any work in the local app. Install v' + $latest.Version + '? [y/N]')
    if ($answer -notmatch '^(y|yes)$') { exit 0 }
    Install-Release $latest
    Write-Host 'Use Stop and then Start when ready to switch the running local app to the new version.'
    exit 0
}
if ($Action -eq 'Start') {
    $speech = Join-Path $appRoot 'scripts\local-tts.mjs'
    if (Test-Path -LiteralPath $speech -PathType Leaf) {
        & node $speech --install
        if ($LASTEXITCODE -ne 0) { Write-Warning 'Supertonic is unavailable. Check supertonic.log or use VOICEVOX.' }
    }
}
$entry = Join-Path $appRoot 'mcp\server.mjs'
if ($Action -eq 'Stop') {
    & node.exe $entry --stop
    exit $LASTEXITCODE
}
if (!(Test-Path -LiteralPath (Join-Path $appRoot 'dist\furu-mcp-build.json') -PathType Leaf)) { Prepare-App $appRoot }
$appUrl = & node.exe $entry --launch
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($appUrl -notmatch '^http://127\.0\.0\.1:\d+/[a-zA-Z0-9/-]*$') { throw 'Invalid local app URL.' }
Write-Host $appUrl
if (!$NoBrowser) { Start-Process -FilePath $appUrl }
