const fs = require('fs');
let content = fs.readFileSync('apps/launcher/digital_downloader.py', 'utf8');

const targetStr = `    head_resp = requests.head(url, headers=headers, allow_redirects=True, timeout=25)
    head_resp.raise_for_status()
    final_url = head_resp.url
    headers_resp = head_resp.headers`;

const replaceStr = `    head_resp = requests.head(url, headers=headers, allow_redirects=True, timeout=25)
    head_resp.raise_for_status()
    final_url = head_resp.url
    headers_resp = head_resp.headers

    # Comprobar si la redirección nos llevó a un hoster de navegador o si es un HTML
    from urllib.parse import urlparse
    parsed_final = urlparse(final_url)
    browser_domains = [
        "gofile.io", "1fichier.com", "pixeldrain.com", "qiwi.gg", 
        "drive.google.com", "mediafire.com", "mega.nz", "krakenfiles.com"
    ]
    
    is_html = "text/html" in headers_resp.get("content-type", "").lower()
    is_browser_host = any(d in parsed_final.netloc.lower() for d in browser_domains)
    
    if is_browser_host or is_html:
        logger.info(f"Enlace apunta a hoster web o HTML ({final_url}). Abriendo en navegador.")
        import webbrowser
        import sys
        webbrowser.open(final_url)
        emit_progress(
            app_id=app_id,
            phase="external",
            progress_percent=0.0,
            bytes_downloaded=0,
            total_bytes=0,
            status_text="Enlace abierto en el navegador. Esta fuente requiere completar la descarga manualmente."
        )
        sys.exit(50)
`;

content = content.replace(targetStr, replaceStr);
fs.writeFileSync('apps/launcher/digital_downloader.py', content);
console.log('Downloader updated');
