import { useState, useEffect } from "react";
import { createPublicClient, http, type Hex } from "viem";
import {
  createEOAWallet,
  getRelayerWalletClient,
  createEOAClient,
  encodeInitializeArgs,
  createSetImplementationHash,
  signSetImplementation,
  type ExtendedAccount,
  localAnvil,
} from "../lib/wallet-utils";
import { EIP7702ProxyAddresses } from "../lib/abi/EIP7702Proxy";
import { odysseyTestnet } from "../lib/chains";
import {
  createWebAuthnCredential,
  type P256Credential,
} from "viem/account-abstraction";
import {
  NEW_IMPLEMENTATION_ADDRESS,
  ZERO_ADDRESS,
} from "../lib/contracts";

interface WalletManagerProps {
  useAnvil: boolean;
  onWalletCreated: (address: string, explorerLink: string | null) => void;
  onUpgradeComplete: (
    address: `0x${string}`,
    upgradeHash: string,
    code: string
  ) => void;
  resetKey: number;
  onAccountCreated: (account: ExtendedAccount | null) => void;
  onPasskeyStored: (passkey: P256Credential) => void;
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

function formatExplorerLink(hash: string, useAnvil: boolean, type: 'transaction' | 'address' = 'transaction'): string | null {
  if (useAnvil) {
    return null;
  }
  return `${odysseyTestnet.blockExplorers.default.url}/${type}/${hash}`;
}

export function WalletManager({
  useAnvil,
  onWalletCreated,
  onUpgradeComplete,
  resetKey,
  onAccountCreated,
  onPasskeyStored,
}: WalletManagerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<ExtendedAccount | null>(null);
  const [isUpgraded, setIsUpgraded] = useState(false);
  const [status, setStatus] = useState<string>("");

  // Reset internal state when resetKey changes
  useEffect(() => {
    setLoading(false);
    setError(null);
    setAccount(null);
    setIsUpgraded(false);
    setStatus("");
  }, [resetKey]);

  const handleCreateEOA = async () => {
    try {
      setLoading(true);
      setError(null);
      const newAccount = await createEOAWallet();
      setAccount(newAccount);
      const explorerLink = formatExplorerLink(newAccount.address, useAnvil, 'address');
      onWalletCreated(newAccount.address, explorerLink);
      onAccountCreated(newAccount);
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
      setStatus("Starting wallet upgrade process...");

      console.log("\n=== Starting wallet upgrade process ===");
      console.log("EOA address:", account.address);

      // Create user's wallet client for signing
      const userWallet = createEOAClient(account, useAnvil);

      // Create public client for reading state
      const publicClient = createPublicClient({
        chain: useAnvil ? localAnvil : odysseyTestnet,
        transport: http(),
      });

      // Get the proxy address based on network
      const proxyAddress = useAnvil
        ? EIP7702ProxyAddresses.anvil
        : EIP7702ProxyAddresses.odyssey;
      console.log("Proxy template address:", proxyAddress);

      // Create a new passkey
      setStatus("Creating new passkey...");
      const passkey = await createWebAuthnCredential({
        name: "Smart Wallet Owner",
      });
      onPasskeyStored(passkey);

      // Create initialization args with both relayer and passkey as owners
      setStatus("Preparing initialization data and signature...");
      const initArgs = encodeInitializeArgs([
        useAnvil
          ? ((await getRelayerWalletClient(true)).account.address as Hex)
          : (process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Hex),
        passkey,
      ]);

      // Create the setImplementation hash
      const chainId = useAnvil ? localAnvil.id : odysseyTestnet.id;
      const setImplementationHash = createSetImplementationHash(
        proxyAddress,
        NEW_IMPLEMENTATION_ADDRESS,
        initArgs,
        BigInt(0), // nonce
        ZERO_ADDRESS, // currentImplementation
        false, // allowCrossChainReplay
        BigInt(chainId)
      );

      // Sign the hash
      const signature = await signSetImplementation(userWallet, setImplementationHash);

      // Create the authorization signature for EIP-7702
      setStatus("Creating authorization signature...");
      const authorization = await userWallet.signAuthorization({
        contractAddress: proxyAddress,
        sponsor: useAnvil
          ? (
              await getRelayerWalletClient(true)
            ).account.address
          : (process.env.NEXT_PUBLIC_RELAYER_ADDRESS as `0x${string}`),
      });

      // Submit the combined upgrade transaction
      setStatus("✓ Submitting upgrade transaction...");
      const upgradeResponse = await fetch("/api/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          {
            operation: "upgradeEOA",
            targetAddress: account.address,
            initArgs,
            signature,
            authorizationList: [authorization],
          },
          (_, value) => (typeof value === "bigint" ? value.toString() : value)
        ),
      });

      if (!upgradeResponse.ok) {
        const error = await upgradeResponse.json();
        throw new Error(error.error || "Failed to relay upgrade transaction");
      }
      const upgradeHash = (await upgradeResponse.json()).hash;
      console.log("✓ Upgrade transaction submitted:", upgradeHash);

      // Wait for the upgrade transaction to be mined
      setStatus("✓ Waiting for upgrade transaction confirmation...");
      const upgradeReceipt = await publicClient.waitForTransactionReceipt({
        hash: upgradeHash,
      });
      if (upgradeReceipt.status !== "success") {
        throw new Error("Upgrade transaction failed");
      }
      console.log("✓ Upgrade transaction confirmed");

      // Check if the code was deployed
      setStatus("✓ Verifying deployment...");
      const code = await publicClient.getCode({ address: account.address });

      if (code && code !== "0x") {
        console.log("✓ Code deployed successfully");
        
        // Verify passkey ownership
        setStatus("✓ Verifying passkey ownership...");
        const isOwner = await publicClient.readContract({
          address: account.address,
          abi: [
            {
              type: "function",
              name: "isOwnerPublicKey",
              inputs: [
                { name: "x", type: "bytes32" },
                { name: "y", type: "bytes32" },
              ],
              outputs: [{ type: "bool" }],
              stateMutability: "view",
            },
          ],
          functionName: "isOwnerPublicKey",
          args: [
            `0x${passkey.publicKey.slice(2, 66)}` as `0x${string}`,
            `0x${passkey.publicKey.slice(66)}` as `0x${string}`,
          ],
        });

        if (!isOwner) {
          throw new Error("Passkey verification failed: not registered as an owner");
        }

        console.log("\n=== Wallet upgrade complete ===");
        console.log("Smart wallet address:", account.address);
        setStatus("✓ EOA has been upgraded to a Coinbase Smart Wallet with verified passkey!");
        onUpgradeComplete(
          account.address as `0x${string}`,
          upgradeHash,
          code
        );
        setIsUpgraded(true);
      } else {
        console.log("✗ Code deployment failed");
        throw new Error("Code deployment failed");
      }
    } catch (error: any) {
      console.error("Upgrade failed:", error);
      setError(formatError(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      {!account && (
        <button
          onClick={handleCreateEOA}
          disabled={loading}
          className="w-64 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create new EOA Wallet"}
        </button>
      )}

      {account && !isUpgraded && (
        <button
          onClick={handleUpgradeWallet}
          disabled={loading}
          className="w-64 px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50"
        >
          {loading ? "Upgrading..." : "Upgrade EOA to Smart Wallet"}
        </button>
      )}

      {status && (
        <div className="w-full text-center">
          <p className="mb-2">Status:</p>
          <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-left">
            {status}
            {error && <div className="text-red-400">❌ Error: {error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
