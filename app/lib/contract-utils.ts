import { type Address, type PublicClient } from "viem";
import { NONCE_TRACKER_ADDRESS } from "./contracts";

export async function getNonceFromTracker(
  publicClient: PublicClient,
  account: Address
): Promise<bigint> {
  const nonce = await publicClient.readContract({
    address: NONCE_TRACKER_ADDRESS,
    abi: [{
      type: "function",
      name: "nonces",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ type: "uint256" }],
      stateMutability: "view"
    }],
    functionName: "nonces",
    args: [account],
  });

  console.log("Current nonce from NonceTracker:", nonce.toString());
  return nonce;
}
