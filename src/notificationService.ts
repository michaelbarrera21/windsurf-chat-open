import * as child_process from 'child_process';
import * as os from 'os';

/**
 * 发送 Windows 系统桌面通知
 * 使用 PowerShell 调用 Windows Toast Notification API
 */
export function showDesktopNotification(title: string, message: string): void {
    if (os.platform() !== 'win32') {
        console.log(`[WindsurfChatOpen] Desktop notification not supported on ${os.platform()}`);
        return;
    }

    // 转义 PowerShell 特殊字符
    const escapeForPowerShell = (str: string): string => {
        return str
            .replace(/`/g, '``')  // 反引号
            .replace(/\$/g, '`$') // 美元符号
            .replace(/"/g, '`"') // 双引号
            .replace(/'/g, "''"); // 单引号（在单引号字符串中需要双写）
    };

    const safeTitle = escapeForPowerShell(title);
    const safeMessage = escapeForPowerShell(message);

    // 使用 Windows 原生 Toast Notification API
    const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$template = @"
<toast>
    <visual>
        <binding template="ToastText02">
            <text id="1">${safeTitle}</text>
            <text id="2">${safeMessage}</text>
        </binding>
    </visual>
    <audio silent="true" />
</toast>
"@

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)

$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$appId = 'WindsurfChatOpen'
try {
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
} catch {
    $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
}
`;

    try {
        // 将脚本写入临时文件执行，避免命令行引号问题
        // 使用 UTF-8 with BOM 编码，确保 PowerShell 正确处理中文
        const tmpFile = `${os.tmpdir()}\\wsc_notify_${Date.now()}.ps1`;
        const fs = require('fs');
        const BOM = '\uFEFF'; // UTF-8 BOM
        fs.writeFileSync(tmpFile, BOM + script, 'utf-8');

        child_process.exec(
            `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpFile}"`,
            { windowsHide: true },
            (error, stdout, stderr) => {
                // 清理临时文件
                try { require('fs').unlinkSync(tmpFile); } catch { }

                if (error) {
                    console.log(`[WindsurfChatOpen] Desktop notification error: ${error.message}`);
                }
            }
        );
        console.log(`[WindsurfChatOpen] Desktop notification sent: ${title}`);
    } catch (e) {
        console.error(`[WindsurfChatOpen] Failed to send desktop notification: ${e}`);
    }
}
