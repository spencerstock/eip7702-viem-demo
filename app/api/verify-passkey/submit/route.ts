import { NextResponse } from "next/server";
import { type Hash, createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { odysseyTestnet } from "../../../lib/chains";
import { EntryPointAddress, EntryPointAbi } from "../../../lib/abi/EntryPoint";

export async function POST(request: Request) {
  try {
    const { userOp } = await request.json();

    // Create wallet client for the relayer
    const relayerAccount = privateKeyToAccount(
      process.env.RELAYER_PRIVATE_KEY as `0x${string}`
    );
    const walletClient = createWalletClient({
      account: relayerAccount,
      chain: odysseyTestnet,
      transport: http(),
    });

    // Submit the userOp
    const txHash = (await walletClient.writeContract({
      address: EntryPointAddress,
      abi: EntryPointAbi,
      functionName: "handleOps",
      args: [[userOp], relayerAccount.address],
    })) as Hash;

    const userOpHash = (await walletClient.writeContract({
      address: EntryPointAddress,
      abi: EntryPointAbi,
      functionName: "getUserOpHash",
      args: [userOp],
    })) as Hash;

    return NextResponse.json({ txHash, userOpHash });
  } catch (error) {
    console.error("Error in submit endpoint:", error);
    return new NextResponse(
      error instanceof Error ? error.message : "Unknown error",
      { status: 500 }
    );
  }
}
