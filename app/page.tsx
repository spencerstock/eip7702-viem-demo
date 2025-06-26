"use client";

import { useState } from "react";
import { type ExtendedAccount } from "./lib/wallet-utils";
import { type P256Credential } from "viem/account-abstraction";
import { 
  generateMnemonic,
  validateMnemonic,
  deriveKeypairFromMnemonic,
  generatePRFSalt,
  deriveMnemonicFromPRF,
  mnemonicToEntropy,
  generateMnemonicBridgeBitmask,
  storeMnemonicBridgeBitmask,
  getMnemonicBridgeBitmask,
  recoverOriginalMnemonic,
} from "./lib/prf-mnemonic-utils";
import { createWebAuthnCredentialWithPRF, authenticateWithPRF } from "./lib/webauthn-prf";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { createEOAWalletFromMnemonic, createEOAClient, encodeInitializeArgs, createSetImplementationHash, signSetImplementation } from "./lib/wallet-utils";
import { createPublicClient, http, maxUint256, type Hex } from "viem";
import { baseSepolia } from "./lib/chains";
import { CBSW_IMPLEMENTATION_ADDRESS, ZERO_ADDRESS, EIP7702PROXY_TEMPLATE_ADDRESS } from "./lib/constants";
import { getNonceFromTracker, verifyPasskeyOwnership, checkContractState } from "./lib/contract-utils";

