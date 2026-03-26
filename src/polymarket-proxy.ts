// ============================================
// Polymarket Gnosis Safe proxy (funder) address
// ============================================
// Docs: https://docs.polymarket.com/resources/contract-addresses
// On-chain: SafeProxyFactory.computeProxyAddress(owner)

import { getAddress, Interface } from 'ethers';

/** Polygon mainnet — Gnosis Safe factory (Polymarket docs); lowercase avoids bad EIP-55 in docs */
export const GNOSIS_SAFE_FACTORY_POLYGON = '0xaacfeea03eb1561c4e67d661e40682bd20e3541b';

const FACTORY_IFACE = new Interface([
  'function computeProxyAddress(address user) view returns (address)',
]);

/** Polygon JSON-RPC POST helper (shared for balance reads, factory views, etc.) */
export async function polygonJsonRpc<T = string>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const url = rpcUrl.trim();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error?.message) throw new Error(j.error.message);
  return j.result as T;
}

export interface DetectedClobSigning {
  signatureType: number;
  funderAddress?: string;
}

/**
 * Polymarket's default accounts use a Gnosis Safe proxy at the address returned by
 * SafeProxyFactory.computeProxyAddress(eoa). The CLOB expects signatureType 2 and
 * maker = that proxy — even if the proxy is not deployed on-chain yet (first login / deposit).
 *
 * Pure MetaMask EOA traders must set POLY_SIGNATURE_TYPE=EOA in .env.
 * Magic/email wallets need POLY_SIGNATURE_TYPE=POLY_PROXY and FUNDER_ADDRESS from the UI.
 */
export async function detectClobSigningFromChain(
  eoaAddress: string,
  rpcUrl: string
): Promise<DetectedClobSigning> {
  const url = rpcUrl.trim();
  if (!url.startsWith('http')) throw new Error('POLYGON_RPC_URL must be an http(s) JSON-RPC URL');

  const eoa = getAddress(eoaAddress);
  const data = FACTORY_IFACE.encodeFunctionData('computeProxyAddress', [eoa]);
  const factory = getAddress(GNOSIS_SAFE_FACTORY_POLYGON).toLowerCase();
  const raw = await polygonJsonRpc<string>(url, 'eth_call', [{ to: factory, data }, 'latest']);
  const proxy = FACTORY_IFACE.decodeFunctionResult('computeProxyAddress', raw)[0] as string;
  const proxyAddr = getAddress(proxy);
  return { signatureType: 2, funderAddress: proxyAddr };
}
