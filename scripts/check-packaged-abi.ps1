Param(
  [string[]]$Targets = @(''win32-x64'')
)

Write-Output "Packaged ABI verification targets: $($Targets -join ', ')"
Write-Output 'TODO: add packaged smoke checks after app packaging is wired.'
