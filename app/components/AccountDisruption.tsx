import { useState } from "react";
import { type Address, createPublicClient, http, type Hex } from "viem";
import { odysseyTestnet } from "../lib/chains";
import { localAnvil, createEOAClient, type ExtendedAccount, getRelayerWalletClient } from "../lib/wallet-utils";
import { NEW_IMPLEMENTATION_ADDRESS } from "../lib/contracts";

const FOREIGN_DELEGATE = "0xfFF02f902cC5B211D0e82bAEE767BdAbac7d21aa" as const;
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
        sponsor: relayerAddress,
        nonce: 1,
        chainId: 0
      });
      console.log("Created authorization:", {
        hasSignature: !!authorization,
        authorizationDetails: authorization,
        targetAddress: smartWalletAddress,
      });

      // Submit the transaction directly from the EOA wallet
      console.log("Submitting transaction directly from EOA wallet...");
      const hash = await userWallet.sendTransaction({
        to: account.address,
        value: BigInt(0),
        authorizationList: [authorization],
      });
      console.log("Transaction submitted:", hash);

      // Wait for transaction confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log("Transaction receipt:", receipt);

      // Check the current bytecode after delegation
      const code = await publicClient.getCode({ address: smartWalletAddress });
      console.log("\n=== Post-delegation state ===");
      console.log("Smart wallet address:", smartWalletAddress);
      if (code) {
        console.log("Current bytecode:", code);
        console.log("Bytecode length:", (code.length - 2) / 2, "bytes");
      } else {
        console.log("No bytecode found (undefined)");
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

      onDisruptionComplete('implementation');
    } catch (error: any) {
      console.error("Failed to set implementation:", error);
      setError(error.message || "Failed to set foreign implementation");
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
        </div>

        {(isDelegateDisrupted || isImplementationDisrupted) && (
          <div className="mt-4 p-4 bg-red-900/30 rounded-lg w-full">
            <h4 className="text-lg font-semibold text-red-400 mb-2">Current Disruption Status:</h4>
            <ul className="list-disc list-inside text-red-300">
              {isDelegateDisrupted && (
                <li>Account is delegated to a foreign address ({FOREIGN_DELEGATE})</li>
              )}
              {isImplementationDisrupted && (
                <li>Account is using a foreign implementation ({FOREIGN_IMPLEMENTATION})</li>
              )}
            </ul>
          </div>
        )}

        {error && (
          <div className="mt-4 text-red-400">
            Error: {error}
          </div>
        )}
      </div>
    </div>
  );
} 