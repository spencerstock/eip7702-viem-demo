import { Chain } from "viem";

export const baseSepolia = {
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: {
    decimals: 18,
    name: "ETH",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: [process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org"],
    },
    public: {
      http: [process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org"],
    },
  },
  blockExplorers: {
    default: {
      name: "BaseScan",
      url: "https://sepolia.basescan.org",
    },
  },
  contracts: {
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11" as const,
    },
  },
} as const satisfies Chain;
