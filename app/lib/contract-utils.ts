import { type Address, type PublicClient } from "viem";
import { NONCE_TRACKER_ADDRESS, ERC1967_IMPLEMENTATION_SLOT, MAGIC_PREFIX, PROXY_TEMPLATE_ADDRESSES, NEW_IMPLEMENTATION_ADDRESS, ENTRYPOINT_ADDRESS } from "./contracts";
import type { P256Credential } from "viem/account-abstraction";
import { EntryPointAbi } from "./abi/EntryPoint";

export const MIN_DEPOSIT = BigInt("100000000000000000"); // 0.1 ETH

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

  return nonce;
}

export async function getCurrentImplementation(
  publicClient: PublicClient,
  address: Address
): Promise<Address> {
  const implementationSlotData = await publicClient.getStorageAt({
    address,
    slot: ERC1967_IMPLEMENTATION_SLOT,
  });
  
  if (!implementationSlotData) {
    throw new Error("Failed to read implementation slot");
  }
  return `0x${implementationSlotData.slice(-40)}` as Address;
}

export type ContractState = {
  bytecode: string;
  implementation: Address;
  isDelegateDisrupted: boolean;
  isImplementationDisrupted: boolean;
};

export async function checkContractState(
  publicClient: PublicClient,
  address: Address,
  useAnvil = false
): Promise<ContractState> {
  // Get both states in parallel
  const [bytecode, implementation] = await Promise.all([
    publicClient.getCode({ address }),
    getCurrentImplementation(publicClient, address)
  ]);

  // Check if delegate is disrupted by comparing bytecode with expected format
  const expectedBytecode = `${MAGIC_PREFIX}${PROXY_TEMPLATE_ADDRESSES[useAnvil ? 'anvil' : 'odyssey'].slice(2).toLowerCase()}`.toLowerCase();
  const currentBytecode = (bytecode || "0x").toLowerCase();
  const isDelegateDisrupted = currentBytecode !== "0x" && currentBytecode !== expectedBytecode;

  // Check if implementation is disrupted
  const isImplementationDisrupted = implementation.toLowerCase() !== NEW_IMPLEMENTATION_ADDRESS.toLowerCase();

  return {
    bytecode: bytecode || "0x",
    implementation,
    isDelegateDisrupted,
    isImplementationDisrupted
  };
}

export async function verifyPasskeyOwnership(
  publicClient: PublicClient,
  walletAddress: Address,
  passkey: P256Credential
): Promise<boolean> {
  const isOwner = await publicClient.readContract({
    address: walletAddress,
    abi: [{
      type: "function",
      name: "isOwnerPublicKey",
      inputs: [
        { name: "x", type: "bytes32" },
        { name: "y", type: "bytes32" },
      ],
      outputs: [{ type: "bool" }],
      stateMutability: "view",
    }],
    functionName: "isOwnerPublicKey",
    args: [
      `0x${passkey.publicKey.slice(2, 66)}` as `0x${string}`,
      `0x${passkey.publicKey.slice(66)}` as `0x${string}`,
    ],
  });

  return isOwner;
}

export type AccountBalances = {
  accountBalance: bigint;
  entryPointDeposit: bigint;
  needsDeposit: boolean;
};

export async function checkAccountBalances(
  publicClient: PublicClient,
  address: Address
): Promise<AccountBalances> {
  // Get both balances in parallel
  const [accountBalance, entryPointDeposit] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({
      address: ENTRYPOINT_ADDRESS,
      abi: EntryPointAbi,
      functionName: "balanceOf",
      args: [address],
    }) as Promise<bigint>
  ]);

  return {
    accountBalance,
    entryPointDeposit,
    needsDeposit: entryPointDeposit < MIN_DEPOSIT
  };
}
