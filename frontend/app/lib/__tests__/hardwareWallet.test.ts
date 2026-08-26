import {
  connectHardwareWallet,
  detectLedgerSupport,
  isLedgerWebUsbSupported,
} from "../hardwareWallet";

describe("hardwareWallet", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports Ledger WebUSB unsupported in jsdom", async () => {
    expect(await isLedgerWebUsbSupported()).toBe(false);
    expect(await detectLedgerSupport()).toBe(false);
  });

  it("connects to a selected Ledger device through WebUSB", async () => {
    const device = {
      opened: false,
      configuration: null,
      open: jest.fn(async function open(this: { opened: boolean }) {
        this.opened = true;
      }),
      selectConfiguration: jest.fn(async function selectConfiguration(
        this: { configuration: unknown },
      ) {
        this.configuration = { configurationValue: 1 };
      }),
      claimInterface: jest.fn(),
      productName: "Ledger Nano X",
      serialNumber: "serial-1",
    };
    const requestDevice = jest.fn().mockResolvedValue(device);
    Object.defineProperty(global.navigator, "usb", {
      configurable: true,
      value: { requestDevice },
    });

    const session = await connectHardwareWallet("ledger");

    expect(requestDevice).toHaveBeenCalledWith({
      filters: [{ vendorId: 0x2c97 }],
    });
    expect(device.open).toHaveBeenCalled();
    expect(device.selectConfiguration).toHaveBeenCalledWith(1);
    expect(device.claimInterface).toHaveBeenCalledWith(0);
    expect(session).toEqual({
      kind: "ledger",
      address: "Ledger Nano X",
      transport: "webusb",
      device: {
        productName: "Ledger Nano X",
        serialNumber: "serial-1",
        vendorId: 0x2c97,
      },
    });
  });

  it("throws a classified error when the user does not select a Ledger device", async () => {
    Object.defineProperty(global.navigator, "usb", {
      configurable: true,
      value: {
        requestDevice: jest
          .fn()
          .mockRejectedValue(new DOMException("No device selected", "NotFoundError")),
      },
    });

    await expect(connectHardwareWallet("ledger")).rejects.toMatchObject({
      name: "HardwareWalletConnectionError",
      code: "device_not_selected",
      retriable: true,
    });
  });

  it("throws a classified error when the Ledger interface cannot be claimed", async () => {
    Object.defineProperty(global.navigator, "usb", {
      configurable: true,
      value: {
        requestDevice: jest.fn().mockResolvedValue({
          opened: false,
          configuration: { configurationValue: 1 },
          open: jest.fn(),
          claimInterface: jest.fn().mockRejectedValue(new Error("busy")),
          productName: "Ledger Nano S",
        }),
      },
    });

    await expect(connectHardwareWallet("ledger")).rejects.toMatchObject({
      name: "HardwareWalletConnectionError",
      code: "device_unavailable",
      retriable: true,
    });
  });
});
