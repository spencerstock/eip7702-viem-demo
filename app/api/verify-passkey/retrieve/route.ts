import { NextResponse } from "next/server";
import { type Address, type Hash } from "viem";
import { withdrawEntryPointDeposit } from "../../../lib/smart-account";

export async function POST(request: Request) {
  try {
    const { smartWalletAddress } = await request.json();

    const result = await withdrawEntryPointDeposit({
      smartWalletAddress: smartWalletAddress as Address,
      withdrawAddress: process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Address,
      onStatus: (status) => console.log("Withdraw status:", status),
    });

    if (result?.hash) {
      return NextResponse.json({ txHash: result.hash });
    }

    return NextResponse.json({ message: "No deposit to retrieve" });
  } catch (error) {
    console.error("Error in retrieve endpoint:", error);
    return new NextResponse(
      error instanceof Error ? error.message : "Unknown error",
      { status: 500 }
    );
  }
}
