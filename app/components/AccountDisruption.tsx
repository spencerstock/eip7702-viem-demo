import { useState, useEffect } from "react";
import { type Address, createPublicClient, http, type Hex, encodeFunctionData } from "viem";
import { odysseyTestnet } from "@/app/lib/chains";
import { localAnvil, createEOAClient, type ExtendedAccount, getRelayerWalletClient, createSetImplementationHash, signSetImplementation } from "@/app/lib/wallet-utils";
import { NEW_IMPLEMENTATION_ADDRESS, PROXY_TEMPLATE_ADDRESSES, VALIDATOR_ADDRESS, ZERO_ADDRESS, ERC1967_SLOT, MAGIC_PREFIX, FOREIGN_DELEGATE, FOREIGN_IMPLEMENTATION } from "@/app/lib/contracts";
import { AccountState } from "./AccountState";

// Helper to check if bytecode is correct (includes magic prefix)
const isCorrectBytecode = (bytecode: string) => {
  const expectedBytecode = `${MAGIC_PREFIX}${PROXY_TEMPLATE_ADDRESSES.odyssey.slice(2).toLowerCase()}`;
  return bytecode.toLowerCase() === expectedBytecode.toLowerCase();
};

interface Props {
  account: ExtendedAccount;
  smartWalletAddress: Address;
  useAnvil: boolean;
  onDisruptionComplete: (type: 'delegate' | 'implementation') => void;
  isDelegateDisrupted: boolean;
  isImplementationDisrupted: boolean;
  currentBytecode: string | null;
  currentSlotValue: string | null;
  onStateChange: (bytecode: string | null, slotValue: string | null) => void;
}

