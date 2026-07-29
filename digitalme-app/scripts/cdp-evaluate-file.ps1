param(
  [Parameter(Mandatory = $true)][string]$WsUrl,
  [Parameter(Mandatory = $true)][string]$ExpressionFile,
  [int]$TimeoutSec = 45
)

$ErrorActionPreference = "Stop"
$Expression = Get-Content -Raw -Path $ExpressionFile

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$cts = New-Object System.Threading.CancellationTokenSource
$cts.CancelAfter([TimeSpan]::FromSeconds($TimeoutSec))
$ws.ConnectAsync([Uri]$WsUrl, $cts.Token).GetAwaiter().GetResult()

function Send-Json($obj) {
  $json = ($obj | ConvertTo-Json -Compress -Depth 30)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $seg = New-Object System.ArraySegment[byte] -ArgumentList @(, $bytes)
  $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult() | Out-Null
}

function Recv-Json() {
  $buffer = New-Object byte[] 2097152
  $ms = New-Object System.IO.MemoryStream
  do {
    $seg = New-Object System.ArraySegment[byte] -ArgumentList @(, $buffer)
    $result = $ws.ReceiveAsync($seg, $cts.Token).GetAwaiter().GetResult()
    $ms.Write($buffer, 0, $result.Count)
  } while (-not $result.EndOfMessage)
  $text = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
  return ($text | ConvertFrom-Json)
}

Send-Json @{ id = 1; method = "Runtime.enable"; params = @{} }
$null = Recv-Json

# Build payload without ConvertTo-Json mangling the expression string badly.
$payload = "{{`"id`":2,`"method`":`"Runtime.evaluate`",`"params`":{{`"expression`":{0},`"awaitPromise`":true,`"returnByValue`":true}}}}" -f (
  ($Expression | ConvertTo-Json -Compress)
)
$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
$seg = New-Object System.ArraySegment[byte] -ArgumentList @(, $bytes)
$ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult() | Out-Null

$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
$final = $null
while ([DateTime]::UtcNow -lt $deadline) {
  $msg = Recv-Json
  if ($msg.id -eq 2) { $final = $msg; break }
}
try {
  $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", $cts.Token).GetAwaiter().GetResult() | Out-Null
} catch {}

if (-not $final) { throw "No evaluate result" }
if ($final.error) { throw ($final.error | ConvertTo-Json -Compress) }
$final | ConvertTo-Json -Depth 12
