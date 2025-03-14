# EIP-7702 Wallet Demo

A simple demo application showcasing EIP-7702 wallet creation and upgrades using viem. This demo allows you to create an EOA wallet, upgrade it to a `CoinbaseSmartWallet` using EIP-7702, and verify the upgrade was successful.

## Prerequisites

- Node.js and npm installed

## Testing with Odyssey Testnet

The Odyssey testnet already has the necessary contracts deployed. You'll just need to:

1. Clone and install the repository:

```bash
git clone git@github.com:amiecorso/eip7702-viem-demo.git
cd eip7702-viem-demo
npm install
```

2. Configure your environment:

```bash
cp .env.example .env
```

Add your relayer wallet credentials to `.env`:

```bash
# Required
RELAYER_PRIVATE_KEY=your_private_key_here
NEXT_PUBLIC_RELAYER_ADDRESS=your_public_address_here
```

3. Fund your relayer wallet with some [Odyssey testnet](https://hub.conduit.xyz/odyssey) ETH. Sepolia bridge [here](https://odyssey-fba0638ec5f46615.testnets.rollbridge.app/).

4. Start the development server:

```bash
npm run dev
```

## Usage TODO update this when complete with info about account disruption

1. Click "Create new EOA Wallet" to generate a new wallet
2. Click "Upgrade EOA to Smart Wallet" to:
   - Sign and submit an authorization for the proxy contract while sending the EOA 1 wei
   - Initialize the smart wallet by adding a passkey as a new owner of the smart wallet
3. Click "Transact using passkey" to:
   - Confirm the passkey is an owner
   - Test controlling the smart wallet via the new passkey owner and user operations

## Network Details

### Odyssey Testnet

- RPC URL: https://odyssey.ithaca.xyz
- Chain ID: 911867
- Block Explorer: https://odyssey-explorer.ithaca.xyz
- TODO list contracts and addresses


## Project Structure

- `app/lib/wallet-utils.ts`: Wallet creation and management utilities
- `app/lib/abi/`: Contract ABIs and addresses
- `app/components/`: React components for the UI
- `app/api/`: Backend API routes for relayer operations
