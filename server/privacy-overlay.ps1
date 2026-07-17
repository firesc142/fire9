# Privacy Mode Overlay
# Creates fullscreen black windows on all monitors that are VISIBLE on the physical
# screen but INVISIBLE to screen capture APIs (like TeamViewer privacy mode).
# Uses SetWindowDisplayAffinity(WDA_EXCLUDEDFROMCAPTURE) so the remote user
# can still see/control the desktop via screen capture while the local user sees black.
# Uses WS_EX_TRANSPARENT + WS_EX_LAYERED to make the overlay click-through so
# remote mouse/keyboard input (via SendInput) passes through to the real desktop.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class DisplayAffinity {
    [DllImport("user32.dll")]
    public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    public const uint WDA_NONE = 0x00000000;
    public const uint WDA_EXCLUDEDFROMCAPTURE = 0x00000011;

    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_LAYERED = 0x00080000;
    public const int WS_EX_TRANSPARENT = 0x00000020;
    public const int WS_EX_TOOLWINDOW = 0x00000080;
    public const int WS_EX_NOACTIVATE = 0x08000000;

    public static void MakeClickThrough(IntPtr hWnd) {
        int exStyle = GetWindowLong(hWnd, GWL_EXSTYLE);
        exStyle |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        SetWindowLong(hWnd, GWL_EXSTYLE, exStyle);
    }
}
"@

# Prevent multiple instances
$mutexName = "Global\RemoteDesktopPrivacyOverlay"
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
if (-not $mutex.WaitOne(0, $false)) {
    exit 0
}

$forms = @()

foreach ($scr in [System.Windows.Forms.Screen]::AllScreens) {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'RemoteDesktopPrivacy'
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.BackColor = [System.Drawing.Color]::Black
    $form.Opacity = 1.0
    $form.TopMost = $true
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $form.Location = $scr.Bounds.Location
    $form.Size = $scr.Bounds.Size
    $form.ShowInTaskbar = $false
    $form.KeyPreview = $true

    # Block Alt+F4 and Escape from closing
    $form.Add_KeyDown({
        param($sender, $e)
        if ($e.Alt -and $e.KeyCode -eq [System.Windows.Forms.Keys]::F4) {
            $e.Handled = $true
            $e.SuppressKeyPress = $true
        }
        if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
            $e.Handled = $true
            $e.SuppressKeyPress = $true
        }
    })

    # Prevent closing via window messages
    $form.Add_FormClosing({
        param($sender, $e)
        if ($e.CloseReason -ne [System.Windows.Forms.CloseReason]::TaskManagerClosing -and
            $e.CloseReason -ne [System.Windows.Forms.CloseReason]::WindowsShutDown) {
            $e.Cancel = $true
        }
    })

    # After the window is shown, set display affinity and make click-through
    $form.Add_Shown({
        param($sender, $e)
        $handle = $sender.Handle
        # Exclude from screen capture — physical screen shows black, capture sees desktop
        [DisplayAffinity]::SetWindowDisplayAffinity($handle, [DisplayAffinity]::WDA_EXCLUDEDFROMCAPTURE)
        # Make window click-through so SendInput passes to apps beneath
        [DisplayAffinity]::MakeClickThrough($handle)
    })

    $form.Show()
    $forms += $form
}

# Run the message loop — keeps windows alive until process is terminated
[System.Windows.Forms.Application]::Run()

# Cleanup
$mutex.ReleaseMutex()
$mutex.Dispose()
