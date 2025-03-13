import { useState } from "react";
import { type Address, createPublicClient, http, type Hex } from "viem";
import { odysseyTestnet } from "../lib/chains";
import { localAnvil, createEOAClient, type ExtendedAccount, getRelayerWalletClient } from "../lib/wallet-utils";
import { NEW_IMPLEMENTATION_ADDRESS } from "../lib/contracts";

const FOREIGN_DELEGATE = "0x5ee57314eFc8D76B9084BC6759A2152084392e18" as const;
// const FOREIGN_DELEGATE = "0x88da98F3fd0525FFB85D03D29A21E49f5d48491f" as const;
const FOREIGN_IMPLEMENTATION = "0xfFF02f902cC5B211D0e82bAEE767BdAbac7d21aa" as const;

interface Props {
  account: ExtendedAccount;
  smartWalletAddress: Address;
  useAnvil: boolean;
  onDisruptionComplete: (type: 'delegate' | 'implementation') => void;
  isDelegateDisrupted: boolean;
  isImplementationDisrupted: boolean;
}

export function AccountDisruption({
  account,
  smartWalletAddress,
  useAnvil,
  onDisruptionComplete,
  isDelegateDisrupted,
  isImplementationDisrupted,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentBytecode, setCurrentBytecode] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  // Function to check and update bytecode state
  const checkBytecodeState = async () => {
    const publicClient = createPublicClient({
      chain: useAnvil ? localAnvil : odysseyTestnet,
      transport: http(),
    });

    const code = await publicClient.getCode({ address: account.address });
    console.log("\n=== Current EOA State ===");
    console.log("EOA address:", account.address);
    console.log("Current bytecode:", code || "0x");
    console.log("Bytecode length:", code ? (code.length - 2) / 2 : 0, "bytes");
    
    setCurrentBytecode(code || "0x");
    setLastChecked(new Date());
    return code || "0x";
  };

  const handleDelegateForeign = async () => {
    try {
      setLoading(true);
      setError(null);

      // Create user's wallet client for signing
      const userWallet = createEOAClient(account, useAnvil);
      console.log("EOA account for signing:", {
        address: account.address,
        hasPrivateKey: !!account._privateKey,
      });

      // Get initial bytecode state
      console.log("\n=== Checking initial bytecode state ===");
      const initialCode = await checkBytecodeState();

      // Get the relayer address
      const relayerAddress = useAnvil
        ? (await getRelayerWalletClient(true)).account.address
        : (process.env.NEXT_PUBLIC_RELAYER_ADDRESS as `0x${string}`);
      console.log("Using relayer address:", relayerAddress);

      // Create public client to get nonce
      const publicClient = createPublicClient({
        chain: useAnvil ? localAnvil : odysseyTestnet,
        transport: http(),
      });

      // Check EOA balance and fund if needed
      const balance = await publicClient.getBalance({ address: account.address });
      console.log("Current EOA balance:", balance.toString(), "wei");
      
      if (balance < BigInt(300000000000000)) { // 0.00012 ETH in wei
        console.log("Funding EOA with gas money...");
        const fundResponse = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "fund",
            targetAddress: account.address,
            value: "300000000000000",
          }),
        });
        
        if (!fundResponse.ok) {
          throw new Error("Failed to fund EOA wallet");
        }
        
        const { hash } = await fundResponse.json();
        console.log("Funding transaction submitted:", hash);
        await publicClient.waitForTransactionReceipt({ hash });
        
        const newBalance = await publicClient.getBalance({ address: account.address });
        console.log("New EOA balance:", newBalance.toString(), "wei");
      }

      // Create authorization signature for the smart wallet to change its delegate
      console.log("\n=== Creating re-delegation authorization ===");
      console.log("EOA address:", account.address);
      console.log("Target address:", FOREIGN_DELEGATE);
      console.log("Sponsor:", relayerAddress);
      const authorization = await userWallet.signAuthorization({
        contractAddress: FOREIGN_DELEGATE,
        sponsor: true,
        chainId: 0,
      });
      console.log("Created authorization:", {
        hasSignature: !!authorization,
        authorizationDetails: authorization,
        targetAddress: smartWalletAddress,
      });

      // Submit via relay endpoint
      console.log("Submitting via relay endpoint...");
      const response = await fetch("/api/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "delegate",
          targetAddress: account.address,
          authorizationList: [authorization],
        }, (_, value) => 
          typeof value === "bigint" ? value.toString() : value
        ),
      });

      if (!response.ok) {
        throw new Error("Failed to submit delegation via relay");
      }

      const { hash } = await response.json();
      console.log("Transaction submitted:", hash);

      // Wait for transaction confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log("Transaction receipt:", receipt);

      // Check the final bytecode state
      console.log("\n=== Checking final bytecode state ===");
      const finalCode = await checkBytecodeState();

      // Compare bytecode states
      if (finalCode === initialCode) {
        console.warn("⚠️ Warning: Bytecode did not change after delegation attempt");
      }

      onDisruptionComplete('delegate');
    } catch (error: any) {
      console.error("Failed to delegate:", error);
      setError(error.message || "Failed to delegate to foreign address");
    } finally {
      setLoading(false);
    }
  };

  const handleSetForeignImplementation = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get initial bytecode state
      console.log("\n=== Checking initial bytecode state ===");
      const initialCode = await checkBytecodeState();

      // Call upgradeToAndCall directly on the EOA
      const response = await fetch("/api/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "setForeignImplementation",
          targetAddress: smartWalletAddress,
          implementation: FOREIGN_IMPLEMENTATION,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to set foreign implementation");
      }

      // Check final bytecode state
      console.log("\n=== Checking final bytecode state ===");
      const finalCode = await checkBytecodeState();

      // Compare bytecode states
      if (finalCode === initialCode) {
        console.warn("⚠️ Warning: Bytecode did not change after implementation change attempt");
      }

      onDisruptionComplete('implementation');
    } catch (error: any) {
      console.error("Failed to set implementation:", error);
      setError(error.message || "Failed to set foreign implementation");
    } finally {
      setLoading(false);
    }
  };

  // Add a refresh button handler
  const handleRefreshState = async () => {
    try {
      setLoading(true);
      await checkBytecodeState();
    } catch (error: any) {
      console.error("Failed to refresh state:", error);
      setError(error.message || "Failed to refresh state");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 mt-8 p-6 bg-gray-800 rounded-lg w-full max-w-5xl mx-auto">
      <h3 className="text-xl font-semibold text-red-400 mb-4">⚠️ Account Disruption Tools</h3>
      
      <div className="flex flex-col items-center gap-4 w-full">
        <div className="flex gap-4">
          <button
            onClick={handleDelegateForeign}
            disabled={loading}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
          >
            {loading ? "Delegating..." : "Delegate to Foreign Address"}
          </button>

          <button
            onClick={handleSetForeignImplementation}
            disabled={loading || isImplementationDisrupted}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
          >
            {loading ? "Setting..." : "Set Foreign Implementation"}
          </button>

          <button
            onClick={handleRefreshState}
            disabled={loading}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh State"}
          </button>
        </div>

        <div className="mt-4 p-4 bg-gray-900/30 rounded-lg w-full">
          <h4 className="text-lg font-semibold text-blue-400 mb-2">Current EOA State:</h4>
          <div className="font-mono text-sm break-all">
            <p className="text-gray-400 mb-2">Address: <span className="text-green-400">{account.address}</span></p>
            <p className="text-gray-400 mb-2">Bytecode: {
              currentBytecode 
                ? <span className="text-green-400">{currentBytecode}</span>
                : <span className="text-yellow-400">Not checked yet</span>
            }</p>
            <p className="text-gray-400 mb-2">Bytecode Length: {
              currentBytecode 
                ? <span className="text-green-400">{(currentBytecode.length - 2) / 2} bytes</span>
                : <span className="text-yellow-400">Unknown</span>
            }</p>
            <p className="text-gray-400">Last Checked: {
              lastChecked 
                ? <span className="text-green-400">{lastChecked.toLocaleTimeString()}</span>
                : <span className="text-yellow-400">Never</span>
            }</p>
          </div>
        </div>

        {error && (
          <div className="mt-4 text-red-400">
            Error: {error}
          </div>
        )}
      </div>
    </div>
  );
} 