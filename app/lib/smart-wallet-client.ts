import { createPublicClient, Hex, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  createBundlerClient,
  createPaymasterClient,
  toCoinbaseSmartAccount,
} from "viem/account-abstraction";
import { localAnvil } from "./wallet-utils";

export type SmartWalletClient = Awaited<
  ReturnType<typeof createSmartWalletClient>
>;

export async function createSmartWalletClient({
  privateKey,
  useAnvil,
}: {
  privateKey: Hex;
  useAnvil: boolean;
}) {
  // Create public client based on network
  const client = createPublicClient({
    chain: useAnvil ? localAnvil : baseSepolia,
    transport: http(),
  });

  // Create owner account from private key
  const owner = privateKeyToAccount(privateKey);

  // Convert the upgraded EOA to a Coinbase Smart Account
  const smartAccount = await toCoinbaseSmartAccount({
    client,
    owners: [owner],
  });
  console.log("Smart wallet address:", smartAccount.address);

  // Create paymaster client for gas sponsorship
  const paymasterClient = createPaymasterClient({
    transport: http(
      useAnvil
        ? process.env.ANVIL_PAYMASTER_URL!
        : process.env.BASE_SEPOLIA_PAYMASTER_URL!
    ),
  });

  // Create bundler client with paymaster support
  const bundlerClient = createBundlerClient({
    account: smartAccount,
    client,
    paymaster: paymasterClient,
    transport: http(
      useAnvil
        ? process.env.ANVIL_PAYMASTER_URL!
        : process.env.BASE_SEPOLIA_PAYMASTER_URL!
    ),
  });

  return {
    account: smartAccount,
    bundlerClient,
    publicClient: client,
  };
}
