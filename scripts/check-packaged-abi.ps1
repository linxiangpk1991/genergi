Param(
  [string[]]$Targets = @('web', 'api', 'worker')
)

$Errors = New-Object System.Collections.Generic.List[string]

function Assert-Exists {
  param(
    [string]$Path,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    $Errors.Add("$Label missing: $Path")
  }
}

Write-Output "Packaged ABI verification targets: $($Targets -join ', ')"

if ($Targets -contains 'web') {
  Assert-Exists -Path "apps/web/dist/index.html" -Label "Web entry"
  $webAsset = Get-ChildItem "apps/web/dist/assets" -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $webAsset) {
    $Errors.Add("Web assets missing under apps/web/dist/assets")
  }
}

if ($Targets -contains 'api') {
  Assert-Exists -Path "apps/api/dist/apps/api/src/index.js" -Label "API runtime entry"
}

if ($Targets -contains 'worker') {
  Assert-Exists -Path "apps/worker/dist/apps/worker/src/index.js" -Label "Worker runtime entry"
}

if ($Errors.Count -gt 0) {
  Write-Error ("Packaged ABI verification failed:`n - " + ($Errors -join "`n - "))
  exit 1
}

Write-Output "Packaged ABI verification passed."
