import { useState, useCallback } from "react";
import { type Address, type Hash, type Hex, createPublicClient, http } from "viem";
import {
  type P256Credential,
  toWebAuthnAccount,
  toCoinbaseSmartAccount,
  type UserOperation,
  createWebAuthnCredential,
} from "viem/account-abstraction";
import { odysseyTestnet } from "../lib/chains";
import { createSetImplementationHash, type ExtendedAccount, createEOAClient, signSetImplementation, encodeInitializeArgs, encodeUseNonce } from "../lib/wallet-utils";
import { serializeBigInts } from "../lib/relayer-utils";
import { RecoveryModal } from "./RecoveryModal";
import { EIP7702PROXY_TEMPLATE_ADDRESS, CBSW_IMPLEMENTATION_ADDRESS } from "../lib/constants";
import { getNonceFromTracker, checkContractState, checkAccountBalances, getCurrentImplementation, verifyPasskeyOwnership } from "../lib/contract-utils";

type VerificationStep = {
  status: string;
  isComplete: boolean;
  txHash?: Hash;
  userOpHash?: Hash;
  error?: string;
};

type Props = {
  smartWalletAddress: Address;
  passkey: P256Credential;
  account: ExtendedAccount;
  isDelegateDisrupted: boolean;
  isImplementationDisrupted: boolean;
  isOwnershipDisrupted: boolean;
  onRecoveryComplete: () => void;
  onStateChange: (bytecode: string | null, slotValue: string | null, nextOwnerIndex?: bigint) => void;
};

const waitForTransaction = async (
  hash: Hash,
  chain: typeof odysseyTestnet
) => {
  const publicClient = createPublicClient({
    chain,
    transport: http(),
  });
  await publicClient.waitForTransactionReceipt({ hash });
};

