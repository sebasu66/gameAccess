using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;

namespace GameAccessPluginInstaller;

public class InstallerForm : Form
{
    private readonly Panel _headerPanel = new();
    private readonly Label _titleLabel = new();
    private readonly Label _stepSubtitleLabel = new();

    private readonly Panel _contentPanel = new();
    private readonly Panel _footerPanel = new();
    private readonly Button _backButton = new();
    private readonly Button _nextButton = new();
    private readonly Button _cancelButton = new();

    // Step panels
    private readonly Panel _step1DetectionPanel = new();
    private readonly Panel _step2SourcesPanel = new();
    private readonly Panel _step3InstallPanel = new();
    private readonly Panel _step4FinishPanel = new();

    // Step 1 controls
    private readonly Label _detectionStatusLabel = new();
    private readonly Label _detectionPathLabel = new();
    private readonly Button _browseGaButton = new();
    private readonly Label _requirementsNotice = new();

    // Step 2 controls
    private readonly Label _sourcesPromptLabel = new();
    private readonly Button _selectAllButton = new();
    private readonly Button _selectNoneButton = new();
    private readonly Label _selectedCountLabel = new();
    private readonly DataGridView _sourcesGrid = new();

    // Step 3 controls
    private readonly Label _installStatusLabel = new();
    private readonly ProgressBar _installProgressBar = new();
    private readonly Label _installDetailLabel = new();

    // Step 4 controls
    private readonly Label _finishTitleLabel = new();
    private readonly Label _finishSummaryLabel = new();
    private readonly CheckBox _launchPluginCheck = new();

    private int _currentStep = 1;
    private DetectionResult _detection = new(false, null, "", "", "");
    private readonly List<SourceRowItem> _sourceItems = [];

    public InstallerForm()
    {
        InitializeComponent();
        ApplyDarkTheme();
        LoadKnownSources();
        RunDetection();
        ShowStep(1);
    }

    private void InitializeComponent()
    {
        Text = "Instalador del Plugin - Game Access Torrent Provider";
        Size = new Size(820, 620);
        MinimumSize = new Size(760, 560);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;

        // Header Panel
        _headerPanel.Dock = DockStyle.Top;
        _headerPanel.Height = 85;
        _headerPanel.Padding = new Padding(24, 16, 24, 12);

        _titleLabel.Text = "Game Access · Instalador de Plugin de Fuentes";
        _titleLabel.Font = new Font("Segoe UI", 14, FontStyle.Bold);
        _titleLabel.AutoSize = true;
        _titleLabel.Location = new Point(24, 16);

        _stepSubtitleLabel.Text = "Paso 1: Verificación de requisitos";
        _stepSubtitleLabel.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
        _stepSubtitleLabel.AutoSize = true;
        _stepSubtitleLabel.Location = new Point(24, 48);

        _headerPanel.Controls.Add(_titleLabel);
        _headerPanel.Controls.Add(_stepSubtitleLabel);

        // Footer Panel
        _footerPanel.Dock = DockStyle.Bottom;
        _footerPanel.Height = 65;
        _footerPanel.Padding = new Padding(24, 14, 24, 14);

        _cancelButton.Text = "Cancelar";
        _cancelButton.Size = new Size(100, 34);
        _cancelButton.Location = new Point(24, 15);
        _cancelButton.Click += (_, _) => Close();

        _backButton.Text = "< Anterior";
        _backButton.Size = new Size(105, 34);
        _backButton.Location = new Point(570, 15);
        _backButton.Click += (_, _) => GoBack();

        _nextButton.Text = "Siguiente >";
        _nextButton.Size = new Size(115, 34);
        _nextButton.Location = new Point(685, 15);
        _nextButton.Click += (_, _) => GoNext();

        _footerPanel.Controls.Add(_cancelButton);
        _footerPanel.Controls.Add(_backButton);
        _footerPanel.Controls.Add(_nextButton);

        // Content Panel
        _contentPanel.Dock = DockStyle.Fill;
        _contentPanel.Padding = new Padding(24, 16, 24, 16);

        BuildStep1Detection();
        BuildStep2Sources();
        BuildStep3Install();
        BuildStep4Finish();

        _contentPanel.Controls.Add(_step1DetectionPanel);
        _contentPanel.Controls.Add(_step2SourcesPanel);
        _contentPanel.Controls.Add(_step3InstallPanel);
        _contentPanel.Controls.Add(_step4FinishPanel);

        Controls.Add(_contentPanel);
        Controls.Add(_footerPanel);
        Controls.Add(_headerPanel);
    }

