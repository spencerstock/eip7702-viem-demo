import { useState, useEffect } from "react";
import { createPublicClient, http, type Hex } from "viem";
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
import {
  createWebAuthnCredential,
  type P256Credential,
} from "viem/account-abstraction";

interface WalletManagerProps {
  useAnvil: boolean;
  onWalletCreated: (address: string) => void;
  onUpgradeComplete: (
    address: `0x${string}`,
    upgradeHash: string,
    initHash: string,
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

function formatExplorerLink(hash: string, useAnvil: boolean): string | null {
  if (useAnvil) {
    return null;
  }
  return `${odysseyTestnet.blockExplorers.default.url}/tx/${hash}`;
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
      onWalletCreated(newAccount.address);
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

      // For Anvil, use the local relayer. For Odyssey, use the API
      if (useAnvil) {
        const relayerWallet = await getRelayerWalletClient(true);
        console.log("Relayer address:", relayerWallet.account.address);
      }

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

      // Create the authorization signature
      setStatus("Creating authorization signature...");
      const authorization = await userWallet.signAuthorization({
        contractAddress: proxyAddress,
        sponsor: useAnvil
          ? (
              await getRelayerWalletClient(true)
            ).account.address
          : (process.env.NEXT_PUBLIC_RELAYER_ADDRESS as `0x${string}`),
      });

      let upgradeHash: `0x${string}`;
      let initTxHash: `0x${string}`;

      if (useAnvil) {
        throw new Error(
          "Anvil is not currently supported until we figure out how to deploy the EntryPoint contract"
        );
      } else {
        // Use API for Odyssey
        setStatus("✓ Submitting upgrade transaction...");
        const upgradeResponse = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            {
              operation: "upgrade",
              targetAddress: account.address,
              authorizationList: [authorization],
              value: "1",
            },
            (_, value) => (typeof value === "bigint" ? value.toString() : value)
          ),
        });

        if (!upgradeResponse.ok) {
          const error = await upgradeResponse.json();
          throw new Error(error.error || "Failed to relay upgrade transaction");
        }
        upgradeHash = (await upgradeResponse.json()).hash;
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
        onUpgradeComplete(
          account.address as `0x${string}`,
          upgradeHash,
          "",
          ""
        );

        // Create a new passkey
        setStatus("Creating new passkey...");
        const passkey = await createWebAuthnCredential({
          name: "Smart Wallet Owner",
        });
        onPasskeyStored(passkey);

        // Create initialization args with both relayer and passkey as owners
        // (Relayer owner allows for retrieval of unused entrypoint deposit)
        setStatus("Preparing initialization data and signature...");
        const initArgs = encodeInitializeArgs([
          useAnvil
            ? ((await getRelayerWalletClient(true)).account.address as Hex)
            : (process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Hex),
          passkey,
        ]);
        const initHashForSig = createInitializeHash(proxyAddress, initArgs);
        const signature = await signInitialization(userWallet, initHashForSig);

        // Submit initialization transaction
        setStatus("Submitting initialization transaction...");
        const initResponse = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            {
              operation: "initialize",
              targetAddress: account.address,
              initArgs,
              initSignature: signature,
              value: "0",
            },
            (_, value) => (typeof value === "bigint" ? value.toString() : value)
          ),
        });

        if (!initResponse.ok) {
          const error = await initResponse.json();
          throw new Error(
            error.error || "Failed to relay initialize transaction"
          );
        }
        initTxHash = (await initResponse.json()).hash;
        console.log("✓ Initialization transaction submitted:", initTxHash);

        // Wait for init transaction to be mined
        setStatus("✓ Waiting for initialization transaction confirmation...");
        const initReceipt = await publicClient.waitForTransactionReceipt({
          hash: initTxHash,
        });
        if (initReceipt.status !== "success") {
          throw new Error("Initialization transaction failed");
        }
        console.log("✓ Initialization transaction confirmed");
        onUpgradeComplete(
          account.address as `0x${string}`,
          upgradeHash,
          initTxHash,
          ""
        );
      }

      // Check if the code was deployed
      setStatus("✓ Verifying deployment...");
      const code = await publicClient.getCode({ address: account.address });

      if (code && code !== "0x") {
        console.log("✓ Code deployed successfully");
        console.log("\n=== Wallet upgrade complete ===");
        console.log("Smart wallet address:", account.address);
        setStatus("✓ EOA has been upgraded to a Coinbase Smart Wallet!");
        onUpgradeComplete(
          account.address as `0x${string}`,
          upgradeHash,
          initTxHash,
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
