import {
  isConnected,
  requestAccess,
  getNetworkDetails,
  signTransaction,
} from "@stellar/freighter-api";

export interface WalletConnection {
  publicKey: string;
  network: string;
  networkPassphrase: string;
}

/**
 * Connect to the Freighter extension. Freighter signs the *outer* Stellar
 * transactions only — spending keys, viewing keys, and plaintext amounts are
 * managed by Attesta locally (see keys.ts) and are never part of what
 * Freighter sees or signs.
 */
export async function connectFreighter(): Promise<WalletConnection> {
  const connected = await isConnected();
  if (connected.error || !connected.isConnected) {
    throw new Error("Freighter is not installed or not available.");
  }

  const access = await requestAccess();
  if (access.error || !access.address) {
    throw new Error(access.error?.message ?? "Freighter access was denied.");
  }

  const details = await getNetworkDetails();
  if (details.error) {
    throw new Error(details.error.message);
  }

  return {
    publicKey: access.address,
    network: details.network,
    networkPassphrase: details.networkPassphrase,
  };
}

/** Sign a built transaction envelope (XDR) with Freighter. */
export async function signWithFreighter(
  xdr: string,
  networkPassphrase: string,
): Promise<string> {
  const result = await signTransaction(xdr, { networkPassphrase });
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result.signedTxXdr;
}
