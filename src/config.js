'use strict';

const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

function json(v, fallback) {
  if (!v) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    console.warn(`[config] could not parse JSON value: ${v}`);
    return fallback;
  }
}

const env = process.env;

const config = {
  port: Number(env.PORT || 3000),
  dataDir: env.DATA_DIR || './data',
  cookieSecure: bool(env.COOKIE_SECURE, false),
  sessionDays: Number(env.SESSION_DAYS || 7),
  checkIntervalSec: Math.max(10, Number(env.CHECK_INTERVAL_SECONDS || 30)),

  admin: {
    username: env.ADMIN_USERNAME || 'admin',
    password: env.ADMIN_PASSWORD || '',
  },

  yeastar: {
    baseUrl: (env.YEASTAR_BASE_URL || '').replace(/\/+$/, ''),
    apiPath: (env.YEASTAR_API_PATH || '/openapi/v1.0').replace(/\/+$/, ''),
    clientId: env.YEASTAR_CLIENT_ID || '',
    clientSecret: env.YEASTAR_CLIENT_SECRET || '',
    insecureTls: bool(env.YEASTAR_INSECURE_TLS, false),
    dryRun: bool(env.YEASTAR_DRY_RUN, false),
    defaultRouteId: env.YEASTAR_INBOUND_ROUTE_ID || '',

    // Field mapping for the inbound route's destination. Defaults match the
    // P-Series Open API; override if your firmware uses different names.
    destField: env.YEASTAR_DEST_FIELD || 'def_dest',
    destValueField: env.YEASTAR_DEST_VALUE_FIELD || 'def_dest_value',
    externalDestType: env.YEASTAR_EXTERNAL_DEST_TYPE || 'external_num',
    numberPrefix: env.YEASTAR_NUMBER_PREFIX || '',
    // Extra fields sent with every "forward to mobile" update, e.g. {"def_dest_prefix":"9"}
    extraFields: json(env.YEASTAR_EXTRA_FIELDS_JSON, {}),
  },
};

if (config.yeastar.insecureTls) {
  // Many on-prem PBXs use self-signed certificates.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

module.exports = config;
