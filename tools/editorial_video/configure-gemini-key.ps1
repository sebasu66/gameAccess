# Operator-only masked API key entry. No keys in stdout, Git or chat.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class GameAccessEditorialCredentialStore {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential {
        public uint Flags, Type;
        public string TargetName, Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias, UserName;
    }
    [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool CredWrite(ref Credential credential, uint flags);
    public static void Save(string key) {
        byte[] bytes = Encoding.UTF8.GetBytes(key);
        IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
        try {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            var credential = new Credential {
                Type=1, TargetName="GameAccess/GeminiAPIKey",
                Comment="GameAccess editorial video generation",
                CredentialBlobSize=(uint)bytes.Length, CredentialBlob=blob,
                Persist=2, UserName=Environment.UserName
            };
            if (!CredWrite(ref credential, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        } finally {
            for (int i=0; i<bytes.Length; i++) Marshal.WriteByte(blob, i, 0);
            Marshal.FreeHGlobal(blob);
            Array.Clear(bytes, 0, bytes.Length);
        }
    }
}
'@
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = 'GameAccess - Clave de Gemini'
$form.ClientSize = New-Object System.Drawing.Size(540, 280)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
$intro = New-Object System.Windows.Forms.Label
$intro.Text = @(
    'Pega tu API key de Google AI Studio si quieres cambiarla.',
    'Se guarda para tu usuario en el Administrador de credenciales',
    'de Windows. La clave no se envia al chat ni al repositorio.'
) -join [Environment]::NewLine
$intro.Location = New-Object System.Drawing.Point(24, 20)
$intro.Size = New-Object System.Drawing.Size(490, 62)
$form.Controls.Add($intro)
$fieldLabel = New-Object System.Windows.Forms.Label
$fieldLabel.Text = 'API key de Gemini'
$fieldLabel.Location = New-Object System.Drawing.Point(24, 98)
$fieldLabel.AutoSize = $true
$form.Controls.Add($fieldLabel)
$keyInput = New-Object System.Windows.Forms.TextBox
$keyInput.Location = New-Object System.Drawing.Point(24, 122)
$keyInput.Size = New-Object System.Drawing.Size(490, 28)
$keyInput.UseSystemPasswordChar = $true
$form.Controls.Add($keyInput)
$status = New-Object System.Windows.Forms.Label
$status.Text = 'Puedes cerrar y seguir usando la clave ya configurada.'
$status.Location = New-Object System.Drawing.Point(24, 160)
$status.Size = New-Object System.Drawing.Size(490, 35)
$form.Controls.Add($status)
$save = New-Object System.Windows.Forms.Button
$save.Text = 'Guardar'
$save.Location = New-Object System.Drawing.Point(304, 224)
$save.Size = New-Object System.Drawing.Size(96, 30)
$form.Controls.Add($save)
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = 'Usar actual'
$cancel.Location = New-Object System.Drawing.Point(408, 224)
$cancel.Size = New-Object System.Drawing.Size(106, 30)
$cancel.Add_Click({ $keyInput.Clear(); $form.Close() })
$form.Controls.Add($cancel)
$form.AcceptButton = $save
$form.CancelButton = $cancel
$save.Add_Click({
    $taskApiKey = $keyInput.Text.Trim()
    if ($taskApiKey.Length -lt 20 -or $taskApiKey -match '\s') {
        $status.Text = 'Pega una clave completa, sin espacios.'
        return
    }
    try {
        [GameAccessEditorialCredentialStore]::Save($taskApiKey)
        $keyInput.Clear()
        $taskApiKey = $null
        [System.Windows.Forms.MessageBox]::Show('Clave guardada. Ya puede usarse para generar la voz.', 'GameAccess') | Out-Null
        $form.Close()
    } catch {
        $status.Text = 'No se pudo guardar en Windows. Revisa los permisos de tu usuario.'
    } finally {
        $taskApiKey = $null
    }
})
$form.Add_Shown({ $form.Activate(); $keyInput.Focus() })
try { [void]$form.ShowDialog() } finally { $keyInput.Clear(); $form.Dispose() }

