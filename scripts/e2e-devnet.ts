import { readFileSync } from "fs";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactSvmScheme, toClientSvmSigner } from "@x402/svm";

const payerPath =
  process.env.X402_PAYER_KEYPAIR ||
  `${import.meta.dir}/../data/runtime/devnet-payer.json`;
const url =
  process.env.X402_E2E_URL ||
  "http://localhost:43121/x402/search/20?q=solana&since=24h";

const secret = new Uint8Array(
  JSON.parse(readFileSync(payerPath, "utf-8")) as number[]
);
const signer = toClientSvmSigner(await createKeyPairSignerFromBytes(secret));
const client = new x402Client().register("solana:*", new ExactSvmScheme(signer));
const httpClient = new x402HTTPClient(client);

console.log(`payer: ${signer.address}`);
console.log(`url: ${url}`);

const unpaid = await fetch(url);
console.log(`initial_status: ${unpaid.status}`);

if (unpaid.status !== 402) {
  console.error("Expected a 402 response from the protected endpoint.");
  process.exit(1);
}

const unpaidBody = await unpaid.json();
const paymentRequired = httpClient.getPaymentRequiredResponse(
  (name) => unpaid.headers.get(name),
  unpaidBody
);
const requirement = paymentRequired.accepts?.[0];

console.log(
  `payment_required: ${requirement?.network} amount=${requirement?.amount} asset=${requirement?.asset}`
);

const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
const paid = await fetch(url, {
  headers: httpClient.encodePaymentSignatureHeader(paymentPayload),
});

console.log(`paid_status: ${paid.status}`);

if (!paid.ok) {
  console.error("paid_headers:", Object.fromEntries(paid.headers.entries()));
  console.error("paid_body:", await paid.text());
  process.exit(1);
}

const settlement = httpClient.getPaymentSettleResponse((name) =>
  paid.headers.get(name)
);
const body = await paid.json();

console.log(`transaction: ${settlement.transaction}`);
console.log(JSON.stringify(body, null, 2));
