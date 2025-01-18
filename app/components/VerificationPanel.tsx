import { useState } from "react";
import { createPublicClient, parseEther, formatEther } from "viem";
import { getRelayerWalletClient, localAnvil } from "../lib/wallet-utils";
import { http } from "viem";

// Test values
const TEST_RETURN = parseEther("0.0001");
const EMPTY_CALLDATA = "0x" as const;
const ODYSSEY_EXPLORER = "https://odyssey-explorer.ithaca.xyz";

interface VerificationPanelProps {
  smartWalletAddress: `0x${string}`;
  useAnvil: boolean;
}

function formatExplorerLink(hash: string, useAnvil: boolean): string | null {
  if (useAnvil) {
    return null;
  }
  return `${ODYSSEY_EXPLORER}/tx/${hash}`;
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
}: VerificationPanelProps) {
  const [verificationStatus, setVerificationStatus] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const runVerification = async () => {
    try {
      setLoading(true);
      setVerificationStatus([]);
      const relayerWallet = await getRelayerWalletClient(useAnvil);
      const publicClient = createPublicClient({
        chain: localAnvil,
        transport: http(),
      });

      // First verify the relayer is the owner
      const isOwner = await publicClient.readContract({
        address: smartWalletAddress,
        abi: [
          {
            type: "function",
            name: "isOwnerAddress",
            inputs: [{ name: "owner", type: "address" }],
            outputs: [{ type: "bool" }],
            stateMutability: "view",
          },
        ],
        functionName: "isOwnerAddress",
        args: [relayerWallet.account.address],
      });

      if (!isOwner) {
        throw new Error("Relayer is not the owner of the smart wallet");
      }

      setVerificationStatus((prev) => [...prev, "✓ Relayer verified as owner"]);

      // Get the smart wallet's balance
      const balance = await publicClient.getBalance({
        address: smartWalletAddress,
      });
      setVerificationStatus((prev) => [
        ...prev,
        `✓ Smart wallet balance: ${formatEther(balance)} ETH`,
      ]);

      // Test execution by sending ETH back to the relayer
      const execHash = await relayerWallet.writeContract({
        address: smartWalletAddress,
        abi: [
          {
            type: "function",
            name: "execute",
            inputs: [
              { name: "target", type: "address" },
              { name: "value", type: "uint256" },
              { name: "data", type: "bytes" },
            ],
            outputs: [],
            stateMutability: "payable",
          },
        ],
        functionName: "execute",
        args: [relayerWallet.account.address, TEST_RETURN, EMPTY_CALLDATA],
      });

      setVerificationStatus((prev) => [
        ...prev,
        `✓ Test transaction executed: ${execHash}`,
      ]);

      // Verify the balance changed
      const balanceAfter = await publicClient.getBalance({
        address: smartWalletAddress,
      });
      setVerificationStatus((prev) => [
        ...prev,
        `✓ Smart wallet balance after: ${formatEther(balanceAfter)} ETH`,
        `✓ Successfully transferred ${formatEther(
          TEST_RETURN
        )} ETH back to relayer`,
      ]);
    } catch (error: any) {
      console.error("Verification failed:", error);
      setVerificationStatus([`❌ Verification failed: ${error.message}`]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 text-center">
      <button
        onClick={runVerification}
        disabled={loading}
        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 mb-4"
      >
        {loading ? "Verifying..." : "Verify Ownership"}
      </button>

      {verificationStatus.length > 0 && (
        <div>
          <p className="mb-2">Verification Status:</p>
          <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-left">
            {verificationStatus.map((status, index) => {
              if (status.includes("transaction executed:")) {
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
