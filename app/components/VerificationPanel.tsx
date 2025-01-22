import { useState, useCallback } from "react";
import {
  createPublicClient,
  formatEther,
  parseEther,
  http,
  type Address,
} from "viem";
import { getRelayerWalletClient, localAnvil } from "../lib/wallet-utils";
import { odysseyTestnet } from "../lib/chains";
import { EntryPointAddress, EntryPointAbi } from "../lib/abi/EntryPoint";
import {
  getSmartAccountClient,
  createAndSignUserOp,
  ensureEntryPointDeposit,
  submitUserOp,
  withdrawEntryPointDeposit,
} from "../lib/smart-account";
import { type UserOperation } from "viem/account-abstraction";

// Test values
const TEST_RETURN = BigInt(1); // 1 wei
const EMPTY_CALLDATA = "0x" as const;
const REQUIRED_DEPOSIT = BigInt(1e16); // 0.01 ETH should be enough for gas costs

type VerificationPanelProps = {
  smartWalletAddress: `0x${string}`;
  useAnvil: boolean;
  onStatus?: (status: string) => void;
};

function formatExplorerLink(hash: string, useAnvil: boolean): string | null {
  if (useAnvil) {
    return null;
  }
  return `${odysseyTestnet.blockExplorers.default.url}/tx/${hash}`;
}

function TransactionHash({
  hash,
  useAnvil,
}: {
  hash: string;
  useAnvil: boolean;
}) {
  const link = formatExplorerLink(hash, useAnvil);
  if (!link) {
    return <span className="font-mono">{hash}</span>;
  }
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 hover:text-blue-300 underline font-mono"
    >
      {hash}
    </a>
  );
}

export function VerificationPanel({
  smartWalletAddress,
  useAnvil,
  onStatus,
}: VerificationPanelProps) {
  const [verificationStatus, setVerificationStatus] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [relayerAddress, setRelayerAddress] = useState<`0x${string}` | null>(
    process.env.NEXT_PUBLIC_RELAYER_ADDRESS as `0x${string}`
  );

  const addStatus = (status: string) => {
    setVerificationStatus((prev) => [...prev, status]);
    if (onStatus) {
      onStatus(status);
    }
  };

  const handleVerify = useCallback(async () => {
    try {
      setLoading(true);

      // Call the API to handle verification
      const response = await fetch("/api/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          smartWalletAddress,
          useAnvil,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }

      const { status } = await response.json();
      status.forEach(addStatus);
      setVerified(true);
    } catch (error) {
      console.error("Verification failed:", error);
      addStatus(`Verification failed: ${error}`);
    } finally {
      setLoading(false);
    }
  }, [smartWalletAddress, useAnvil, addStatus]);

  return (
    <div className="mt-4 text-center">
      <button
        onClick={handleVerify}
        disabled={loading || verified}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 mb-4"
      >
        {loading ? "Verifying..." : verified ? "Verified" : "Verify Ownership"}
      </button>

      {verificationStatus.length > 0 && (
        <div>
          <p className="mb-2">Verification Status:</p>
          <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-left">
            {verificationStatus.map((status, index) => {
              if (
                status.includes("transaction executed:") ||
                status.includes("Transaction hash:") ||
                status.includes("UserOperation hash:")
              ) {
                const [prefix, hash] = status.split(": ");
                return (
                  <div key={index} className="mb-1">
                    {prefix}:{" "}
                    <TransactionHash hash={hash} useAnvil={useAnvil} />
                  </div>
                );
              }
              return (
                <div key={index} className="mb-1">
                  {status}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