    private void ApplyDarkTheme()
    {
        BackColor = Color.FromArgb(24, 24, 28);
        ForeColor = Color.FromArgb(240, 240, 245);

        _headerPanel.BackColor = Color.FromArgb(32, 32, 38);
        _footerPanel.BackColor = Color.FromArgb(28, 28, 34);
        _contentPanel.BackColor = Color.FromArgb(24, 24, 28);

        _titleLabel.ForeColor = Color.White;
        _stepSubtitleLabel.ForeColor = Color.FromArgb(160, 160, 175);

        StyleButton(_nextButton, Color.FromArgb(59, 130, 246), Color.White);
        StyleButton(_backButton, Color.FromArgb(45, 45, 55), Color.FromArgb(220, 220, 230));
        StyleButton(_cancelButton, Color.FromArgb(45, 45, 55), Color.FromArgb(200, 200, 210));
        StyleButton(_browseGaButton, Color.FromArgb(45, 45, 55), Color.FromArgb(220, 220, 230));
        StyleButton(_selectAllButton, Color.FromArgb(45, 45, 55), Color.FromArgb(220, 220, 230));
        StyleButton(_selectNoneButton, Color.FromArgb(45, 45, 55), Color.FromArgb(220, 220, 230));
    }

    private static void StyleButton(Button btn, Color backColor, Color foreColor)
    {
        btn.BackColor = backColor;
        btn.ForeColor = foreColor;
        btn.FlatStyle = FlatStyle.Flat;
        btn.FlatAppearance.BorderSize = 0;
        btn.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
        btn.Cursor = Cursors.Hand;
    }

    private void BuildStep1Detection()
    {
        _step1DetectionPanel.Dock = DockStyle.Fill;
        _step1DetectionPanel.Padding = new Padding(12);

        var title = new Label
        {
            Text = "Detección de Game Access",
            Font = new Font("Segoe UI", 12f, FontStyle.Bold),
            ForeColor = Color.White,
            AutoSize = true,
            Location = new Point(12, 12)
        };

        var desc = new Label
        {
            Text = "Este plugin requiere que el software Game Access esté instalado en el sistema antes de continuar.\nEl instalador verifica la presencia de la aplicación principal para configurar la integración automática.",
            Font = new Font("Segoe UI", 9.5f),
            ForeColor = Color.FromArgb(180, 180, 195),
            Location = new Point(12, 45),
            Size = new Size(740, 42)
        };

        _detectionStatusLabel.Font = new Font("Segoe UI", 10.5f, FontStyle.Bold);
        _detectionStatusLabel.Location = new Point(12, 105);
        _detectionStatusLabel.Size = new Size(740, 28);

        _detectionPathLabel.Font = new Font("Segoe UI", 9.5f);
        _detectionPathLabel.ForeColor = Color.FromArgb(170, 170, 185);
        _detectionPathLabel.Location = new Point(12, 140);
        _detectionPathLabel.Size = new Size(740, 40);

        _browseGaButton.Text = "Examinar carpeta de Game Access...";
        _browseGaButton.Size = new Size(240, 34);
        _browseGaButton.Location = new Point(12, 195);
        _browseGaButton.Click += OnBrowseFolder;

        _requirementsNotice.Font = new Font("Segoe UI", 9.5f, FontStyle.Italic);
        _requirementsNotice.ForeColor = Color.FromArgb(239, 68, 68);
        _requirementsNotice.Location = new Point(12, 250);
        _requirementsNotice.Size = new Size(740, 50);

        _step1DetectionPanel.Controls.Add(title);
        _step1DetectionPanel.Controls.Add(desc);
        _step1DetectionPanel.Controls.Add(_detectionStatusLabel);
        _step1DetectionPanel.Controls.Add(_detectionPathLabel);
        _step1DetectionPanel.Controls.Add(_browseGaButton);
        _step1DetectionPanel.Controls.Add(_requirementsNotice);
    }

