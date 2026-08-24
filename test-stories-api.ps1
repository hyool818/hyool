# story-editor cloud-sync API smoke test (local wrangler dev) - ASCII only
$base = 'http://127.0.0.1:8787'
$ErrorActionPreference = 'Stop'

$login = Invoke-RestMethod -Uri "$base/api/login" -Method Post -ContentType 'application/json' -Body (@{ username = 'smokews'; password = 'testpass123' } | ConvertTo-Json) -SessionVariable sess
if (-not $login.success) { throw "login failed: $($login.error)" }
$token = $login.token
$h = @{ Authorization = "Bearer $token" }
Write-Host "1. login OK"

$created = Invoke-RestMethod -Uri "$base/api/stories" -Method Post -ContentType 'application/json' -Headers $h -Body (@{ title = 'Test Story'; orientation = 'landscape'; imgQuality = 'standard' } | ConvertTo-Json)
if (-not $created.success) { throw "create failed: $($created.error)" }
$sid = $created.story.id
if (-not ($sid -match '^st_[a-z0-9]+$')) { throw "bad story id: $sid" }
if (-not $created.story.share_id) { throw 'create should have share_id' }
Write-Host "2. create OK: $sid share_id=$($created.story.share_id)"

$list = Invoke-RestMethod -Uri "$base/api/stories" -Headers $h
if (-not $list.success -or $list.stories.Count -lt 1) { throw 'list failed' }
Write-Host "3. list OK: $($list.stories.Count) story(ies)"

$data = @{
  title = 'Test Story'; orientation = 'landscape'; imgQuality = 'standard'; cast = @{}
  chapters = @(
    @{ id = 'ch_a1'; title = 'Ch1'; blocks = @(
      @{ id = 'b1'; type = 'scene'; content = 'Gate'; media = @{ url = '/img/test.jpg'; type = 'image' } },
      @{ id = 'b2'; type = 'dialogue'; content = 'Hi'; speaker = 'Su'; subtitle = @{ on = $true } }
    ) }
  )
}
$saved = Invoke-RestMethod -Uri "$base/api/stories/$sid" -Method Put -ContentType 'application/json' -Headers $h -Body (@{ data = $data } | ConvertTo-Json -Depth 10)
if (-not $saved.success) { throw "save failed: $($saved.error)" }
if ($saved.story.cover_image -ne '/img/test.jpg') { throw "cover extract failed: $($saved.story.cover_image)" }
Write-Host "4. save OK, cover=$($saved.story.cover_image)"

$pub = Invoke-RestMethod -Uri "$base/api/stories/$sid/publish" -Method Post -ContentType 'application/json' -Headers $h -Body (@{ published = $true } | ConvertTo-Json)
if (-not $pub.success -or $pub.story.status -ne 'published') { throw 'publish failed' }
Write-Host "5. publish OK status=$($pub.story.status)"

$anon = Invoke-RestMethod -Uri "$base/api/stories/$sid"
if (-not $anon.success -or $anon.story.title -ne 'Test Story') { throw 'anon read failed' }
if ($anon.story.chapters.Count -ne 1) { throw 'anon data chapters missing' }
Write-Host "6. anon read OK chapters=$($anon.story.chapters.Count)"

$plaza = Invoke-RestMethod -Uri "$base/api/plaza"
if (-not ($plaza.stories | Where-Object { $_.id -eq $sid })) { throw 'plaza missing story' }
Write-Host "7. plaza OK stories=$($plaza.stories.Count)"

$homePage = Invoke-RestMethod -Uri "$base/api/yonder/smokews"
if (-not ($homePage.yonder.works.stories | Where-Object { $_.id -eq $sid })) { throw 'yonder home missing story' }
Write-Host "8. yonder home OK stories=$($homePage.yonder.works.stories.Count)"

$down = Invoke-RestMethod -Uri "$base/api/stories/$sid/publish" -Method Post -ContentType 'application/json' -Headers $h -Body (@{ published = $false } | ConvertTo-Json)
if ($down.story.status -ne 'draft') { throw 'unpublish failed' }
if (-not $down.story.share_id) { throw 'unpublish should keep share_id' }
$plaza2 = Invoke-RestMethod -Uri "$base/api/plaza"
if ($plaza2.stories | Where-Object { $_.id -eq $sid }) { throw 'unpublished story still in plaza' }
$home2 = Invoke-RestMethod -Uri "$base/api/yonder/smokews"
if (-not ($home2.yonder.works.stories | Where-Object { $_.id -eq $sid })) { throw 'unpublished story missing from home (should stay)' }
Write-Host "9. unpublish OK: plaza removed, home kept"

$blocked = $false
try { Invoke-RestMethod -Uri "$base/api/stories/$sid" -ErrorAction Stop | Out-Null } catch { $blocked = $true }
if (-not $blocked) { throw 'anon read should be blocked for draft' }
Write-Host "10. anon draft read blocked OK"

$del = Invoke-RestMethod -Uri "$base/api/stories/$sid/delete" -Method Post -Headers $h
if (-not $del.success) { throw 'delete failed' }
$list2 = Invoke-RestMethod -Uri "$base/api/stories" -Headers $h
if ($list2.stories | Where-Object { $_.id -eq $sid }) { throw 'deleted story still in list' }
Write-Host "11. delete OK"

Write-Host '=== ALL STORIES API TESTS PASSED ==='