export default function Home() {
  const [activeSection, setActiveSection] = useState<string>("generate");
  
  // Section 1: Generate Mnemonic
  const [generatedMnemonic, setGeneratedMnemonic] = useState<string>("");
  
  // Section 2: Upgrade Mnemonic to Smart Wallet
  const [walletMnemonic, setWalletMnemonic] = useState<string>("");
  const [walletAccount, setWalletAccount] = useState<ExtendedAccount | null>(null);
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [upgradeStatus, setUpgradeStatus] = useState<string>("");
  const [isUpgraded, setIsUpgraded] = useState(false);
  
  // Section 3: Create PRF Passkey & Bitmask (Modified)
  const [bitmaskMnemonic, setBitmaskMnemonic] = useState<string>("");
  const [passkeyName, setPasskeyName] = useState<string>("");
  const [bitmaskPasskey, setBitmaskPasskey] = useState<P256Credential | null>(null);
  const [bitmaskOutput, setBitmaskOutput] = useState<string>("");
  const [prfMnemonic, setPrfMnemonic] = useState<string>("");
  const [bitmaskStatus, setBitmaskStatus] = useState<string>("");
  
  // Section 4: Recover Mnemonic (Modified to show names)
  const [availablePasskeys, setAvailablePasskeys] = useState<Array<{id: string, name: string}>>([]);
  const [selectedPasskeyId, setSelectedPasskeyId] = useState<string>("");
  const [recoveryBitmask, setRecoveryBitmask] = useState<string>("");
  const [recoveredMnemonic, setRecoveredMnemonic] = useState<string>("");
  const [recoveryStatus, setRecoveryStatus] = useState<string>("");

  // Section 1: Generate Mnemonic
  const handleGenerateMnemonic = () => {
    const mnemonic = generateMnemonic();
    setGeneratedMnemonic(mnemonic);
  };

  // Section 2: Upgrade Mnemonic to Smart Wallet
  const handleCreateWalletFromMnemonic = async () => {
    if (!walletMnemonic || !validateMnemonic(walletMnemonic)) {
      setUpgradeStatus("❌ Invalid mnemonic phrase");
      return;
    }

    try {
      setUpgradeStatus("Creating wallet from mnemonic...");
      
      // Derive keypair and create EOA
      const keypair = await deriveKeypairFromMnemonic(walletMnemonic, 0);
      const account = await createEOAWalletFromMnemonic(keypair.privateKey);
      
      setWalletAccount(account);
      setWalletAddress(account.address);
      setUpgradeStatus("✅ Wallet created. Click 'Upgrade to Smart Wallet' to continue.");
    } catch (error) {
      setUpgradeStatus(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleUpgradeToSmartWallet = async () => {
    if (!walletAccount) {
      setUpgradeStatus("❌ Please create a wallet first");
      return;
    }

    try {
      setUpgradeStatus("Upgrading to smart wallet...");
      
      // Create clients
      const userWallet = createEOAClient(walletAccount);
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });
      
      // For this simplified version, we'll only add the relayer as owner
      // The EOA itself will remain in control through EIP-7702
      const relayerAddress = process.env.NEXT_PUBLIC_RELAYER_ADDRESS;
      if (!relayerAddress) {
        throw new Error("NEXT_PUBLIC_RELAYER_ADDRESS not defined");
      }
      
      // Initialize with just the relayer (no passkey)
      const initArgs = encodeInitializeArgs([
        relayerAddress as Hex,
      ]);
      
      const nonce = await getNonceFromTracker(publicClient, walletAccount.address);
      const chainId = baseSepolia.id;
      
      const setImplementationHash = createSetImplementationHash(
        EIP7702PROXY_TEMPLATE_ADDRESS,
        CBSW_IMPLEMENTATION_ADDRESS,
        initArgs,
        nonce,
        ZERO_ADDRESS,
        false,
        BigInt(chainId),
        BigInt(maxUint256)
      );
      
      const signature = await signSetImplementation(userWallet, setImplementationHash);
      
      // Create the authorization signature for EIP-7702
      setUpgradeStatus("Creating authorization signature...");
      const authorization = await userWallet.signAuthorization({
        contractAddress: EIP7702PROXY_TEMPLATE_ADDRESS,
      });
      
      setUpgradeStatus("Submitting upgrade transaction...");
      
      const upgradeResponse = await fetch("/api/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          {
            operation: "upgradeEOA",
            targetAddress: walletAccount.address,
            initArgs,
            signature,
            authorizationList: [authorization],
          },
          (_, value) => (typeof value === "bigint" ? value.toString() : value)
        ),
      });
      
      if (!upgradeResponse.ok) {
        const error = await upgradeResponse.json();
        throw new Error(error.error || "Failed to relay upgrade transaction");
      }
      
      const upgradeHash = (await upgradeResponse.json()).hash;
      setUpgradeStatus("Waiting for confirmation...");
      
      const upgradeReceipt = await publicClient.waitForTransactionReceipt({
        hash: upgradeHash,
      });
      
      if (upgradeReceipt.status !== "success") {
        throw new Error("Upgrade transaction failed");
      }
      
      // Verify deployment
      const state = await checkContractState(publicClient, walletAccount.address);
      if (state.bytecode === "0x") {
        throw new Error("Code deployment failed");
      }
      
      setIsUpgraded(true);
      setUpgradeStatus(`✅ Successfully upgraded to smart wallet! 
        Address: ${walletAccount.address}
        Transaction: ${upgradeHash}
        The EOA can now use smart wallet features while maintaining control through its private key.`);
    } catch (error) {
      setUpgradeStatus(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Section 3: Create PRF Passkey & Bitmask
  const handleCreateBitmask = async () => {
    if (!bitmaskMnemonic || !validateMnemonic(bitmaskMnemonic)) {
      setBitmaskStatus("❌ Invalid mnemonic phrase");
      return;
    }

    if (!passkeyName.trim()) {
      setBitmaskStatus("❌ Please enter a name for the passkey");
      return;
    }

    try {
      setBitmaskStatus("Creating PRF passkey...");
      
      // Create passkey with PRF using the user-defined name
      const tempId = Date.now().toString();
      const prfSalt = generatePRFSalt(tempId);
      
      const extendedPasskey = await createWebAuthnCredentialWithPRF(
        passkeyName.trim(), // Use the user-defined name
        prfSalt
      );
      
      if (extendedPasskey.prfOutput?.enabled !== true) {
        throw new Error("PRF not supported by this authenticator");
      }
      
      const passkey: P256Credential = {
        id: extendedPasskey.id,
        publicKey: extendedPasskey.publicKey.startsWith('0x') 
          ? extendedPasskey.publicKey as Hex 
          : `0x${extendedPasskey.publicKey}` as Hex,
        raw: extendedPasskey.raw,
      };
      
      setBitmaskPasskey(passkey);
      
      // Store salt and name for later
      localStorage.setItem(`passkey-${extendedPasskey.id}-salt`, prfSalt);
      localStorage.setItem(`passkey-${extendedPasskey.id}-name`, passkeyName.trim());
      
      setBitmaskStatus("Authenticating to get PRF output...");
      
      // Authenticate to get PRF output
      const prfOutput = await authenticateWithPRF(passkey.id, prfSalt);
      
      if (!prfOutput) {
        throw new Error("No PRF output received");
      }
      
      // Derive PRF mnemonic
      const prfDerivedMnemonic = await deriveMnemonicFromPRF(prfOutput);
      setPrfMnemonic(prfDerivedMnemonic);
      
      // Generate bitmask
      setBitmaskStatus("Generating bitmask...");
      
      const originalEntropy = await mnemonicToEntropy(bitmaskMnemonic);
      const prfEntropy = await mnemonicToEntropy(prfDerivedMnemonic);
      const bitmask = generateMnemonicBridgeBitmask(originalEntropy, prfEntropy);
      
      const bitmaskHex = bytesToHex(new Uint8Array(bitmask));
      setBitmaskOutput(bitmaskHex);
      
      // Store bitmask
      storeMnemonicBridgeBitmask(extendedPasskey.id, bitmask);
      
      setBitmaskStatus(`✅ Bitmask created! Passkey "${passkeyName}" (ID: ${passkey.id})`);
    } catch (error) {
      setBitmaskStatus(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Section 4: Recover Mnemonic (Modified to show names)
  const loadAvailablePasskeys = () => {
    const passkeys: Array<{id: string, name: string}> = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('passkey-') && key.endsWith('-salt')) {
        // Extract passkey ID from the key
        const passkeyId = key.replace('passkey-', '').replace('-salt', '');
        // Get the stored name for this passkey
        const storedName = localStorage.getItem(`passkey-${passkeyId}-name`);
        const name = storedName || `Unnamed Passkey (${passkeyId.substring(0, 8)}...)`;
        passkeys.push({ id: passkeyId, name });
      }
    }
    
    setAvailablePasskeys(passkeys);
    if (passkeys.length > 0 && !selectedPasskeyId) {
      setSelectedPasskeyId(passkeys[0].id);
    }
  };

  const handleRecoverMnemonic = async () => {
    if (!recoveryBitmask || !selectedPasskeyId) {
      setRecoveryStatus("❌ Please select a passkey and provide a bitmask");
      return;
    }

    try {
      setRecoveryStatus("Authenticating with selected passkey...");
      
      // Get stored salt or generate new one
      const storedSalt = localStorage.getItem(`passkey-${selectedPasskeyId}-salt`);
      const salt = storedSalt || generatePRFSalt(selectedPasskeyId);
      
      // Authenticate to get PRF output
      const prfOutput = await authenticateWithPRF(selectedPasskeyId, salt);
      
      if (!prfOutput) {
        throw new Error("No PRF output received - make sure to use the correct passkey");
      }
      
      // Derive PRF mnemonic
      setRecoveryStatus("Deriving PRF mnemonic...");
      const prfDerivedMnemonic = await deriveMnemonicFromPRF(prfOutput);
      
      // Convert bitmask from hex
      const bitmaskBytes = hexToBytes(recoveryBitmask);
      
      // Recover original mnemonic
      setRecoveryStatus("Recovering original mnemonic...");
      const prfEntropy = await mnemonicToEntropy(prfDerivedMnemonic);
      const recovered = recoverOriginalMnemonic(prfEntropy, bitmaskBytes.buffer);
      
      setRecoveredMnemonic(recovered);
      setRecoveryStatus("✅ Mnemonic recovered successfully!");
    } catch (error) {
      setRecoveryStatus(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Update section navigation to load passkeys when switching to recover
  const handleSectionChange = (sectionId: string) => {
    setActiveSection(sectionId);
    if (sectionId === 'recover') {
      loadAvailablePasskeys();
    }
  };

  const sections = [
    { id: "generate", title: "1. Generate Mnemonic" },
    { id: "upgrade", title: "2. Upgrade Mnemonic to Smart Wallet" },
    { id: "bitmask", title: "3. Create PRF Passkey & Bitmask" },
    { id: "recover", title: "4. Recover Mnemonic" },
  ];

  return (
    <main className="flex min-h-screen flex-col items-center p-8">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">
          <a
            href="https://github.com/ethereum/EIPs/blob/master/EIPS/eip-7702.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline"
          >
            EIP-7702
          </a>{" "}
          + PRF Demo
        </h1>
        <p className="text-xl text-gray-400">
          Mnemonic Recovery with WebAuthn PRF
        </p>
      </div>

      {/* Section Navigation (Updated) */}
      <div className="flex gap-4 mb-8">
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => handleSectionChange(section.id)}
            className={`px-4 py-2 rounded transition-colors ${
              activeSection === section.id
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {section.title}
          </button>
        ))}
      </div>

      <div className="w-full max-w-4xl">
        {/* Section 1: Generate Mnemonic */}
        {activeSection === "generate" && (
          <div className="bg-gray-900 p-8 rounded-lg">
            <h2 className="text-2xl font-bold mb-6 text-blue-400">Generate Mnemonic</h2>
            <p className="text-gray-400 mb-6">
              Generate a new 12-word BIP39 mnemonic phrase for wallet creation.
            </p>
            
            <button
              onClick={handleGenerateMnemonic}
              className="px-6 py-3 bg-blue-500 text-white rounded hover:bg-blue-600 mb-6"
            >
              Generate New Mnemonic
            </button>
            
            {generatedMnemonic && (
              <div className="bg-gray-800 p-4 rounded">
                <h3 className="font-bold text-green-400 mb-2">Generated Mnemonic:</h3>
                <p className="font-mono text-sm">{generatedMnemonic}</p>
                <p className="text-xs text-yellow-400 mt-3">
                  ⚠️ Save this mnemonic securely. You'll need it to recover your wallet.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Section 2: Upgrade Mnemonic to Smart Wallet (Updated UI) */}
        {activeSection === "upgrade" && (
          <div className="bg-gray-900 p-8 rounded-lg">
            <h2 className="text-2xl font-bold mb-6 text-blue-400">Upgrade Mnemonic to Smart Wallet</h2>
            <p className="text-gray-400 mb-6">
              Create an EOA from a mnemonic and upgrade it to a Coinbase Smart Wallet using EIP-7702.
              The EOA remains in control through its private key.
            </p>
            
            <div className="space-y-4">
              <textarea
                value={walletMnemonic}
                onChange={(e) => setWalletMnemonic(e.target.value)}
                placeholder="Enter your 12-word mnemonic phrase..."
                className="w-full p-3 bg-gray-800 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                rows={3}
              />
              
              <div className="flex gap-4">
                <button
                  onClick={handleCreateWalletFromMnemonic}
                  className="px-6 py-3 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Create Wallet
                </button>
                
                {walletAccount && !isUpgraded && (
                  <button
                    onClick={handleUpgradeToSmartWallet}
                    className="px-6 py-3 bg-purple-500 text-white rounded hover:bg-purple-600"
                  >
                    Upgrade to Smart Wallet
                  </button>
                )}
              </div>
              
              {walletAddress && (
                <div className="bg-gray-800 p-4 rounded">
                  <p className="text-sm">
                    <span className="text-gray-400">Wallet Address:</span>{" "}
                    <span className="font-mono text-green-400">{walletAddress}</span>
                  </p>
                  {isUpgraded && (
                    <p className="text-xs text-gray-500 mt-2">
                      This EOA now has smart wallet capabilities through EIP-7702
                    </p>
                  )}
                </div>
              )}
              
              {upgradeStatus && (
                <div className="bg-gray-800 p-4 rounded">
                  <p className="text-sm font-mono whitespace-pre-line">{upgradeStatus}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Section 3: Create PRF Passkey & Bitmask (Updated) */}
        {activeSection === "bitmask" && (
          <div className="bg-gray-900 p-8 rounded-lg">
            <h2 className="text-2xl font-bold mb-6 text-blue-400">Create PRF Passkey & Bitmask</h2>
            <p className="text-gray-400 mb-6">
              Create a named PRF-enabled passkey and generate a bitmask that bridges to your mnemonic.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 mb-2">Passkey Name:</label>
                <input
                  type="text"
                  value={passkeyName}
                  onChange={(e) => setPasskeyName(e.target.value)}
                  placeholder="e.g., My Recovery Key, Hardware Wallet, etc."
                  className="w-full p-3 bg-gray-800 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
              
              <div>
                <label className="block text-gray-400 mb-2">Mnemonic to Protect:</label>
                <textarea
                  value={bitmaskMnemonic}
                  onChange={(e) => setBitmaskMnemonic(e.target.value)}
                  placeholder="Enter any 12-word mnemonic phrase..."
                  className="w-full p-3 bg-gray-800 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                  rows={3}
                />
              </div>
              
              <button
                onClick={handleCreateBitmask}
                className="px-6 py-3 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Create Named PRF Passkey & Generate Bitmask
              </button>
              
              {bitmaskPasskey && (
                <div className="bg-gray-800 p-4 rounded">
                  <p className="text-sm mb-2">
                    <span className="text-gray-400">Passkey Name:</span>{" "}
                    <span className="font-mono text-green-400">{passkeyName}</span>
                  </p>
                  <p className="text-sm">
                    <span className="text-gray-400">Passkey ID:</span>{" "}
                    <span className="font-mono text-blue-400">{bitmaskPasskey.id}</span>
                  </p>
                </div>
              )}
              
              {prfMnemonic && (
                <div className="bg-gray-800 p-4 rounded">
                  <h3 className="font-bold text-green-400 mb-2">PRF-Derived Mnemonic:</h3>
                  <p className="font-mono text-sm">{prfMnemonic}</p>
                </div>
              )}
              
              {bitmaskOutput && (
                <div className="bg-gray-800 p-4 rounded">
                  <h3 className="font-bold text-green-400 mb-2">Bitmask (hex):</h3>
                  <p className="font-mono text-xs break-all">{bitmaskOutput}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    Save this bitmask - combined with your "{passkeyName}" passkey, it can recover your original mnemonic
                  </p>
                </div>
              )}
              
              {bitmaskStatus && (
                <div className="bg-gray-800 p-4 rounded">
                  <p className="text-sm font-mono">{bitmaskStatus}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Section 4: Recover Mnemonic (Updated) */}
        {activeSection === "recover" && (
          <div className="bg-gray-900 p-8 rounded-lg">
            <h2 className="text-2xl font-bold mb-6 text-blue-400">Recover Mnemonic</h2>
            <p className="text-gray-400 mb-6">
              Select a passkey and provide the bitmask to recover your original mnemonic.
            </p>
            
            <div className="space-y-4">
              {availablePasskeys.length > 0 ? (
                <div>
                  <label className="block text-gray-400 mb-2">Select Passkey:</label>
                  <select
                    value={selectedPasskeyId}
                    onChange={(e) => setSelectedPasskeyId(e.target.value)}
                    className="w-full p-3 bg-gray-800 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                  >
                    {availablePasskeys.map((passkey) => (
                      <option key={passkey.id} value={passkey.id}>
                        {passkey.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {availablePasskeys.length} passkey{availablePasskeys.length !== 1 ? 's' : ''} found
                  </p>
                </div>
              ) : (
                <div className="bg-gray-800 p-4 rounded">
                  <p className="text-yellow-400">
                    No passkeys found. Create a PRF passkey in Section 3 first.
                  </p>
                </div>
              )}
              
              <textarea
                value={recoveryBitmask}
                onChange={(e) => setRecoveryBitmask(e.target.value)}
                placeholder="Enter bitmask (hex)..."
                className="w-full p-3 bg-gray-800 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                rows={3}
              />
              
              <button
                onClick={handleRecoverMnemonic}
                disabled={availablePasskeys.length === 0}
                className="px-6 py-3 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Recover Mnemonic
              </button>
              
              {recoveredMnemonic && (
                <div className="bg-gray-800 p-4 rounded">
                  <h3 className="font-bold text-green-400 mb-2">Recovered Mnemonic:</h3>
                  <p className="font-mono text-sm">{recoveredMnemonic}</p>
                  <p className="text-xs text-green-400 mt-3">
                    ✅ Successfully recovered your original mnemonic!
                  </p>
                </div>
              )}
              
              {recoveryStatus && (
                <div className="bg-gray-800 p-4 rounded">
                  <p className="text-sm font-mono">{recoveryStatus}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
