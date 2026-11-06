const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
function isOrphan(record) {
  if (record.kind === 'child') return record.parentMissing === true;
  return record.ageSeconds >= 15 && (!record.hasWindow || !record.ports.length || (record.ageSeconds >= 30 && !record.responding));
}
async function recoverOrphans({ app, log }) {
  if (process.platform !== 'win32') return;
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'instance-processes.ps1'), '-PluginDirectory', app.getAppPath(),
    '-Executable', process.execPath, '-UserDataDirectory', app.getPath('userData'),
    '-SelfPid', String(process.pid)];
  if (app.isPackaged) args.push('-Packaged');
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    const result = await execute(powershell, [...args, '-Mode', 'Inspect'], { windowsHide: true, timeout: 15000 });
    const records = JSON.parse(result.stdout.trim() || '[]');
    for (const record of records.filter(isOrphan)) {
      const result = await execute(powershell, [...args, '-Mode', 'Terminate', '-CandidatePid',
        String(record.pid), '-ExpectedCreationTicks', record.creationTicks], { windowsHide: true, timeout: 15000 });
      log.info('[Startup] Verified old plugin process recovery: ' + result.stdout.trim());
    }
  } catch (error) { log.warn('[Startup] Orphan inspection could not finish: ' + error.message); }
}
async function listenAvailable(createServer, preferredPort = 45000, previousPort, log = console) {
  const previous = Number(previousPort);
  const ports = [...new Set([preferredPort, ...(Number.isInteger(previous) && previous > 0 && previous < 65536 ? [previous] : []), 0])];
  for (const port of ports) {
    const candidate = createServer();
    try {
      await new Promise((resolve, reject) => {
        candidate.once('error', reject);
        candidate.once('listening', () => { candidate.removeListener('error', reject); resolve(); });
        candidate.listen({ port, host: '127.0.0.1', exclusive: true });
      });
      return candidate;
    } catch (error) {
      if (!['EADDRINUSE', 'EACCES'].includes(error.code)) throw error;
      log.warn('[Startup] Port ' + port + ' unavailable; choosing another local port.');
    }
  }
  throw new Error('No se pudo abrir un puerto local para el plugin.');
}
function removeOwnedFile(file, instanceId) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.instanceId === instanceId) fs.unlinkSync(file);
  } catch { /* Missing, stale or another running instance owns it. */ }
}
module.exports = { recoverOrphans, isOrphan, listenAvailable, removeOwnedFile };