function TransactionLink({
  hash,
}: {
  hash: Hash;
}) {
  return (
    <a
      href={`${odysseyTestnet.blockExplorers.default.url}/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 hover:text-blue-300 underline font-mono"
    >
      {hash}
    </a>
  );
}

function StepDisplay({
  step,
}: {
  step: VerificationStep;
}) {
  return (
    <div className="mb-4 p-4 bg-gray-800 rounded-lg w-full max-w-5xl mx-auto">
      <div className="flex items-center gap-2">
        {step.isComplete ? (
          <span className="text-green-500">✓</span>
        ) : (
          <div className="w-4 h-4 border-2 border-t-blue-500 border-r-blue-500 border-b-blue-500 border-l-transparent rounded-full animate-spin" />
        )}
        <span className={step.isComplete ? "text-green-500" : "text-blue-500"}>
          {step.status}
        </span>
      </div>
      {step.txHash && (
        <div className="mt-2 ml-6">
          <span className="text-gray-400 mr-2">Transaction:</span>
          <div className="break-all">
            <TransactionLink hash={step.txHash} />
          </div>
        </div>
      )}
      {step.userOpHash && (
        <div className="mt-2 ml-6">
          <span className="text-gray-400 mr-2">UserOperation hash:</span>
          <div className="break-all">
            <code className="font-mono text-green-400">{step.userOpHash}</code>
          </div>
        </div>
      )}
      {step.error && (
        <div className="mt-2 ml-6 text-red-400">
          <span>Error: {step.error}</span>
        </div>
      )}
    </div>
  );
}

export function PasskeyVerification({
  smartWalletAddress,
  passkey,
  account,
  isDelegateDisrupted,
  isImplementationDisrupted,
  isOwnershipDisrupted,
  onRecoveryComplete,
  onStateChange,
  onPasskeyStored,
}: Props & { onPasskeyStored: (passkey: P256Credential) => void }) {
  const [verifying, setVerifying] = useState(false);
  const [steps, setSteps] = useState<VerificationStep[]>([]);
  const [isVerified, setIsVerified] = useState(false);
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const chain = odysseyTestnet;

  // Helper function to prepare initialization data for recovery
  const prepareInitializationData = (recoveryPasskey?: P256Credential): Hex => {
    let initArgs: Hex = "0x" as const;
    if (isOwnershipDisrupted && recoveryPasskey) {
      addStep({
        status: "Preparing initialization data with new passkey...",
        isComplete: false,
      });

      // Create initialization args with ONLY the new passkey as owner
      initArgs = encodeInitializeArgs([
        recoveryPasskey,
      ]);

      updateStep(steps.length - 1, {
        status: "Initialization data prepared",
        isComplete: true,
      });
    } 
    console.log("Initialization data:", initArgs);
    return initArgs;
  };

  // This function is called when the user clicks the "Restore Account" button
  // Handles the logic for recovering the account from a delegate or implementation disruption,
  // or both.
  const handleRecover = async () => {
    try {
      console.log("\n=== Starting account recovery ===");
      console.log("Current state:", {
        isDelegateDisrupted,
        isImplementationDisrupted,
        isOwnershipDisrupted
      });

      setVerifying(true);
      setSteps([]);
      setIsVerified(false);
      addStep({
        status: "Starting account recovery...",
        isComplete: false,
      });

      const userWallet = createEOAClient(account);
      const publicClient = createPublicClient({
        chain,
        transport: http(),
      });

      updateStep(0, {
        status: "Account recovery initialized",
        isComplete: true,
      });

      // Create a new passkey if ownership is disrupted
      let recoveryPasskey: P256Credential | undefined;
      if (isOwnershipDisrupted) {
        console.log("Ownership is disrupted, creating new passkey...");
        addStep({
          status: "Creating new passkey for ownership restoration...",
          isComplete: false,
        });

        try {
          console.log("Calling createWebAuthnCredential...");
          recoveryPasskey = await createWebAuthnCredential({
            name: "Smart Wallet Owner",
          });
          console.log("Created new passkey:", recoveryPasskey);

          if (!recoveryPasskey) {
            throw new Error("Failed to create new passkey - returned undefined");
          }

          console.log("Storing new passkey via onPasskeyStored...");
          if (!onPasskeyStored) {
            throw new Error("onPasskeyStored callback is not defined");
          }
          onPasskeyStored(recoveryPasskey);
          console.log("Successfully stored new passkey");

          updateStep(1, {
            status: "New passkey created successfully",
            isComplete: true,
          });
        } catch (error) {
          console.error("Error during passkey creation:", error);
          throw error; // Re-throw to be caught by outer try-catch
        }
      }

      // ********************* Delegate-only recovery *********************
      if (isDelegateDisrupted && !isImplementationDisrupted) {
        addStep({
          status: "Resetting delegate...",
          isComplete: false,
        });

        const authorization = await userWallet.signAuthorization({
          contractAddress: EIP7702PROXY_TEMPLATE_ADDRESS,
          sponsor: true,
          chainId: odysseyTestnet.id,
        });

        const response = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "submit7702Auth",
            targetAddress: smartWalletAddress,
            authorizationList: [authorization],
          }, (_, value) => 
            typeof value === "bigint" ? value.toString() : value
          ),
        });

        if (!response.ok) {
          throw new Error("Failed to reset delegate");
        }

        const { hash } = await response.json();
        updateStep(steps.length - 1, {
          status: "Waiting for delegate reset transaction...",
          isComplete: false,
          txHash: hash,
        });

        await waitForTransaction(hash, chain);
        await checkState();
        updateStep(steps.length - 1, {
          status: "Successfully reset delegate",
          isComplete: true,
          txHash: hash,
        });
      }

      // ********************* Implementation-only recovery *********************
      else if (!isDelegateDisrupted && isImplementationDisrupted) {
        addStep({
          status: "Resetting implementation to correct version...",
          isComplete: false,
        });

        const currentImplementation = await getCurrentImplementation(publicClient, smartWalletAddress);
        const nonce = await getNonceFromTracker(publicClient, smartWalletAddress);
        const chainId = odysseyTestnet.id;

        // If ownership is disrupted, include initialization data with the new passkey
        const initArgs = prepareInitializationData(recoveryPasskey);

        const setImplementationHash = createSetImplementationHash(
          EIP7702PROXY_TEMPLATE_ADDRESS,
          CBSW_IMPLEMENTATION_ADDRESS,
          initArgs,
          nonce,
          currentImplementation,
          false,
          BigInt(chainId)
        );

        const signature = await signSetImplementation(userWallet, setImplementationHash);

        updateStep(steps.length - 2, {
          status: "Preparing implementation reset transaction...",
          isComplete: true,
        });

        const response = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "setImplementation",
            targetAddress: smartWalletAddress,
            signature,
            initArgs,
          }, (_, value) => 
            typeof value === "bigint" ? value.toString() : value
          ),
        });

        if (!response.ok) {
          throw new Error("Failed to reset implementation");
        }

        const { hash } = await response.json();
        updateStep(steps.length - 2, {
          status: "Waiting for implementation reset transaction...",
          isComplete: false,
          txHash: hash,
        });

        await waitForTransaction(hash, chain);
        await checkState();

        // Verify passkey ownership if we restored ownership
        if (isOwnershipDisrupted && recoveryPasskey) {
          addStep({
            status: "Verifying passkey ownership...",
            isComplete: false,
          });

          const isOwner = await verifyPasskeyOwnership(publicClient, smartWalletAddress, recoveryPasskey);

          if (!isOwner) {
            throw new Error("Passkey verification failed: not registered as an owner");
          }

          updateStep(steps.length - 1, {
            status: "✓ Passkey ownership verified",
            isComplete: true,
          });
        }

        updateStep(steps.length - 2, {
          status: "Successfully reset implementation" + (isOwnershipDisrupted ? " and restored ownership" : ""),
          isComplete: true,
          txHash: hash,
        });
      }

      // ********************* Delegate and implementation recovery ********************* 
      else if (isDelegateDisrupted && isImplementationDisrupted) {
        addStep({
          status: "Resetting both delegate and implementation...",
          isComplete: false,
        });

        console.log("Signing authorization for delegate and implementation reset...");
        const authorization = await userWallet.signAuthorization({
          contractAddress: EIP7702PROXY_TEMPLATE_ADDRESS,
          sponsor: true,
          chainId: odysseyTestnet.id,
        });

        const currentImplementation = await getCurrentImplementation(publicClient, smartWalletAddress);
        const nonce = await getNonceFromTracker(publicClient, smartWalletAddress);
        const chainId = odysseyTestnet.id;

        // If ownership is disrupted, include initialization data with the new passkey
        const initArgs = prepareInitializationData(recoveryPasskey);
        // const initArgs = "0x"; // try empty calldata for upgradeToAndCall
        const setImplementationHash = createSetImplementationHash(
          EIP7702PROXY_TEMPLATE_ADDRESS,
          CBSW_IMPLEMENTATION_ADDRESS,
          initArgs,
          nonce,
          currentImplementation,
          false,
          BigInt(chainId)
        );

        const signature = await signSetImplementation(userWallet, setImplementationHash);

        const response = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "upgradeEOA",
            targetAddress: smartWalletAddress,
            initArgs,
            signature,
            authorizationList: [authorization],
          }, (_, value) => 
            typeof value === "bigint" ? value.toString() : value
          ),
        });
        if (!response.ok) {
          throw new Error("Failed to reset delegate and implementation");
        }

        const { hash } = await response.json();
        updateStep(steps.length - 2, {
          status: "Waiting for reset transaction...",
          isComplete: false,
          txHash: hash,
        });

        await waitForTransaction(hash, chain);
        await checkState();
        updateStep(steps.length - 2, {
          status: "Successfully reset delegate and implementation" + (isOwnershipDisrupted ? " and restored ownership" : ""),
          isComplete: true,
          txHash: hash,
        });
      }

      onRecoveryComplete();
      setShowRecoveryModal(false);
      
      addStep({
        status: "Account recovered successfully",
        isComplete: true,
      });
    } catch (error) {
      console.error("Recovery error:", error);
      
      // Check final state even if recovery failed
      console.log("Checking final state after error...");
      await checkState();

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      addStep({
        status: "Recovery failed",
        isComplete: true,
        error: errorMessage,
      });
    } finally {
      setVerifying(false);
    }
  };

  const updateStep = (index: number, updates: Partial<VerificationStep>) => {
    setSteps((current) =>
      current.map((step, i) => (i === index ? { ...step, ...updates } : step))
    );
  };

  const addStep = (step: VerificationStep) => {
    setSteps((current) => [...current, step]);
  };

  const checkState = async () => {
    const publicClient = createPublicClient({
      chain: odysseyTestnet,
      transport: http(),
    });

    const state = await checkContractState(publicClient, smartWalletAddress);
    onStateChange(state.bytecode, state.implementation, state.nextOwnerIndex);
  };

  const handleVerify = useCallback(async () => {
    if (isDelegateDisrupted || isImplementationDisrupted) {
      setShowRecoveryModal(true);
      return;
    }

    try {
      setVerifying(true);
      setSteps([]);
      setIsVerified(false);

      console.log("Creating WebAuthn account from passkey...");
      const webAuthnAccount = toWebAuthnAccount({ credential: passkey });
      console.log("WebAuthn account public key:", webAuthnAccount.publicKey);

      const publicClient = createPublicClient({
        chain,
        transport: http(),
      });

      addStep({
        status: "Checking account balances...",
        isComplete: false,
      });

      const { accountBalance, entryPointDeposit, needsDeposit } = await checkAccountBalances(publicClient, smartWalletAddress);

      if (accountBalance === BigInt(0)) {
        updateStep(0, {
          status: "Funding smart account with 1 wei...",
          isComplete: false,
        });

        console.log("Smart account has no balance, sending 1 wei from relayer...");
        const response = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "fund",
            targetAddress: smartWalletAddress,
            value: "1",
          }),
        });
        if (!response.ok) {
          throw new Error("Failed to fund smart account");
        }
        const { hash } = await response.json();
        console.log("Funding transaction hash:", hash);
        await waitForTransaction(hash as Hash, chain);
        console.log("Smart account funded with 1 wei");
      }

      updateStep(0, {
        status: "Smart account balance verified",
        isComplete: true,
      });

      if (needsDeposit) {
        console.log("Insufficient deposit, pre-funding required...");
        addStep({
          status: "Pre-funding smart account gas in EntryPoint...",
          isComplete: false,
        });

        const depositResponse = await fetch("/api/verify-passkey/deposit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ smartWalletAddress }),
        });

        if (!depositResponse.ok) {
          const error = await depositResponse.text();
          updateStep(1, { error, isComplete: true });
          return;
        }

        const { txHash: depositTxHash } = await depositResponse.json();
        console.log("Deposit transaction hash:", depositTxHash);
        updateStep(1, {
          status: "Waiting for EntryPoint pre-funding transaction...",
          isComplete: false,
          txHash: depositTxHash,
        });

        await waitForTransaction(depositTxHash, chain);
        const { entryPointDeposit: newDeposit } = await checkAccountBalances(publicClient, smartWalletAddress);
        console.log("New deposit balance:", newDeposit.toString(), "wei");

        updateStep(1, {
          status: "EntryPoint pre-funding complete",
          isComplete: true,
          txHash: depositTxHash,
        });
      }

      addStep({
        status: "Creating and signing userOp to transfer 1 wei to relayer...",
        isComplete: false,
      });

      console.log("Getting owner index...");
      const nextOwnerIndex = await publicClient.readContract({
        address: smartWalletAddress,
        abi: [
          {
            type: "function",
            name: "nextOwnerIndex",
            inputs: [],
            outputs: [{ type: "uint256", name: "" }],
            stateMutability: "view",
          },
        ],
        functionName: "nextOwnerIndex",
      });

      // TODO let's tighten up the way this is retrieved and get it onchain?
      const ourOwnerIndex = Number(nextOwnerIndex - BigInt(1));
      console.log("Using owner index:", ourOwnerIndex);

      console.log("Creating smart account client...");
      const smartAccount = await toCoinbaseSmartAccount({
        client: publicClient,
        owners: [webAuthnAccount],
        address: smartWalletAddress,
        ownerIndex: ourOwnerIndex,
      });

      console.log("Encoding transfer call...");
      const callData = await smartAccount.encodeCalls([
        {
          to: process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Address,
          value: BigInt(1),
          data: "0x" as const,
        },
      ]);

      console.log("Getting nonce...");
      const nonce = await smartAccount.getNonce();
      console.log("Current nonce:", nonce.toString());

      console.log("Preparing userOperation...");
      const unsignedUserOp = {
        sender: smartAccount.address,
        nonce,
        initCode: "0x" as const,
        callData,
        callGasLimit: BigInt(500000),
        verificationGasLimit: BigInt(500000),
        preVerificationGas: BigInt(100000),
        maxFeePerGas: BigInt(3000000000),
        maxPriorityFeePerGas: BigInt(2000000000),
        paymasterAndData: "0x" as const,
        signature: "0x" as const,
      } as const;

      console.log("Signing userOperation...");
      const signature = await smartAccount.signUserOperation(unsignedUserOp);

      const userOp = { ...unsignedUserOp, signature } as UserOperation;

      updateStep(2, {
        status: "UserOperation created and signed",
        isComplete: true,
      });

      addStep({
        status: "Submitting userOperation...",
        isComplete: false,
      });

      const submitResponse = await fetch("/api/verify-passkey/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userOp: serializeBigInts(userOp),
        }),
      });

      if (!submitResponse.ok) {
        const error = await submitResponse.text();
        updateStep(3, { error, isComplete: true });
        return;
      }

      const { txHash, userOpHash } = await submitResponse.json();
      updateStep(3, {
        status: "Waiting for userOperation transaction...",
        isComplete: false,
        txHash,
        userOpHash,
      });

      await waitForTransaction(txHash, chain);
      updateStep(3, {
        status: "UserOperation submitted successfully",
        isComplete: true,
        txHash,
        userOpHash,
      });

      addStep({
        status: "Retrieving unused deposit...",
        isComplete: false,
      });

      const retrieveResponse = await fetch("/api/verify-passkey/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smartWalletAddress,
        }),
      });

      if (!retrieveResponse.ok) {
        const error = await retrieveResponse.text();
        updateStep(4, { error, isComplete: true });
        return;
      }

      const { txHash: retrieveTxHash } = await retrieveResponse.json();
      if (retrieveTxHash) {
        updateStep(4, {
          status: "Waiting for withdrawal transaction...",
          isComplete: false,
          txHash: retrieveTxHash,
        });

        await waitForTransaction(retrieveTxHash, chain);
        updateStep(4, {
          status: "Successfully retrieved unused deposit",
          isComplete: true,
          txHash: retrieveTxHash,
        });
      } else {
        updateStep(4, {
          status: "No unused deposit to retrieve",
          isComplete: true,
        });
      }
      setIsVerified(true);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      addStep({
        status: "Verification failed",
        isComplete: true,
        error: errorMessage,
      });
    } finally {
      setVerifying(false);
    }
  }, [smartWalletAddress, passkey, chain, isDelegateDisrupted, isImplementationDisrupted]);


  return (
    <div className="flex flex-col items-center w-full max-w-5xl mx-auto mt-8">
      <button
        onClick={handleVerify}
        disabled={verifying}
        className="px-6 py-3 text-lg font-semibold text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed mb-8 w-64"
      >
        {verifying ? "..." : "Transact using passkey"}
      </button>

      <div className="w-full space-y-4">
        {steps.map((step, index) => (
          <StepDisplay key={index} step={step} />
        ))}
      </div>

      {isVerified && steps.every((step) => step.isComplete && !step.error) && (
        <div className="mt-8 text-center text-green-500 font-semibold text-lg">
          ✅ Successfully submitted a userOp with passkey owner!
          <div className="mt-4 text-base text-gray-400">
            You can submit another transaction using the button above.
          </div>
        </div>
      )}

      <RecoveryModal
        isOpen={showRecoveryModal}
        onClose={() => setShowRecoveryModal(false)}
        onRecover={handleRecover}
        delegateIssue={isDelegateDisrupted}
        implementationIssue={isImplementationDisrupted}
        ownershipDisrupted={isOwnershipDisrupted}
      />
    </div>
  );
}
