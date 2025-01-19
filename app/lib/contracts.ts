import { type Address } from "viem";

// Standard EntryPoint address (same across networks)
export const ENTRYPOINT_ADDRESS =
  "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789" as const;

// Network-specific proxy template addresses
export const PROXY_TEMPLATE_ADDRESSES: { [key: string]: Address } = {
  odyssey: "0x5ee57314eFc8D76B9084BC6759A2152084392e18",
  anvil: "0x2d95f129bCEbD5cF7f395c7B34106ac1DCfb0CA9", // Keep Anvil address for local testing
} as const;