    private void BuildStep2Sources()
    {
        _step2SourcesPanel.Dock = DockStyle.Fill;
        _step2SourcesPanel.Padding = new Padding(12);

        _sourcesPromptLabel.Text = "¿Deseas agregar fuentes existentes automáticamente?\nMarca las fuentes que deseas configurar en el plugin (desmarcadas por defecto):";
        _sourcesPromptLabel.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
        _sourcesPromptLabel.ForeColor = Color.White;
        _sourcesPromptLabel.Location = new Point(12, 8);
        _sourcesPromptLabel.Size = new Size(740, 40);

        _selectAllButton.Text = "Marcar todas (All)";
        _selectAllButton.Size = new Size(140, 30);
        _selectAllButton.Location = new Point(12, 55);
        _selectAllButton.Click += (_, _) => SetAllSources(true);

        _selectNoneButton.Text = "Desmarcar todas (None)";
        _selectNoneButton.Size = new Size(160, 30);
        _selectNoneButton.Location = new Point(160, 55);
        _selectNoneButton.Click += (_, _) => SetAllSources(false);

        _selectedCountLabel.Text = "Fuentes seleccionadas: 0 de " + KnownSources.List.Count;
        _selectedCountLabel.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
        _selectedCountLabel.ForeColor = Color.FromArgb(160, 160, 180);
        _selectedCountLabel.Location = new Point(480, 60);
        _selectedCountLabel.Size = new Size(270, 24);
        _selectedCountLabel.TextAlign = ContentAlignment.TopRight;

        _sourcesGrid.Location = new Point(12, 95);
        _sourcesGrid.Size = new Size(745, 300);
        _sourcesGrid.BackgroundColor = Color.FromArgb(32, 32, 38);
        _sourcesGrid.BorderStyle = BorderStyle.None;
        _sourcesGrid.RowHeadersVisible = false;
        _sourcesGrid.AllowUserToAddRows = false;
        _sourcesGrid.AllowUserToDeleteRows = false;
        _sourcesGrid.AllowUserToResizeRows = false;
        _sourcesGrid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        _sourcesGrid.MultiSelect = false;
        _sourcesGrid.EnableHeadersVisualStyles = false;
        _sourcesGrid.GridColor = Color.FromArgb(45, 45, 55);

        _sourcesGrid.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(40, 40, 48);
        _sourcesGrid.ColumnHeadersDefaultCellStyle.ForeColor = Color.White;
        _sourcesGrid.ColumnHeadersDefaultCellStyle.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        _sourcesGrid.ColumnHeadersHeight = 32;

        _sourcesGrid.DefaultCellStyle.BackColor = Color.FromArgb(28, 28, 34);
        _sourcesGrid.DefaultCellStyle.ForeColor = Color.FromArgb(230, 230, 240);
        _sourcesGrid.DefaultCellStyle.SelectionBackColor = Color.FromArgb(48, 56, 75);
        _sourcesGrid.DefaultCellStyle.SelectionForeColor = Color.White;
        _sourcesGrid.DefaultCellStyle.Font = new Font("Segoe UI", 9.5f);
        _sourcesGrid.RowTemplate.Height = 28;

        var colCheck = new DataGridViewCheckBoxColumn
        {
            Name = "Select",
            HeaderText = "Incluir",
            Width = 60,
            ReadOnly = false,
            FalseValue = false,
            TrueValue = true
        };
        var colName = new DataGridViewTextBoxColumn
        {
            Name = "Name",
            HeaderText = "Fuente",
            Width = 140,
            ReadOnly = true
        };
        var colType = new DataGridViewTextBoxColumn
        {
            Name = "Type",
            HeaderText = "Tipo",
            Width = 160,
            ReadOnly = true
        };
        var colDesc = new DataGridViewTextBoxColumn
        {
            Name = "Desc",
            HeaderText = "Descripción",
            Width = 360,
            ReadOnly = true
        };

        _sourcesGrid.Columns.AddRange(colCheck, colName, colType, colDesc);
        _sourcesGrid.CellValueChanged += (_, e) =>
        {
            if (e.RowIndex >= 0 && e.ColumnIndex == 0) UpdateCountLabel();
        };
        _sourcesGrid.CurrentCellDirtyStateChanged += (_, _) =>
        {
            if (_sourcesGrid.IsCurrentCellDirty) _sourcesGrid.CommitEdit(DataGridViewDataErrorContexts.Commit);
        };

        _step2SourcesPanel.Controls.Add(_sourcesPromptLabel);
        _step2SourcesPanel.Controls.Add(_selectAllButton);
        _step2SourcesPanel.Controls.Add(_selectNoneButton);
        _step2SourcesPanel.Controls.Add(_selectedCountLabel);
        _step2SourcesPanel.Controls.Add(_sourcesGrid);
    }

