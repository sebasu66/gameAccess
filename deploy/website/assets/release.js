// The download button points straight to the installer of the latest release (the same one installed apps update
// to). Without network or with the GitHub API unavailable it keeps its link to the releases page.
(() => {
const link = document.getElementById('installer-link');
const note = document.getElementById('release-note');
if (!link) return;
fetch('https://api.github.com/repos/sebasu66/gameAccess/releases/latest')
  .then(response => (response.ok ? response.json() : Promise.reject(response.status)))
  .then(release => {
    const installer = (release.assets || []).find(asset => /-setup\.exe$/i.test(asset.name));
    if (!installer) return;
    link.href = installer.browser_download_url;
    const version = String(release.tag_name || '').replace(/^gameaccess-v/, '');
    const size = Math.round(installer.size / 1048576);
    if (note && version) {
      note.dataset.i18n = 'dlVersion';
      note.dataset.i18nVars = JSON.stringify({ v: version, size });
      document.dispatchEvent(new Event('ga-i18n-refresh'));
    }
  })
  .catch(() => { /* the releases page link stays */ });
})();
