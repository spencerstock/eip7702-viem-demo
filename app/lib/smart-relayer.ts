import { createPublicClient, createWalletClient, Hex, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  createBundlerClient,
  createPaymasterClient,
  toCoinbaseSmartAccount,
} from "viem/account-abstraction";
import { localAnvil } from "./wallet-utils";

export async function getRelayerBundlerClient(useAnvil: boolean) {
  // Create public client based on network
  const client = createPublicClient({
    chain: useAnvil ? localAnvil : baseSepolia,
    transport: http(),
  });

  // Create relayer account from private key
  const relayerAccountOwner = privateKeyToAccount(
    process.env.RELAYER_PRIVATE_KEY! as Hex
  );

  // Convert to Coinbase Smart Account
  const relayerAccount = await toCoinbaseSmartAccount({
    client,
    owners: [relayerAccountOwner],
  });
  console.log("Relayer smart account:", relayerAccount.address);

  // Create paymaster client
  const paymasterClient = createPaymasterClient({
    transport: http(
      useAnvil
        ? process.env.ANVIL_PAYMASTER_URL!
        : process.env.BASE_SEPOLIA_PAYMASTER_URL!
    ),
  });

  // Create bundler client with paymaster support
  const relayerBundlerClient = createBundlerClient({
    account: relayerAccount,
    client,
    paymaster: paymasterClient,
    transport: http(
      useAnvil
        ? process.env.ANVIL_PAYMASTER_URL!
        : process.env.BASE_SEPOLIA_PAYMASTER_URL!
    ),
  });

  return relayerBundlerClient;
}