export function AccountDisruption({
  account,
  smartWalletAddress,
  useAnvil,
  onDisruptionComplete,
  isDelegateDisrupted,
  isImplementationDisrupted,
  currentBytecode,
  currentSlotValue,
  onStateChange,
}: Props) {
  const [delegateLoading, setDelegateLoading] = useState(false);
  const [implementationLoading, setImplementationLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Separate effects for tracking delegate and implementation states
  useEffect(() => {
    const checkDelegateState = async () => {
      const publicClient = createPublicClient({
        chain: useAnvil ? localAnvil : odysseyTestnet,
        transport: http(),
      });

      const code = await publicClient.getCode({ address: account.address });
      console.log("\n=== Checking Delegate State ===");
      console.log("Current bytecode:", code);
      onStateChange(code || "0x", currentSlotValue); // Preserve current implementation state
    };

    checkDelegateState();
  }, []); // Run once on mount

  useEffect(() => {
    const checkImplementationState = async () => {
      const publicClient = createPublicClient({
        chain: useAnvil ? localAnvil : odysseyTestnet,
        transport: http(),
      });

      const slotValue = await publicClient.getStorageAt({ 
        address: account.address,
        slot: ERC1967_SLOT
      });

      // Format the slot value as an address (take last 20 bytes)
      const implementationAddress = slotValue 
        ? `0x${(slotValue as string).slice(-40)}` 
        : "0x";

      console.log("\n=== Checking Implementation State ===");
      console.log("Current implementation:", implementationAddress);
      onStateChange(currentBytecode, implementationAddress); // Preserve current bytecode state
    };

    checkImplementationState();
  }, []); // Run once on mount

  // Function to check both states after disruption
  const checkState = async () => {
    const publicClient = createPublicClient({
      chain: useAnvil ? localAnvil : odysseyTestnet,
      transport: http(),
    });

    const [code, slotValue] = await Promise.all([
      publicClient.getCode({ address: account.address }),
      publicClient.getStorageAt({ 
        address: account.address,
        slot: ERC1967_SLOT
      })
    ]);

    // Format the slot value as an address (take last 20 bytes)
    const implementationAddress = slotValue 
      ? `0x${(slotValue as string).slice(-40)}` 
      : "0x";

    console.log("\n=== Current EOA State ===");
    console.log("EOA address:", account.address);
    console.log("Current bytecode:", code || "0x");
    console.log("Current ERC-1967 slot value (raw):", slotValue || "0x");
    console.log("Current implementation address:", implementationAddress);
    
    // Update both states at once to avoid race conditions
    onStateChange(code || "0x", implementationAddress);

    return {
      code: code || "0x",
      slotValue: implementationAddress
    };
  };

  const handleDelegateForeign = async () => {
    try {
      setDelegateLoading(true);
      setError(null);

      // Create user's wallet client for signing
      const userWallet = createEOAClient(account, useAnvil);
      console.log("EOA account for signing:", {
        address: account.address,
        hasPrivateKey: !!account._privateKey,
      });

      // Get initial state
      console.log("\n=== Checking initial state ===");
      const initialState = await checkState();

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
          operation: "submit7702Auth",
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

      // Check the final state
      console.log("\n=== Checking final state ===");
      const finalState = await checkState();

      // For delegation, check if bytecode changed
      if (finalState.code === initialState.code) {
        console.warn("⚠️ Warning: Bytecode did not change after delegation attempt");
      }

      onDisruptionComplete('delegate');
    } catch (error: any) {
      console.error("Failed to delegate:", error);
      setError(error.message || "Failed to delegate to foreign address");
    } finally {
      setDelegateLoading(false);
    }
  };

  const handleSetForeignImplementation = async () => {
    try {
      setImplementationLoading(true);
      
      // Create user's wallet client for signing
      const userWallet = createEOAClient(account, useAnvil);
      console.log("EOA account for signing:", {
        address: account.address,
        hasPrivateKey: !!account._privateKey,
      });

      // Get initial state for comparison
      console.log("\n=== Checking initial state ===");
      const initialState = await checkState();

      // Create public client for balance check and transaction monitoring
      const publicClient = createPublicClient({
        chain: useAnvil ? localAnvil : odysseyTestnet,
        transport: http(),
      });

      // Check EOA balance and fund if needed
      const balance = await publicClient.getBalance({ address: account.address });
      console.log("Current EOA balance:", balance.toString(), "wei");
      
      const requiredBalance = BigInt(600000000000000); // 0.0006 ETH in wei
      if (balance < requiredBalance) {
        const fundingAmount = requiredBalance - balance;
        console.log(`Funding EOA with ${fundingAmount.toString()} wei...`);
        const fundResponse = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "fund",
            targetAddress: account.address,
            value: fundingAmount.toString(),
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
      } else {
        console.log("EOA has sufficient balance, no funding needed");
      }

      // Submit upgradeToAndCall directly from the EOA
      console.log("\n=== Submitting upgradeToAndCall ===");
      console.log("EOA address:", account.address);
      console.log("Target implementation:", FOREIGN_IMPLEMENTATION);
      
      const hash = await userWallet.sendTransaction({
        to: account.address,
        data: encodeFunctionData({
          abi: [{
            type: "function",
            name: "upgradeToAndCall",
            inputs: [
              { name: "newImplementation", type: "address" },
              { name: "data", type: "bytes" }
            ],
            outputs: [],
            stateMutability: "nonpayable"
          }],
          functionName: "upgradeToAndCall",
          args: [FOREIGN_IMPLEMENTATION, "0x"]
        }),
        gas: BigInt(500000), // Much higher gas limit for contract deployment
        maxFeePerGas: BigInt(1100000327), // 1.100000327 gwei
        maxPriorityFeePerGas: BigInt(1100000025), // 1.100000025 gwei
        value: BigInt(0)
      });
      
      console.log("Transaction submitted:", hash);

      // Wait for transaction confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log("Transaction receipt:", receipt);

      // Check final state
      console.log("\n=== Checking final state ===");
      const finalState = await checkState();

      // For implementation change, check if ERC-1967 slot value changed
      if (finalState.slotValue === initialState.slotValue) {
        console.warn("⚠️ Warning: ERC-1967 slot value did not change after implementation change attempt");
      }

      onDisruptionComplete('implementation');
      
    } catch (error: any) {
      console.error("Error setting foreign implementation:", error);
      setError(error.message || "Failed to set foreign implementation");
    } finally {
      setImplementationLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 mt-8 p-6 bg-gray-800 rounded-lg w-full max-w-5xl mx-auto">
      <h3 className="text-xl font-semibold text-red-400 mb-4">⚠️ Account Disruption Tools</h3>
      
      <div className="flex flex-col items-center gap-4 w-full">
        <div className="flex gap-4">
          <button
            onClick={handleDelegateForeign}
            disabled={delegateLoading || !currentBytecode || !isCorrectBytecode(currentBytecode)}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
          >
            {delegateLoading ? "Delegating..." : "7702-Delegate to Foreign Delegate"}
          </button>

          <button
            onClick={handleSetForeignImplementation}
            disabled={implementationLoading || (!!currentSlotValue && currentSlotValue.toLowerCase() !== NEW_IMPLEMENTATION_ADDRESS.toLowerCase())}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
          >
            {implementationLoading ? "Setting..." : "Set Foreign ERC-1967 Implementation"}
          </button>
        </div>

        <AccountState 
          currentBytecode={currentBytecode}
          currentSlotValue={currentSlotValue}
        />

        {error && (
          <div className="mt-4 text-red-400">
            Error: {error}
          </div>
        )}
      </div>
    </div>
  );
} 