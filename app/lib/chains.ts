import { Chain } from "viem";

export const odysseyTestnet = {
  id: 911867,
  name: "Odyssey Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "ETH",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: [process.env.ODYSSEY_RPC_URL ?? "https://odyssey.ithaca.xyz"],
    },
    public: {
      http: [process.env.ODYSSEY_RPC_URL ?? "https://odyssey.ithaca.xyz"],
    },
  },
  blockExplorers: {
    default: {
      name: "Explorer",
      url: "https://odyssey-explorer.ithaca.xyz",
    },
  },
  contracts: {
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11" as const,
    },
  },
} as const satisfies Chain;
