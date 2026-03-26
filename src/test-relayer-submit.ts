// Manual Relayer submit test
// Usage:
//   npm run test:relayer-submit
//
// Configure env vars:
//   RELAYER_SUBMIT_REQUEST_JSON: JSON string matching RelayerSubmitRequest
//   RELAYER_AUTH_MODE: 'builder' or 'relayer'
//
// Note: For builder auth, you must provide POLY_BUILDER_TIMESTAMP + POLY_BUILDER_SIGNATURE
// exactly as required by the Polymarket Relayer docs.

import 'dotenv/config';
import { submitRelayerTransaction, RelayerAuth, RelayerSubmitRequest } from './relayer';
import { logger, setLogLevel } from './logger';

const COMPONENT = 'RelayerTest';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '' || v.includes('your_')) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

async function main(): Promise<void> {
  setLogLevel('debug');
  logger.banner('POLYMARKET RELAYER SUBMIT TEST');

  const mode = (process.env.RELAYER_AUTH_MODE ?? 'builder').toLowerCase();

  let auth: RelayerAuth;
  if (mode === 'builder') {
    auth = {
      type: 'builder',
      polyBuilderApiKey: requireEnv('POLY_BUILDER_API_KEY'),
      polyBuilderTimestamp: requireEnv('POLY_BUILDER_TIMESTAMP'),
      polyBuilderPassphrase: requireEnv('POLY_BUILDER_PASSPHRASE'),
      polyBuilderSignature: requireEnv('POLY_BUILDER_SIGNATURE'),
    };
  } else if (mode === 'relayer') {
    auth = {
      type: 'relayer',
      relayerApiKey: requireEnv('RELAYER_API_KEY'),
      relayerApiKeyAddress: requireEnv('RELAYER_API_KEY_ADDRESS'),
    };
  } else {
    throw new Error(`RELAYER_AUTH_MODE must be 'builder' or 'relayer', got: ${process.env.RELAYER_AUTH_MODE}`);
  }

  const requestJson = requireEnv('RELAYER_SUBMIT_REQUEST_JSON');
  const request = JSON.parse(requestJson) as RelayerSubmitRequest;

  logger.info(COMPONENT, `Submitting to ${process.env.RELAYER_SUBMIT_URL ?? 'https://relayer-v2.polymarket.com/submit'}`);

  const resp = await submitRelayerTransaction({
    submitUrl: process.env.RELAYER_SUBMIT_URL ?? undefined,
    auth,
    request,
  });

  logger.info(COMPONENT, `✅ Relayer response: ${JSON.stringify(resp)}`);
}

main().catch((err) => {
  logger.error(COMPONENT, `❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