    private void BuildStep3Install()
    {
        _step3InstallPanel.Dock = DockStyle.Fill;
        _step3InstallPanel.Padding = new Padding(12);

        var title = new Label
        {
            Text = "Copiando plugin y dependencias...",
            Font = new Font("Segoe UI", 12f, FontStyle.Bold),
            ForeColor = Color.White,
            AutoSize = true,
            Location = new Point(12, 24)
        };

        _installStatusLabel.Font = new Font("Segoe UI", 10f);
        _installStatusLabel.ForeColor = Color.FromArgb(200, 200, 215);
        _installStatusLabel.Location = new Point(12, 70);
        _installStatusLabel.Size = new Size(740, 25);
        _installStatusLabel.Text = "Preparando archivos...";

        _installProgressBar.Location = new Point(12, 110);
        _installProgressBar.Size = new Size(740, 26);
        _installProgressBar.Style = ProgressBarStyle.Continuous;
        _installProgressBar.Minimum = 0;
        _installProgressBar.Maximum = 100;

        _installDetailLabel.Font = new Font("Segoe UI", 9f);
        _installDetailLabel.ForeColor = Color.FromArgb(150, 150, 165);
        _installDetailLabel.Location = new Point(12, 150);
        _installDetailLabel.Size = new Size(740, 60);

        _step3InstallPanel.Controls.Add(title);
        _step3InstallPanel.Controls.Add(_installStatusLabel);
        _step3InstallPanel.Controls.Add(_installProgressBar);
        _step3InstallPanel.Controls.Add(_installDetailLabel);
    }

    private void BuildStep4Finish()
    {
        _step4FinishPanel.Dock = DockStyle.Fill;
        _step4FinishPanel.Padding = new Padding(12);

        _finishTitleLabel.Text = "¡Instalación completada exitosamente!";
        _finishTitleLabel.Font = new Font("Segoe UI", 13f, FontStyle.Bold);
        _finishTitleLabel.ForeColor = Color.FromArgb(34, 197, 94);
        _finishTitleLabel.Location = new Point(12, 20);
        _finishTitleLabel.Size = new Size(740, 35);

        _finishSummaryLabel.Font = new Font("Segoe UI", 10f);
        _finishSummaryLabel.ForeColor = Color.FromArgb(210, 210, 225);
        _finishSummaryLabel.Location = new Point(12, 70);
        _finishSummaryLabel.Size = new Size(740, 150);

        _launchPluginCheck.Text = "Iniciar el plugin de fuentes ahora";
        _launchPluginCheck.Font = new Font("Segoe UI", 10f);
        _launchPluginCheck.ForeColor = Color.White;
        _launchPluginCheck.Checked = true;
        _launchPluginCheck.Location = new Point(12, 240);
        _launchPluginCheck.Size = new Size(400, 30);

        _step4FinishPanel.Controls.Add(_finishTitleLabel);
        _step4FinishPanel.Controls.Add(_finishSummaryLabel);
        _step4FinishPanel.Controls.Add(_launchPluginCheck);
    }

    private void LoadKnownSources()
    {
        _sourcesGrid.Rows.Clear();
        _sourceItems.Clear();

        foreach (var src in KnownSources.List)
        {
            // All unselected by default as requested!
            var item = new SourceRowItem(src, false);
            _sourceItems.Add(item);
            _sourcesGrid.Rows.Add(false, src.Name, src.Type, src.Description);
        }
        UpdateCountLabel();
    }

