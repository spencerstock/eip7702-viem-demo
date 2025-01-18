import { useState, useEffect } from "react";
import { parseEther, createPublicClient, http, type Hex } from "viem";
import {
  createEOAWallet,
  getRelayerWalletClient,
  createEOAClient,
  encodeInitializeArgs,
  createInitializeHash,
  localAnvil,
  signInitialization,
} from "../lib/wallet-utils";
import { EIP7702ProxyAddresses } from "../lib/abi/EIP7702Proxy";

// Test values
const INITIAL_FUNDING = parseEther("0.0001");

interface WalletManagerProps {
  useAnvil: boolean;
  onWalletCreated: (address: string) => void;
  onUpgradeComplete: (address: `0x${string}`, txHash: string) => void;
  resetKey: number;
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

export function WalletManager({
  useAnvil,
  onWalletCreated,
  onUpgradeComplete,
  resetKey,
}: WalletManagerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<ReturnType<
    typeof createEOAWallet
  > | null>(null);

  // Reset internal state when resetKey changes
  useEffect(() => {
    setLoading(false);
    setError(null);
    setAccount(null);
  }, [resetKey]);

  const handleCreateEOA = async () => {
    try {
      setLoading(true);
      setError(null);
      const newAccount = createEOAWallet();
      setAccount(newAccount);
      onWalletCreated(newAccount.address);
    } catch (error) {
      console.error("Error creating EOA:", error);
      setError("Failed to create EOA wallet");
    } finally {
      setLoading(false);
    }
  };

  const handleUpgradeWallet = async () => {
    if (!account) return;

    try {
      setLoading(true);
      setError(null);

      console.log("\n=== Starting wallet upgrade process ===");
      console.log("EOA address:", account.address);

      // Create user's wallet client for signing
      const userWallet = createEOAClient(account, useAnvil);

      // Get the relayer wallet for submitting the transaction
      const relayerWallet = await getRelayerWalletClient(useAnvil);
      console.log("Relayer address:", relayerWallet.account.address);

      // Create public client for reading state
      const publicClient = createPublicClient({
        chain: localAnvil,
        transport: http(),
      });

      // Get the proxy address based on network
      const proxyAddress = useAnvil
        ? EIP7702ProxyAddresses.anvil
        : EIP7702ProxyAddresses.baseSepolia;
      console.log("Proxy template address:", proxyAddress);

      // Create the authorization signature
      console.log("\nSigning authorization object...");
      const authorization = await userWallet.signAuthorization({
        contractAddress: proxyAddress,
        sponsor: relayerWallet.account.address,
      });

      // Create initialization args with the relayer as the new owner
      console.log("\nPreparing initialization data and signature...");
      const initArgs = encodeInitializeArgs(
        relayerWallet.account.address as Hex
      );
      const initHash = createInitializeHash(proxyAddress, initArgs);
      const signature = await signInitialization(userWallet, initHash);

      // Submit the upgrade transaction
      console.log("\nSubmitting upgrade transaction...");
      const hash = await relayerWallet.sendTransaction({
        to: account.address as `0x${string}`,

        value: INITIAL_FUNDING,
        authorizationList: [authorization],
      });
      console.log("✓ Upgrade transaction submitted");

      // Check the transaction receipt
      const receipt = await publicClient.getTransactionReceipt({
        hash: hash,
      });
      if (receipt.status === "success") {
        console.log("✓ Upgrade transaction confirmed");
      }

      // Check if the code was deployed
      console.log("\nVerifying deployment...");
      const code = await publicClient.getCode({ address: account.address });

      if (code && code !== "0x") {
        console.log("✓ Code deployed successfully");
        console.log("\n=== Wallet upgrade complete ===");
        console.log("Smart wallet address:", account.address);
        console.log("Owner address:", relayerWallet.account.address);
      } else {
        console.log("✗ Code deployment failed");
        throw new Error("Code deployment failed");
      }

      const initTxnHash = await relayerWallet.writeContract({
        address: account.address as `0x${string}`,
        abi: [
          {
            type: "function",
            name: "initialize",
            inputs: [
              { name: "args", type: "bytes" },
              { name: "signature", type: "bytes" },
            ],
            outputs: [],
            stateMutability: "payable",
          },
        ],
        functionName: "initialize",
        args: [initArgs, signature],
      });
      console.log("✓ Initialization transaction submitted");
      const initReceipt = await publicClient.waitForTransactionReceipt({
        hash: initTxnHash,
      });
      if (initReceipt.status === "success") {
        console.log("✓ Initialization transaction confirmed");
      } else {
        console.log("✗ Initialization transaction failed");
        throw new Error("Initialization transaction failed");
      }

      onUpgradeComplete(account.address as `0x${string}`, hash);
    } catch (error: any) {
      console.error("Upgrade failed:", error);
      setError(formatError(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {!account && (
        <button
          onClick={handleCreateEOA}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create new EOA Wallet"}
        </button>
      )}

      {account && (
        <button
          onClick={handleUpgradeWallet}
          disabled={loading}
          className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50"
        >
          {loading ? "Upgrading..." : "Upgrade EOA to Smart Wallet"}
        </button>
      )}

      {error && (
        <div className="mt-4 text-center text-red-500">
          <pre className="whitespace-pre-wrap text-left text-sm">{error}</pre>
        </div>
      )}
    </div>
  );
}
