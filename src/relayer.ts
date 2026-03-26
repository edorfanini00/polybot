// Polymarket Relayer client — submit gasless Safe/Proxy transactions
// Docs: https://docs.polymarket.com/api-reference/relayer/submit-a-transaction

export type RelayerTxType = 'SAFE' | 'PROXY';

export interface RelayerSignatureParams {
  gasPrice: string;
  operation: string;
  safeTxnGas: string;
  baseGas: string;
  gasToken: string;
  refundReceiver: string;
}

export interface RelayerSubmitRequest {
  from: string;
  to: string;
  proxyWallet: string;
  data: string;
  nonce: string;
  signature: string;
  signatureParams: RelayerSignatureParams;
  type: RelayerTxType;
}

export type RelayerAuth =
  | {
      type: 'builder';
      polyBuilderApiKey: string;
      polyBuilderTimestamp: string;
      polyBuilderPassphrase: string; // -> POLY_BUILDER_PASSPHRASE header
      polyBuilderSignature: string; // -> POLY_BUILDER_SIGNATURE header (HMAC-SHA256)
    }
  | {
      type: 'relayer';
      relayerApiKey: string;
      relayerApiKeyAddress: string; // -> RELAYER_API_KEY_ADDRESS header
    };

function assertNonEmpty(name: string, value: string): void {
  if (!value || value.trim() === '') throw new Error(`Missing required value: ${name}`);
}

export async function submitRelayerTransaction(params: {
  submitUrl?: string; // default per docs: https://relayer-v2.polymarket.com/submit
  auth: RelayerAuth;
  request: RelayerSubmitRequest;
}): Promise<{ transactionID: string; transactionHash: string; state: string }> {
  const { auth, request } = params;
  const submitUrl = params.submitUrl ?? 'https://relayer-v2.polymarket.com/submit';

  // Basic request validation (the relayer itself still does full validation)
  for (const key of ['from', 'to', 'proxyWallet', 'data', 'nonce', 'signature'] as const) {
    assertNonEmpty(key, request[key]);
  }
  assertNonEmpty('signatureParams.gasPrice', request.signatureParams.gasPrice);
  assertNonEmpty('signatureParams.operation', request.signatureParams.operation);
  assertNonEmpty('signatureParams.safeTxnGas', request.signatureParams.safeTxnGas);
  assertNonEmpty('signatureParams.baseGas', request.signatureParams.baseGas);
  assertNonEmpty('signatureParams.gasToken', request.signatureParams.gasToken);
  assertNonEmpty('signatureParams.refundReceiver', request.signatureParams.refundReceiver);
  assertNonEmpty('type', request.type);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };

  if (auth.type === 'builder') {
    assertNonEmpty('POLY_BUILDER_API_KEY', auth.polyBuilderApiKey);
    assertNonEmpty('POLY_BUILDER_TIMESTAMP', auth.polyBuilderTimestamp);
    assertNonEmpty('POLY_BUILDER_PASSPHRASE', auth.polyBuilderPassphrase);
    assertNonEmpty('POLY_BUILDER_SIGNATURE', auth.polyBuilderSignature);

    // Header names must match docs exactly.
    headers['POLY_BUILDER_API_KEY'] = auth.polyBuilderApiKey;
    headers['POLY_BUILDER_TIMESTAMP'] = auth.polyBuilderTimestamp;
    headers['POLY_BUILDER_PASSPHRASE'] = auth.polyBuilderPassphrase;
    headers['POLY_BUILDER_SIGNATURE'] = auth.polyBuilderSignature;
  } else {
    assertNonEmpty('RELAYER_API_KEY', auth.relayerApiKey);
    assertNonEmpty('RELAYER_API_KEY_ADDRESS', auth.relayerApiKeyAddress);

    headers['RELAYER_API_KEY'] = auth.relayerApiKey;
    headers['RELAYER_API_KEY_ADDRESS'] = auth.relayerApiKeyAddress;
  }

  const res = await fetch(submitUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Relayer submission failed: HTTP ${res.status} ${text || ''}`.trim());
  }

  const data = (await res.json()) as {
    transactionID: string;
    transactionHash: string;
    state: string;
  };

  return data;
}

