param(
  [Parameter(Mandatory = $true)][string]$WsUrl,
  [Parameter(Mandatory = $true)][string]$Expression,
  [int]$TimeoutSec = 30
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Net.Http
# Use ClientWebSocket
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$cts = New-Object System.Threading.CancellationTokenSource
$cts.CancelAfter([TimeSpan]::FromSeconds($TimeoutSec))
$uri = [Uri]$WsUrl
$ws.ConnectAsync($uri, $cts.Token).GetAwaiter().GetResult()

function Send-Json($obj) {
  $json = ($obj | ConvertTo-Json -Compress -Depth 20)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $seg = New-Object System.ArraySegment[byte] -ArgumentList @(,$bytes)
  $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult() | Out-Null
}

function Recv-Json() {
  $buffer = New-Object byte[] 1048576
  $ms = New-Object System.IO.MemoryStream
  do {
    $seg = New-Object System.ArraySegment[byte] -ArgumentList @(,$buffer)
    $result = $ws.ReceiveAsync($seg, $cts.Token).GetAwaiter().GetResult()
    $ms.Write($buffer, 0, $result.Count)
  } while (-not $result.EndOfMessage)
  $text = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
  return ($text | ConvertFrom-Json)
}

Send-Json @{ id = 1; method = "Runtime.enable"; params = @{} }
# drain enable ack
$null = Recv-Json

Send-Json @{
  id = 2
  method = "Runtime.evaluate"
  params = @{
    expression = $Expression
    awaitPromise = $true
    returnByValue = $true
  }
}

$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
$final = $null
while ([DateTime]::UtcNow -lt $deadline) {
  $msg = Recv-Json
  if ($msg.id -eq 2) { $final = $msg; break }
}
$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", $cts.Token).GetAwaiter().GetResult() | Out-Null
if (-not $final) { throw "No evaluate result" }
if ($final.error) { throw ($final.error | ConvertTo-Json -Compress) }
$final.result | ConvertTo-Json -Depth 10
