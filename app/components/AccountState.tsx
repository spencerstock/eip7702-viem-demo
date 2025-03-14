import { PROXY_TEMPLATE_ADDRESSES, NEW_IMPLEMENTATION_ADDRESS } from "../lib/contracts";

interface Props {
  currentBytecode: string | null;
  currentSlotValue: string | null;
}

// EIP-7702 magic prefix
const MAGIC_PREFIX = "0xef0100" as const;

// Helper to check if bytecode is correct (includes magic prefix)
const isCorrectBytecode = (bytecode: string) => {
  const expectedBytecode = `${MAGIC_PREFIX}${PROXY_TEMPLATE_ADDRESSES.odyssey.slice(2).toLowerCase()}`;
  return bytecode.toLowerCase() === expectedBytecode.toLowerCase();
};

export function AccountState({ currentBytecode, currentSlotValue }: Props) {
  return (
    <div className="mt-4 p-4 bg-gray-900/30 rounded-lg w-full">
      <h4 className="text-lg font-semibold text-blue-400 mb-2">Current EOA State:</h4>
      <div className="font-mono text-sm break-all">
        <p className="text-gray-400 mb-2">
          Bytecode: {
            currentBytecode 
              ? <span className={currentBytecode === "0x" || !isCorrectBytecode(currentBytecode) ? "text-red-400" : "text-green-400"}>
                  {currentBytecode}
                </span>
              : <span className="text-yellow-400">Not checked yet</span>
          }
        </p>
        <p className="text-gray-400">
          Implementation Address: {
            currentSlotValue 
              ? <span className={currentSlotValue.toLowerCase() !== NEW_IMPLEMENTATION_ADDRESS.toLowerCase() ? "text-red-400" : "text-green-400"}>
                  {currentSlotValue}
                </span>
              : <span className="text-yellow-400">Not checked yet</span>
          }
        </p>
      </div>
    </div>
  );
} 