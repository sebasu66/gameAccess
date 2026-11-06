---
tipo: procedimiento
actualizado: 2026-10-22
---
# Cómo sacar una versión nueva (release con auto-update)

> Armado con la primera release real (`gameaccess-v0.1.0` y `gameaccess-v0.1.1`, 2026-10-22). Cada paso que toca `main`, un tag o la promoción lo aprueba Seba. Registrá cada release en [[Log]].

## Cómo funciona
- **Solo se actualizan las versiones `release`.** Las compila el workflow `.github/workflows/windows-installer.yml` cuando se sube un tag `gameaccess-v*` que apunta a un commit que ya está en `main`. Las compilaciones de `dev` (y las locales) son canal `dev` y nunca se actualizan solas.
- Una versión `release` consulta al arrancar `https://github.com/sebasu66/gameAccess/releases/latest/download/latest.json`. Si hay una versión más nueva firmada, la descarga, la instala sin preguntar y reinicia (obligatoria). Sin red o con 404, sigue con la versión que tiene. Si la interfaz no arranca en un minuto, la parte nativa (`app_update.rs`) busca e instala la actualización igual.
- El tag publica la versión como **pre-release**: nadie la ve. Recién al **promoverla** (workflow "Promote release to players") pasa a ser la "latest" y la toman las apps instaladas al abrirse.
- Firma: secreto `TAURI_SIGNING_PRIVATE_KEY` del repo (cargado el 2026-10-22), con el contenido de `%USERPROFILE%\.tauri\gameaccess-updater.key` de la PC de Seba. La clave no tiene contraseña, así que `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` no hace falta. La clave pública está en `apps/desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). **La clave privada nunca va al código**, ni encriptada: quien la tenga puede instalar lo que quiera en todas las PC.
- El updater solo instala versiones **más nuevas**. Para deshacer una release mala no se vuelve atrás: se saca otra versión más alta con el arreglo.

## Pasos
1. **Todo verificado en `dev`**: tests (`npx vitest run`, `npx tsc --noEmit -p tsconfig.json`, pytest del launcher) y el build de `dev` en verde en Actions.
2. **Subir la versión** en los 5 lugares, misma versión en todos (solo cambia esa línea):
   - `apps/desktop/package.json` (`"version"`)
   - `apps/desktop/package-lock.json` (las 2 primeras `"version"`)
   - `apps/desktop/src-tauri/tauri.conf.json` (`"version"`): es la que compara el updater
   - `apps/desktop/src-tauri/Cargo.toml` (`version`)
   - `apps/desktop/src-tauri/Cargo.lock` (bloque `name = "gameaccess-desktop"`)

   Commit y push en `dev`.
3. **Pasar `dev` a `main`** (aprueba Seba), con un merge normal, sin force. Sin cambiar de rama en el checkout compartido:
   ```bash
   git fetch origin dev
   MAIN=$(git ls-remote origin refs/heads/main | cut -f1)   # no confiar en origin/main: este checkout solo trae dev
   git fetch origin "+refs/heads/main:refs/remotes/origin/main"
   TREE=$(git merge-tree --write-tree $MAIN origin/dev)      # si informa conflictos, parar
   C=$(printf 'Merge dev into main for gameaccess-vX.Y.Z\n' | git commit-tree $TREE -p $MAIN -p origin/dev)
   git push origin $C:refs/heads/main
   ```
4. **Tag** (aprueba Seba). El nombre tiene que coincidir con la versión del paso 2, si no el workflow lo rechaza:
   ```bash
   git tag -a gameaccess-vX.Y.Z $C -m "Game Access vX.Y.Z"
   git push origin refs/tags/gameaccess-vX.Y.Z
   ```
5. **Esperar el build** (~10 min): `gh run list --repo sebasu66/gameAccess --workflow windows-installer.yml --limit 3`. Compila firmado, revisa el contenido del instalador, instala y corre `--self-test`, prueba que actualizar encima de la release anterior conserva los datos del jugador, y publica la pre-release con `gameAccess_X.Y.Z_x64-setup.exe`, su `.sig` y `latest.json`.
6. **Probar la pre-release a mano** (opcional pero recomendado): bajar el instalador de la página de la release e instalarlo en una PC de prueba.
7. **Promover** (aprueba Seba): Actions → "Promote release to players" → tag `gameaccess-vX.Y.Z`. O por consola, con la cuenta de Seba:
   ```bash
   GH_TOKEN="$(gh auth token --user sebasu66)" gh workflow run promote-release.yml --repo sebasu66/gameAccess -f tag=gameaccess-vX.Y.Z
   ```
8. **Verificar**: `https://github.com/sebasu66/gameAccess/releases/latest/download/latest.json` responde con la versión nueva. En una PC con la release anterior instalada, abrir Game Access: aparece la actualización, se instala y reinicia. Después:
   ```powershell
   $env:GAMEACCESS_SELF_TEST_OUT = "$env:TEMP\ga-selftest.json"
   Start-Process "C:\gameAccess\gameaccess-desktop.exe" -ArgumentList "--self-test" -Wait
   Get-Content "$env:TEMP\ga-selftest.json"   # versión nueva, "channel":"release", "ok":true
   ```
   y las líneas `[UPDATE]` en `%LOCALAPPDATA%\gameAccess\logs\gameaccess.log`.
9. Registrar en [[Log]]: versión, commit de `main`, tag, número de run y resultado de la verificación.

## Cosas que aprendimos
- **Cuenta de GitHub**: en esta PC `gh` tiene activa Gizi789, que no tiene permiso en este repo (y no se usa acá). Para comandos de `gh` que escriben en el repo, usar `GH_TOKEN="$(gh auth token --user sebasu66)"` en ese comando, sin cambiar la cuenta activa. `git push` ya usa la de Seba.
- **Dónde se instala**: el instalador release va a `C:\gameAccess`. Una instalación vieja de `dev` en `C:\Program Files\gameAccess` queda aparte (y sale de "Agregar o quitar programas"); se puede borrar después. Los datos del jugador están en `%LOCALAPPDATA%\gameAccess` y no se tocan.
- **Primera release**: sin ninguna release anterior, la descarga de la release previa falla a propósito; desde `2dcf44f` el workflow pone `$global:LASTEXITCODE = 0` para que eso no corte el paso (el PowerShell de Actions devuelve el último código de un programa externo).
- **Un tag que falló y no publicó nada** se puede borrar y recrear sobre el commit arreglado (`git push origin :refs/tags/<tag>`, revisar antes con `gh release view <tag>` que no haya release). Uno que ya publicó o se promovió no se toca: se sube la versión.
- **El repo tiene que seguir público** mientras la app lea de GitHub sin autenticarse: `latest.json` (auto-update), `backend-pointer.json` (dirección del servidor), el catálogo y sus actualizaciones (`deploy/catalog-cache`) y los avisos (`announcements.json`). Pasarlo a privado rompe todo eso en las apps instaladas; antes habría que mudar esos archivos a un lugar público.
