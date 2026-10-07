import pathlib
p = pathlib.Path('apps/desktop/src/LibraryRoom.tsx')
c = p.read_text('utf-8')
target = '''        const status = getCatalogMode() === "digital" && selectedGame
          ? await digitalCatalogService.getStatus(selectedGame)
          : await steamDownloadStatus(selectedAppId);'''
replacement = '''        const isDigitalGame = selectedGame && (getCatalogMode() === "digital" || Boolean(digitalCatalogService.getRecord(selectedGame.id)) || Boolean(selectedGame.app_id && digitalCatalogService.getRecord(selectedGame.app_id)));
        const status = isDigitalGame
          ? await digitalCatalogService.getStatus(selectedGame!)
          : await steamDownloadStatus(selectedAppId);'''
c = c.replace(target, replacement)
p.write_text(c, 'utf-8')
