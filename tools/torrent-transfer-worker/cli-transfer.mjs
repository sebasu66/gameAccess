import { transferTorrentToViking, SINTEL_TORRENT_URL } from './src/transfer.mjs'

function parseArgs(argv) {
  const args = { source: '', selector: 'largest', json: false }
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i]
    if (value === '--source') args.source = argv[++i] || ''
    else if (value === '--file') args.selector = argv[++i] || 'largest'
    else if (value === '--sintel') args.source = SINTEL_TORRENT_URL
    else if (value === '--json') args.json = true
    else if (value === '--help' || value === '-h') args.help = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
if (args.help || !args.source) {
  console.log(`Usage:\n  node cli-transfer.mjs --source <magnet-or-torrent-url> [--file largest|index|path] [--json]\n  node cli-transfer.mjs --sintel [--json]\n`)
  process.exit(args.help ? 0 : 2)
}

const status = event => {
  if (!args.json) console.error(`[${event.stage}] ${event.message}`)
}

try {
  const result = await transferTorrentToViking({ source: args.source, selector: args.selector, onStatus: status })
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  const output = { status: 'failed', error: `${error?.name || 'Error'}: ${error?.message || error}` }
  console.error(JSON.stringify(output, null, 2))
  process.exit(1)
}
