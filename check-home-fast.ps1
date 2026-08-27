# check-home-fast.ps1 - 个人主页文案「零浏览器快检」（纯 HTTP，秒级）
# 用途：只改静态文案/入口后的快速部署反馈。登录态渲染与交互行为请跑浏览器冒烟：
#   .\run-browser-test.ps1 -Url https://hyool.w910227a.workers.dev/home-check.html -OutFile .\test-out-home.txt
# 用法：
#   .\check-home-fast.ps1 [-Origin https://hyool.w910227a.workers.dev] [-User smokews] [-OutFile <path>]
param(
  [string]$Origin = 'https://hyool.w910227a.workers.dev',
  [string]$User = 'smokews',
  [string]$OutFile = '',
  [int]$TimeoutSec = 30
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # 关闭 Invoke-WebRequest 进度条噪音

$out = New-Object System.Collections.Generic.List[string]
$script:pass = 0
$script:fail = 0
function OK($cond, $name, $extra='') {
  $l = ($(if ($cond) { 'PASS  ' } else { 'FAIL  ' })) + $name + ($(if ($extra) { '  ' + $extra } else { '' }))
  $out.Add($l)
  if ($cond) { $script:pass++ } else { $script:fail++ }
}

function Get-Html($u) {
  $r = Invoke-WebRequest -Uri $u -TimeoutSec $TimeoutSec -UseBasicParsing
  # 显式按 UTF-8 解码原始字节，避免缺 charset 头时按 ISO-8859-1 解码导致中文匹配失败
  return [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
}

Write-Output "快检 $Origin/@$User ..."
$profileHtml = Get-Html "$Origin/@$User"
$hubHtml = Get-Html "$Origin/hub?create=world"

OK ($profileHtml -match '角色库') '主页: 「角色库」标题'
OK ($profileHtml -match '世界库') '主页: 「世界库」标题'
OK ($profileHtml -match '创造角色') '主页: 「创造角色」文案'
OK ($profileHtml -match '创造世界') '主页: 「创造世界」文案'
OK ($profileHtml -match '/create/character/') '主页: 角色库首卡 href'
OK ($profileHtml -match 'studio-world\.html\?create=life') '主页: 世界库首卡 href'
OK ($profileHtml -match 'id="worldsSection"') '主页: 世界库区块存在'
OK ($profileHtml -notmatch '数字生命') '主页: 无「数字生命」'
OK ($profileHtml -notmatch 'postsSection') '主页: 无 postsSection'
OK ($profileHtml -notmatch 'statsContainer') '主页: 无 statsContainer'
OK ($profileHtml -notmatch 'id="infiniteSection"') '主页: 「无限」区块已移除'
OK ($profileHtml -match 'modulesSection') '主页: 自定义模块区容器存在'
OK ($profileHtml -match '自定义模块区') '主页: 编辑器「自定义模块区」'
OK ($profileHtml -match 'id="navEditBtn"') '主页: 底部导航「编辑彼岸」按钮'
OK ($profileHtml -notmatch '返回幻灵') '主页: 底部导航无「返回幻灵」'
OK ($profileHtml -match 'worldPlayUrl') '主页: 世界卡片直达进入逻辑'


OK ($hubHtml -match '我的彼岸') 'hub: 角色工坊已改名「我的彼岸」'
OK ($hubHtml -match 'openWizard') 'hub: openWizard 直达向导逻辑'
OK ($hubHtml -match 'wizardModal') 'hub: wizardModal 弹窗'
OK ($hubHtml -match 'wizard-step-dot') 'hub: 向导步点 UI'

$total = $script:pass + $script:fail
$out.Add('')
$out.Add(('==== 快检结果: ' + ($(if ($script:fail) { '失败 ' + $script:fail + ' 项' } else { '全部通过' })) + "（$($script:pass)/$total）===="))
$text = $out -join "`n"
Write-Output $text
if ($OutFile) { $text | Set-Content -Path $OutFile -Encoding UTF8 }
exit $(if ($script:fail) { 1 } else { 0 })
