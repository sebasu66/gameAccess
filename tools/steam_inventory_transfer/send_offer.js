'use strict';

const fs = require('fs');
const path = require('path');
const SteamUser = require('steam-user');
const TradeOfferManager = require('steam-tradeoffer-manager');

function output(payload, code = 0) {
  process.stdout.write(JSON.stringify(payload) + '\n');
  process.exitCode = code;
}

const planPath = process.argv[2];
const accountName = process.env.GA_STEAM_USER || '';
const password = process.env.GA_STEAM_PASS || '';
const targetSteamId64 = process.env.GA_TRADE_TARGET_STEAMID64 || '';
const tradeUrl = process.env.GA_TRADE_URL || '';

if (!planPath || !fs.existsSync(planPath)) {
  output({status: 'configuration_error', error: 'plan file missing'}, 2);
  return;
}
if (!accountName || !password) {
  output({status: 'configuration_error', error: 'GA_STEAM_USER/GA_STEAM_PASS are required'}, 2);
  return;
}
if (!targetSteamId64 && !tradeUrl) {
  output({status: 'configuration_error', error: 'GA_TRADE_TARGET_STEAMID64 or GA_TRADE_URL is required'}, 2);
  return;
}

let plan;
try {
  plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
} catch (err) {
  output({status: 'configuration_error', error: `invalid plan: ${err.message}`}, 2);
  return;
}

const items = Array.isArray(plan.items) ? plan.items.map((item) => ({
  appid: Number(item.appid),
  contextid: String(item.contextid),
  assetid: String(item.assetid),
  amount: Number(item.amount || 1),
})) : [];

if (items.length === 0) {
  output({status: 'nothing_to_send', item_count: 0}, 0);
  return;
}

const client = new SteamUser({dataDirectory: null});
const manager = new TradeOfferManager({
  steam: client,
  language: 'en',
  pollInterval: -1,
  cancelTime: 0,
  pendingCancelTime: 0,
});

let finished = false;
const timer = setTimeout(() => finish({status: 'timeout', item_count: items.length}, 8), 90000);

function finish(payload, code = 0) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  try { client.logOff(); } catch (_) {}
  output(payload, code);
}

client.on('error', (err) => {
  finish({status: 'steam_error', error: String(err && err.message ? err.message : err), item_count: items.length}, 4);
});

client.on('steamGuard', (domain, callback, lastCodeWrong) => {
  finish({
    status: 'guard_required',
    guard_method: domain ? 'email_code' : 'device_code',
    last_code_wrong: Boolean(lastCodeWrong),
    item_count: items.length,
  }, 3);
});

client.on('webSession', (sessionID, cookies) => {
  manager.setCookies(cookies, (err) => {
    if (err) {
      finish({status: 'web_session_error', error: String(err.message || err), item_count: items.length}, 5);
      return;
    }

    let offer;
    try {
      offer = manager.createOffer(tradeUrl || targetSteamId64);
      offer.addMyItems(items);
      offer.setMessage('GameAccess inventory consolidation');
    } catch (createErr) {
      finish({status: 'offer_create_error', error: String(createErr.message || createErr), item_count: items.length}, 6);
      return;
    }

    offer.send((sendErr, status) => {
      if (sendErr) {
        finish({
          status: 'offer_send_error',
          error: String(sendErr.message || sendErr),
          eresult: sendErr.eresult || null,
          item_count: items.length,
        }, 7);
        return;
      }
      finish({
        status: 'sent',
        send_status: status,
        offer_id: offer.id || null,
        item_count: items.length,
        target_steam_id64: targetSteamId64 || null,
      }, 0);
    });
  });
});

client.logOn({
  accountName,
  password,
  rememberPassword: false,
  machineName: 'GameAccess Inventory Transfer',
});
