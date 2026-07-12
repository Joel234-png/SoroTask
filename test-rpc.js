const { rpc } = require("@stellar/stellar-sdk");
const server = new rpc.Server("https://soroban-testnet.stellar.org");
async function main() {
  const EVENT_TOPICS = {
    TaskRegistered: 'AAAADwAAAA5UYXNrUmVnaXN0ZXJlZAAA',
    TaskPaused: 'AAAADwAAAApUYXNrUGF1c2VkAAA=',
    TaskResumed: 'AAAADwAAAAtUYXNrUmVzdW1lZAA=',
    KeeperPaid: 'AAAADwAAAApLZWVwZXJQYWlkAAA=',
    GasDeposited: 'AAAADwAAAAxHYXNEZXBvc2l0ZWQ=',
  };
  try {
    const res = await server.getEvents({
      startLedger: 1000000,
      filters: [{
        type: "contract",
        contractIds: ["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2MH"],
        topics: [Object.values(EVENT_TOPICS), ['*']]
      }],
      limit: 10
    });
    console.log("Success", res);
  } catch (e) {
    console.error("Error", e);
  }
}
main();
