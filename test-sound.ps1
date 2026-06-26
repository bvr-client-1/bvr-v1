Add-Type -AssemblyName presentationCore
$player = New-Object System.Windows.Media.MediaPlayer
$player.Open([uri]"file:///C:/Users/Sunny/Downloads/swiggy_new_order.mp3")
Start-Sleep -Milliseconds 600
$player.Volume = 1.0
$player.Play()
Start-Sleep -Milliseconds 5000
$player.Stop()
$player.Close()
Write-Host "Sound test complete!"
