import { useState, useEffect } from "react";
import {
  parseEther,
  createPublicClient,
  http,
  type Hex,
  createWalletClient,
} from "viem";
import {
  createEOAWallet,
  getRelayerWalletClient,
  createEOAClient,
  encodeInitializeArgs,
  createInitializeHash,
  signInitialization,
  type ExtendedAccount,
  localAnvil,
} from "../lib/wallet-utils";
import { EIP7702ProxyAddresses } from "../lib/abi/EIP7702Proxy";
import { odysseyTestnet } from "../lib/chains";
import { VerificationPanel } from "./VerificationPanel";

// Test values
const INITIAL_FUNDING = BigInt(1); // 1 wei

interface WalletManagerProps {
  useAnvil: boolean;
  onWalletCreated: (address: string) => void;
  onUpgradeComplete: (
    address: `0x${string}`,
    upgradeHash: string,
    initHash: string
  ) => void;
  resetKey: number;
  onAccountCreated: (account: ExtendedAccount | null) => void;
}

function formatError(error: any): string {
  let errorMessage = "Failed to upgrade wallet: ";

  if (error.shortMessage) {
    errorMessage += error.shortMessage;
  } else if (error.message) {
    errorMessage += error.message;
  }

  // Check for contract revert reasons
  if (error.data?.message) {
    errorMessage += `\nContract message: ${error.data.message}`;
  }

  return errorMessage;
}

export function WalletManager({ useAnvil }: { useAnvil: boolean }) {
  // TEMPORARY: Skip wallet creation flow and use hardcoded address
  const [smartWalletAddress] = useState<`0x${string}`>(
    "0xdDfA044880512F1D5859d8F9B0d08838480DA02A"
  );
  const [initialized] = useState(true);

  // Comment out unused states for now
  /*
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [smartWalletAddress, setSmartWalletAddress] = useState<`0x${string}` | null>(null);
  const [eoaAddress, setEoaAddress] = useState<`0x${string}` | null>(null);
  */

  // Comment out unused handlers for now
  /*
  const handleCreateEOA = useCallback(async () => {
    // ... existing code ...
  }, [useAnvil]);

  const handleUpgradeWallet = useCallback(async () => {
    // ... existing code ...
  }, [eoaAddress, useAnvil]);
  */

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Wallet Manager</h1>

      {/* Comment out creation flow UI
      {!eoaAddress ? (
        <button
          onClick={handleCreateEOA}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create EOA"}
        </button>
      ) : !smartWalletAddress ? (
        <div>
          <p className="mb-4">EOA Address: {eoaAddress}</p>
          <button
            onClick={handleUpgradeWallet}
            disabled={loading}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? "Upgrading..." : "Upgrade to Smart Wallet"}
          </button>
        </div>
      ) : null}
      */}

      {smartWalletAddress && initialized && (
        <div>
          <p className="mb-4">Smart Wallet Address: {smartWalletAddress}</p>
          <VerificationPanel
            smartWalletAddress={smartWalletAddress}
            useAnvil={useAnvil}
          />
        </div>
      )}

      {/* Comment out error display for now
      {error && (
        <div className="mt-4 p-4 bg-red-100 text-red-700 rounded">
          Error: {error}
        </div>
      )}
      */}
    </div>
  );
}