    private void SetAllSources(bool selected)
    {
        for (int i = 0; i < _sourcesGrid.Rows.Count; i++)
        {
            _sourcesGrid.Rows[i].Cells[0].Value = selected;
        }
        UpdateCountLabel();
    }

    private void UpdateCountLabel()
    {
        int count = 0;
        for (int i = 0; i < _sourcesGrid.Rows.Count; i++)
        {
            if (_sourcesGrid.Rows[i].Cells[0].Value is true) count++;
        }
        _selectedCountLabel.Text = $"Fuentes seleccionadas: {count} de {_sourcesGrid.Rows.Count}";
    }

    private void RunDetection()
    {
        _detection = GameAccessDetector.Detect();
        if (_detection.IsInstalled)
        {
            _detectionStatusLabel.Text = "✓ " + _detection.Message;
            _detectionStatusLabel.ForeColor = Color.FromArgb(34, 197, 94);
            _detectionPathLabel.Text = $"Ubicación detectada: {_detection.InstallPath}\nCarpeta de plugins destino: {_detection.PluginsPath}";
            _requirementsNotice.Text = "";
            _nextButton.Enabled = true;
        }
        else
        {
            _detectionStatusLabel.Text = "✗ Game Access NO detectado";
            _detectionStatusLabel.ForeColor = Color.FromArgb(239, 68, 68);
            _detectionPathLabel.Text = "No se localizó la instalación de Game Access en las rutas predeterminadas ni en el registro.";
            _requirementsNotice.Text = "ATENCIÓN: Se requiere tener Game Access instalado para continuar. Si tienes Game Access en otra carpeta, usa 'Examinar' para seleccionarla.";
            _nextButton.Enabled = false;
        }
    }

