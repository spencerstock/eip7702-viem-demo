import { useState } from "react";
import { createPublicClient, formatEther } from "viem";
import { getRelayerWalletClient, localAnvil } from "../lib/wallet-utils";
import { http } from "viem";
import { odysseyTestnet } from "../lib/chains";

// Test values
const TEST_RETURN = BigInt(1); // 1 wei
const EMPTY_CALLDATA = "0x" as const;

interface VerificationPanelProps {
  smartWalletAddress: `0x${string}`;
  useAnvil: boolean;
}

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
}: VerificationPanelProps) {
  const [verificationStatus, setVerificationStatus] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const runVerification = async () => {
    try {
      setLoading(true);
      setVerificationStatus([]);
      const relayerWallet = await getRelayerWalletClient(useAnvil);
      const publicClient = createPublicClient({
        chain: useAnvil ? localAnvil : odysseyTestnet,
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

      // Get the smart wallet's initial balance
      const initialBalance = await publicClient.getBalance({
        address: smartWalletAddress,
      });
      setVerificationStatus((prev) => [
        ...prev,
        `✓ Initial smart wallet balance: ${initialBalance.toString()} wei (${formatEther(
          initialBalance
        )} ETH)`,
      ]);

      // Get the relayer's initial balance
      const initialRelayerBalance = await publicClient.getBalance({
        address: relayerWallet.account.address,
      });
      setVerificationStatus((prev) => [
        ...prev,
        `✓ Initial relayer balance: ${initialRelayerBalance.toString()} wei (${formatEther(
          initialRelayerBalance
        )} ETH)`,
      ]);

      // Test execution by sending ETH back to the relayer
      let execHash: `0x${string}`;
      if (useAnvil && "writeContract" in relayerWallet) {
        execHash = await relayerWallet.writeContract({
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
          args: [relayerWallet.account.address, initialBalance, EMPTY_CALLDATA],
        });
      } else {
        // Use API for Odyssey
        const execResponse = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "execute",
            targetAddress: smartWalletAddress,
            args: {
              target: relayerWallet.account.address,
              value: initialBalance.toString(),
              data: EMPTY_CALLDATA,
            },
          }),
        });

        if (!execResponse.ok) {
          const error = await execResponse.json();
          throw new Error(error.error || "Failed to execute test transaction");
        }
        execHash = (await execResponse.json()).hash;
      }

      setVerificationStatus((prev) => [
        ...prev,
        `✓ Test transaction executed: ${execHash}`,
      ]);

      // Wait for the transaction to be mined
      await publicClient.waitForTransactionReceipt({ hash: execHash });

      // Get the final balances
      const finalWalletBalance = await publicClient.getBalance({
        address: smartWalletAddress,
      });
      const finalRelayerBalance = await publicClient.getBalance({
        address: relayerWallet.account.address,
      });

      setVerificationStatus((prev) => [
        ...prev,
        `✓ Final smart wallet balance: ${finalWalletBalance.toString()} wei (${formatEther(
          finalWalletBalance
        )} ETH)`,
        `✓ Final relayer balance: ${finalRelayerBalance.toString()} wei (${formatEther(
          finalRelayerBalance
        )} ETH)`,
        `✓ Transferred ${initialBalance.toString()} wei (${formatEther(
          initialBalance
        )} ETH) back to relayer`,
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
          <div className="bg-gray-800 text-green-500 p-4 rounded-lg font-mono text-left w-full max-w-5xl mx-auto">
            {verificationStatus.map((status, index) => {
              if (status.includes("transaction executed:")) {
                const [prefix, hash] = status.split(": ");
                return (
                  <div key={index} className="mb-1">
                    {prefix}:{" "}
                    <div className="break-all inline-block">
                      <TransactionHash hash={hash} useAnvil={useAnvil} />
                    </div>
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
