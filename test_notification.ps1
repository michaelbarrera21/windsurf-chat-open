# EnhanceChatOpen Toast Notification 测试脚本
# 用于测试 Windows Toast 通知是否正常工作

Write-Host "正在测试 Windows Toast 通知..." -ForegroundColor Cyan

try {
    # 加载必需的 WinRT 类型
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
    
    Write-Host "[OK] WinRT 类型加载成功" -ForegroundColor Green
    
    # 创建 Toast XML 模板
    $template = @"
<toast>
    <visual>
        <binding template="ToastText02">
            <text id="1">EnhanceChatOpen 测试</text>
            <text id="2">如果你看到这条通知，说明桌面通知功能正常工作！</text>
        </binding>
    </visual>
    <audio silent="true" />
</toast>
"@
    
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml($template)
    
    Write-Host "[OK] Toast XML 创建成功" -ForegroundColor Green
    
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    
    # 尝试使用 PowerShell 的 AppId
    $appId = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
    
    Write-Host "尝试发送 Toast 通知..." -ForegroundColor Yellow
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
    Write-Host "[OK] Toast 通知已发送！请检查屏幕右下角或通知中心" -ForegroundColor Green

} catch {
    Write-Host "[ERROR] 错误: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "可能原因：" -ForegroundColor Yellow
    Write-Host "1. Windows 通知设置被禁用" -ForegroundColor Yellow
    Write-Host "2. 专注模式/勿扰模式已开启" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "按回车键退出..."
Read-Host