    private void OnBrowseFolder(object? sender, EventArgs e)
    {
        using var dialog = new FolderBrowserDialog();
        dialog.Description = "Selecciona la carpeta donde está instalado Game Access:";
        dialog.UseDescriptionForTitle = true;
        if (dialog.ShowDialog() == DialogResult.OK)
        {
            string chosen = dialog.SelectedPath;
            if (GameAccessDetector.IsGameAccessDirectory(chosen) || Directory.Exists(chosen))
            {
                string plugins = Path.Combine(chosen, "plugins");
                _detection = new DetectionResult(true, chosen, plugins, _detection.AppDataPluginsPath, $"Game Access seleccionado manualmente: {chosen}");
                _detectionStatusLabel.Text = "✓ " + _detection.Message;
                _detectionStatusLabel.ForeColor = Color.FromArgb(34, 197, 94);
                _detectionPathLabel.Text = $"Ubicación: {chosen}\nCarpeta de plugins: {plugins}";
                _requirementsNotice.Text = "";
                _nextButton.Enabled = true;
            }
            else
            {
                MessageBox.Show(this, "La carpeta seleccionada no parece contener Game Access.", "Carpeta no válida", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
    }

    private void ShowStep(int step)
    {
        _currentStep = step;

        _step1DetectionPanel.Visible = step == 1;
        _step2SourcesPanel.Visible = step == 2;
        _step3InstallPanel.Visible = step == 3;
        _step4FinishPanel.Visible = step == 4;

        _backButton.Visible = step is 2;
        _cancelButton.Visible = step is 1 or 2;

        switch (step)
        {
            case 1:
                _stepSubtitleLabel.Text = "Paso 1: Detección y verificación de Game Access";
                _nextButton.Text = "Siguiente >";
                _nextButton.Enabled = _detection.IsInstalled;
                break;
            case 2:
                _stepSubtitleLabel.Text = "Paso 2: Selección de fuentes comunitarias";
                _nextButton.Text = "Instalar >";
                _nextButton.Enabled = true;
                break;
            case 3:
                _stepSubtitleLabel.Text = "Paso 3: Instalando plugin y dependencias...";
                _nextButton.Enabled = false;
                _backButton.Enabled = false;
                _cancelButton.Enabled = false;
                break;
            case 4:
                _stepSubtitleLabel.Text = "Paso 4: Instalación completada";
                _nextButton.Text = "Finalizar";
                _nextButton.Enabled = true;
                _cancelButton.Visible = false;
                _backButton.Visible = false;
                break;
        }
    }

    private void GoBack()
    {
        if (_currentStep == 2) ShowStep(1);
    }

    private async void GoNext()
    {
        if (_currentStep == 1)
        {
            if (!_detection.IsInstalled) return;
            ShowStep(2);
        }
        else if (_currentStep == 2)
        {
            ShowStep(3);
            await ExecuteInstallationAsync();
        }
        else if (_currentStep == 4)
        {
            if (_launchPluginCheck.Checked)
            {
                LaunchPlugin();
            }
            Close();
        }
    }

    private async Task ExecuteInstallationAsync()
    {
        // Collect chosen source URLs
        var selectedUrls = new List<string>();
        for (int i = 0; i < _sourcesGrid.Rows.Count; i++)
        {
            if (_sourcesGrid.Rows[i].Cells[0].Value is true)
            {
                selectedUrls.Add(KnownSources.List[i].Url);
            }
        }

        string targetPluginFolder = Path.Combine(_detection.PluginsPath, "ga-torrent-provider");
        string appDataPluginFolder = Path.Combine(_detection.AppDataPluginsPath, "ga-torrent-provider");

        await Task.Run(() =>
        {
            try
            {
                UpdateProgress(10, "Creando directorios de destino...", "Preparando carpetas...");
                Directory.CreateDirectory(targetPluginFolder);
                Directory.CreateDirectory(_detection.AppDataPluginsPath);

                // Find self-contained plugin package
                UpdateProgress(25, "Copiando plugin auto-contenido con dependencias...", "Extrayendo ejecutables y librerías...");
                DeployPluginFiles(targetPluginFolder);

                UpdateProgress(70, "Escribiendo configuración de fuentes seleccionadas...", $"{selectedUrls.Count} fuentes seleccionadas.");
                WriteSourcesConfig(targetPluginFolder, selectedUrls);
                WriteSourcesConfig(_detection.AppDataPluginsPath, selectedUrls);

                UpdateProgress(85, "Registrando plugin en Game Access...", "Creando torrent_provider.json...");
                WriteManifest(targetPluginFolder);
                WriteManifest(_detection.AppDataPluginsPath);

                UpdateProgress(95, "Configurando perfiles de ejecución...", "execution-profiles.json...");
                WriteExecutionProfiles(targetPluginFolder);
                WriteExecutionProfiles(_detection.AppDataPluginsPath);

                UpdateProgress(100, "¡Completado!", "Plugin instalado exitosamente.");
            }
            catch (Exception ex)
            {
                Invoke(() =>
                {
                    MessageBox.Show(this, "Error durante la instalación: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    ShowStep(2);
                });
            }
        });

        Invoke(() =>
        {
            _finishSummaryLabel.Text =
                $"El plugin ha sido instalado satisfactoriamente con todas sus dependencias.\n\n" +
                $"• Carpeta del plugin: {targetPluginFolder}\n" +
                $"• Fuentes comunitarias configuradas: {selectedUrls.Count}\n" +
                $"• Integración automática: Activa en Game Access\n\n" +
                $"Cuando Game Access inicie, el plugin se ejecutará automáticamente y sincronizará las fuentes elegidas.";
            ShowStep(4);
        });
    }

    private void UpdateProgress(int percent, string status, string detail)
    {
        Invoke(() =>
        {
            _installProgressBar.Value = Math.Clamp(percent, 0, 100);
            _installStatusLabel.Text = status;
            _installDetailLabel.Text = detail;
        });
    }

    private static void DeployPluginFiles(string destinationDir)
    {
        // 1. Check for embedded assembly resource stream
        var assembly = System.Reflection.Assembly.GetExecutingAssembly();
        var resourceName = assembly.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith("plugin-payload.zip", StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrEmpty(resourceName))
        {
            using var stream = assembly.GetManifestResourceStream(resourceName);
            if (stream != null)
            {
                using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
                archive.ExtractToDirectory(destinationDir, overwriteFiles: true);
                return;
            }
        }

        // 2. Check for local payload zip next to installer
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string payloadZip = Path.Combine(baseDir, "plugin-payload.zip");
        if (File.Exists(payloadZip))
        {
            ZipFile.ExtractToDirectory(payloadZip, destinationDir, overwriteFiles: true);
            return;
        }

        // 3. Check source unpacked build in workspace or adjacent directory
        string devUnpacked = @"C:\DEV\ga-torrent-plugin\dist\win-unpacked";
        if (Directory.Exists(devUnpacked))
        {
            CopyDirectory(devUnpacked, destinationDir);
            return;
        }

        // Fallback: check workspace examples or adjacent dist
        string altUnpacked = Path.Combine(baseDir, "dist", "win-unpacked");
        if (Directory.Exists(altUnpacked))
        {
            CopyDirectory(altUnpacked, destinationDir);
            return;
        }

        throw new DirectoryNotFoundException("No se encontró el paquete con las dependencias del plugin (plugin-payload.zip o dist/win-unpacked).");
    }

    private static void CopyDirectory(string sourceDir, string destinationDir)
    {
        Directory.CreateDirectory(destinationDir);
        foreach (var file in Directory.GetFiles(sourceDir))
        {
            string dest = Path.Combine(destinationDir, Path.GetFileName(file));
            File.Copy(file, dest, overwrite: true);
        }
        foreach (var sub in Directory.GetDirectories(sourceDir))
        {
            string dest = Path.Combine(destinationDir, Path.GetFileName(sub));
            CopyDirectory(sub, dest);
        }
    }

    private static void WriteSourcesConfig(string targetDir, List<string> urls)
    {
        Directory.CreateDirectory(targetDir);
        string file = Path.Combine(targetDir, "sources_config.json");
        var obj = new { sourceUrls = urls };
        string json = JsonSerializer.Serialize(obj, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(file, json);
    }

    private static void WriteManifest(string targetDir)
    {
        Directory.CreateDirectory(targetDir);
        string file = Path.Combine(targetDir, "torrent_provider.json");
        var manifest = new
        {
            id = "ga-torrent-provider",
            name = "Torrent Source Provider",
            type = "source_provider",
            endpoint = "http://127.0.0.1:45000",
            executable = "Game Access Torrent Provider.exe",
            autostart = true
        };
        string json = JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(file, json);
    }

    private static void WriteExecutionProfiles(string targetDir)
    {
        Directory.CreateDirectory(targetDir);
        string file = Path.Combine(targetDir, "execution-profiles.json");
        if (File.Exists(file)) return; // Don't overwrite user passwords if already present

        var profile = new
        {
            games = new { },
            sources = new { },
            @default = new
            {
                version = 1,
                name = "Perfil opcional del proveedor",
                id = "provider-default",
                archivePasswords = new string[] { "online-fix.me" },
                beforePlay = new object[]
                {
                    new
                    {
                        type = "ini-set",
                        glob = "OnlineFix.ini",
                        section = "Hashes",
                        key = "1337",
                        value = "defa34f9d4e76c16eeb47f057f337934d4e47da373fd5dced397e2db05370865c9a75a0314d14d7fc15f1da4cab85f769ea958825210af06be6c4e253abeaf73"
                    }
                }
            }
        };
        string json = JsonSerializer.Serialize(profile, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(file, json);
    }

    private void LaunchPlugin()
    {
        try
        {
            string targetFolder = Path.Combine(_detection.PluginsPath, "ga-torrent-provider");
            string exe = Path.Combine(targetFolder, "Game Access Torrent Provider.exe");
            if (File.Exists(exe))
            {
                var psi = new ProcessStartInfo
                {
                    FileName = exe,
                    WorkingDirectory = targetFolder,
                    UseShellExecute = true
                };
                Process.Start(psi);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "No se pudo iniciar el ejecutable del plugin: " + ex.Message, "Aviso", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    private class SourceRowItem(CommunitySource source, bool isChecked)
    {
        public CommunitySource Source { get; } = source;
        public bool IsChecked { get; set; } = isChecked;
    }
}
