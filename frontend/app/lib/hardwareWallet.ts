/**
 * Hardware wallet adapters for Ledger and Trezor on Stellar.
 * Uses Ledger WebUSB where available; falls back to extension-based signing flows.
 */

export type HardwareWalletKind = "freighter" | "ledger" | "trezor";

export type HardwareWalletStatus =
  | "unsupported"
  | "disconnected"
  | "connected"
  | "locked";

export type HardwareWalletSession = {
  kind: HardwareWalletKind;
  address: string;
  transport: "webusb" | "extension";
  device?: {
    productName?: string;
    serialNumber?: string;
    vendorId: number;
  };
};

export type HardwareWalletErrorCode =
  | "unsupported"
  | "device_not_selected"
  | "permission_denied"
  | "device_unavailable";

type LedgerUsbDevice = {
  opened: boolean;
  configuration: unknown | null;
  productName?: string;
  serialNumber?: string;
  vendorId?: number;
  open: () => Promise<void>;
  selectConfiguration: (configurationValue: number) => Promise<void>;
  claimInterface: (interfaceNumber: number) => Promise<void>;
};

type LedgerUsb = {
  requestDevice: (options: { filters: Array<{ vendorId: number }> }) => Promise<LedgerUsbDevice>;
};

type WebUsbNavigator = Navigator & {
  usb?: LedgerUsb;
};

const LEDGER_VENDOR_ID = 0x2c97;
const LEDGER_INTERFACE_NUMBER = 0;

export class HardwareWalletConnectionError extends Error {
  constructor(
    public readonly code: HardwareWalletErrorCode,
    message: string,
    public readonly retriable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "HardwareWalletConnectionError";
  }
}

function getWebUsb(): LedgerUsb | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as WebUsbNavigator).usb;
}

export async function isLedgerWebUsbSupported(): Promise<boolean> {
  return Boolean(getWebUsb());
}

export async function detectLedgerSupport(): Promise<boolean> {
  return isLedgerWebUsbSupported();
}

export async function detectTrezorSupport(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  return Boolean((window as Window & { TrezorConnect?: unknown }).TrezorConnect);
}

export async function connectHardwareWallet(
  kind: Exclude<HardwareWalletKind, "freighter">,
): Promise<HardwareWalletSession> {
  if (kind === "ledger") {
    const usb = getWebUsb();
    if (!usb) {
      throw new HardwareWalletConnectionError(
        "unsupported",
        "Ledger WebUSB is not available in this browser. Use Chrome or Edge with a USB-connected device.",
        false,
      );
    }

    let device: LedgerUsbDevice;
    try {
      device = await usb.requestDevice({
        filters: [{ vendorId: LEDGER_VENDOR_ID }],
      });
    } catch (error) {
      const errorName = error instanceof DOMException ? error.name : "";
      if (errorName === "NotFoundError") {
        throw new HardwareWalletConnectionError(
          "device_not_selected",
          "No Ledger device selected.",
          true,
          error,
        );
      }
      if (errorName === "SecurityError") {
        throw new HardwareWalletConnectionError(
          "permission_denied",
          "Ledger USB permission was denied by the browser.",
          true,
          error,
        );
      }
      throw new HardwareWalletConnectionError(
        "device_unavailable",
        "Unable to request Ledger USB access.",
        true,
        error,
      );
    }

    try {
      if (!device.opened) {
        await device.open();
      }
      if (!device.configuration) {
        await device.selectConfiguration(1);
      }
      await device.claimInterface(LEDGER_INTERFACE_NUMBER);
    } catch (error) {
      throw new HardwareWalletConnectionError(
        "device_unavailable",
        "Ledger device is unavailable or already claimed by another app.",
        true,
        error,
      );
    }

    return {
      kind: "ledger",
      address: device.productName || "Ledger device",
      transport: "webusb",
      device: {
        productName: device.productName,
        serialNumber: device.serialNumber,
        vendorId: device.vendorId ?? LEDGER_VENDOR_ID,
      },
    };
  }

  if (!(await detectTrezorSupport())) {
    throw new Error(
      "Trezor Connect is not loaded. Include the Trezor Connect script or use Freighter.",
    );
  }

  return {
    kind: "trezor",
    address: "G_TREZOR_PLACEHOLDER",
    transport: "extension",
  };
}
