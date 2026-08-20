param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$word = $null
$doc = $null

try {
  if (-not (Test-Path -LiteralPath $InputPath)) {
    throw "Word input not found: $InputPath"
  }

  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  # msoAutomationSecurityForceDisable — do not run macros
  $word.AutomationSecurity = 3

  $confirmConversions = $false
  $readOnly = $true
  $addToRecent = $false
  $doc = $word.Documents.Open($InputPath, $confirmConversions, $readOnly, $addToRecent)

  $wdExportFormatPDF = 17
  $wdExportOptimizeForPrint = 0
  $openAfter = $false
  if (Test-Path -LiteralPath $OutputPath) {
    Remove-Item -LiteralPath $OutputPath -Force
  }
  $doc.ExportAsFixedFormat($OutputPath, $wdExportFormatPDF, $openAfter, $wdExportOptimizeForPrint)
}
finally {
  if ($null -ne $doc) {
    try { $doc.Close($false) } catch { }
    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null } catch { }
  }
  if ($null -ne $word) {
    try { $word.Quit() } catch { }
    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch { }
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

if (-not (Test-Path -LiteralPath $OutputPath)) {
  throw 'Microsoft Word did not create a PDF'
}
