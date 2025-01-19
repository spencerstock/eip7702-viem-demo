import { NextResponse } from "next/server";
import { createPublicClient, http, type Address } from "viem";
import { localAnvil } from "@/app/lib/wallet-utils";
import { odysseyTestnet } from "@/app/lib/chains";
import { EntryPointAddress, EntryPointAbi } from "@/app/lib/abi/EntryPoint";
import {
  getSmartAccountClient,
  createAndSignUserOp,
  submitUserOp,
  withdrawEntryPointDeposit,
} from "@/app/lib/smart-account";

export async function POST(request: Request) {
  const status: string[] = [];
  const addStatus = (msg: string) => {
    console.log(msg); // Log to server console
    status.push(msg);
  };

  // Parse request data once at the start
  const { smartWalletAddress, useAnvil } = await request.json();
  let verificationError: Error | null = null;

  try {
    addStatus("Starting verification process...");

    const publicClient = createPublicClient({
      chain: useAnvil ? localAnvil : odysseyTestnet,
      transport: http(),
    });

    // Check initial balances
    const initialSmartWalletBalance = await publicClient.getBalance({
      address: smartWalletAddress,
    });
    const initialRelayerBalance = await publicClient.getBalance({
      address: process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Address,
    });
    const initialEntryPointDeposit = (await publicClient.readContract({
      address: EntryPointAddress,
      abi: EntryPointAbi,
      functionName: "balanceOf",
      args: [smartWalletAddress],
    })) as bigint;

    addStatus(
      `Initial smart wallet balance: ${initialSmartWalletBalance.toString()} wei`
    );
    addStatus(
      `Initial relayer balance: ${initialRelayerBalance.toString()} wei`
    );
    addStatus(
      `Initial EntryPoint deposit: ${initialEntryPointDeposit.toString()} wei`
    );

    // Skip userOp if smart wallet balance is 0
    if (initialSmartWalletBalance === BigInt(0)) {
      addStatus("Smart wallet balance is 0, skipping userOp submission");
    } else {
      // Create smart account client
      const smartAccount = await getSmartAccountClient(
        smartWalletAddress,
        useAnvil
      );
      addStatus("Created smart account client");

      // Create and sign userOp to send 1 wei back to relayer
      addStatus("Creating userOp to send 1 wei...");
      const userOp = await createAndSignUserOp({
        smartAccount,
        target: process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Address,
        value: BigInt(1),
        onStatus: addStatus,
      });
      addStatus("UserOp created with details:");
      addStatus(`- Sender: ${userOp.sender}`);
      addStatus(`- Nonce: ${userOp.nonce.toString()}`);
      addStatus(`- CallData: ${userOp.callData}`);

      // Submit the userOp
      try {
        addStatus("Submitting userOp...");
        const { hash, userOpHash } = await submitUserOp({
          userOp,
          useAnvil,
          onStatus: addStatus,
        });
        addStatus(
          `UserOp submitted successfully! Hash: ${hash}, UserOpHash: ${userOpHash}`
        );
      } catch (error) {
        addStatus(
          `Error submitting userOp: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        throw error; // Re-throw to be caught by outer try-catch
      }

      // Check final balances
      const finalSmartWalletBalance = await publicClient.getBalance({
        address: smartWalletAddress,
      });
      const finalRelayerBalance = await publicClient.getBalance({
        address: process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Address,
      });

      addStatus(
        `Final smart wallet balance: ${finalSmartWalletBalance.toString()} wei`
      );
      addStatus(`Final relayer balance: ${finalRelayerBalance.toString()} wei`);
      addStatus(
        `Wei transferred to relayer: ${(
          initialSmartWalletBalance - finalSmartWalletBalance
        ).toString()}`
      );
    }
  } catch (error) {
    verificationError = error as Error;
    addStatus(
      `Verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // Always attempt to withdraw deposit, regardless of verification outcome
  try {
    addStatus("Attempting to withdraw EntryPoint deposit...");
    const result = await withdrawEntryPointDeposit({
      smartWalletAddress: smartWalletAddress as Address,
      withdrawAddress: process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Address,
      useAnvil,
      onStatus: addStatus,
    });
    if (result?.hash) {
      addStatus(`Withdrawal successful! Transaction hash: ${result.hash}`);
    }
  } catch (error) {
    addStatus(
      `Withdrawal failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    // If verification succeeded but withdrawal failed, we should still indicate an error
    verificationError = verificationError || (error as Error);
  }

  // Return all status messages and any error
  return NextResponse.json({
    success: !verificationError,
    error: verificationError?.message,
    status,
  });
}
